import type { SupabaseClient } from '@supabase/supabase-js'
import type { CloId, CourseCode, ExercisePublic, LearnerState } from '@/lib/contracts'
import { callAgent } from '@/lib/agents/client'
import { closFor, loadCourseBundle } from '@/lib/curriculum'
import { provisionalPlan, type ProvisionalPlan } from '@/lib/learner/provisional'

/** The provisional plan plus the Planner's one-sentence `focus` line, once it
 *  has one. `focus` is not part of the frozen `LearnerState` contract — it
 *  rides along as an extra jsonb key, same as onboarding's and the exercise
 *  loop's own `plan-refresh` writes (`src/hooks/useExerciseLoop.ts:216-218`). */
export type CoursePlan = ProvisionalPlan & { focus?: string }

function samePlan(a: ProvisionalPlan, b: ProvisionalPlan): boolean {
  return a.path.length === b.path.length && a.path.every((id, index) => id === b.path[index]) &&
    a.nextExerciseIds.length === b.nextExerciseIds.length && a.nextExerciseIds.every((id, index) => id === b.nextExerciseIds[index])
}

/** The one place the switch's plan (path, next-up, focus) is folded onto a
 *  `LearnerState` — used for the optimistic store/cache patch AND inside the
 *  settled write's `build` callback, so the two can never drift apart. */
export function withCoursePlan(base: LearnerState, code: CourseCode, plan: CoursePlan): LearnerState {
  return { ...base, currentCourse: code, path: plan.path, nextExerciseIds: plan.nextExerciseIds, focus: plan.focus } as LearnerState
}

export function messageOf(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message: unknown }).message)
    : 'Something went wrong. Try again.'
}

/**
 * The same read-modify-write, version-guarded upsert `src/app/(app)/onboarding/lib.ts`
 * and `useExerciseLoop` both use for `learner_state`: read the current row, apply the
 * delta, write back at `version + 1` conditioned on the version just read, and retry a
 * stale write a few times. Kept local rather than imported — those modules belong to
 * other tasks landing in this same wave and are not a dependency this task takes on.
 */
async function writeLearnerState(
  client: SupabaseClient,
  userId: string,
  fallback: LearnerState,
  build: (base: LearnerState) => LearnerState,
): Promise<LearnerState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await client.from('learner_state').select('state,version').eq('user_id', userId).maybeSingle()
    if (error) throw error
    const base: LearnerState = row?.state && row.state.mastery && row.state.profile && row.state.streak
      ? { ...row.state, version: row.version } as LearnerState
      : { ...fallback, version: row?.version ?? 0 }
    const changed = build(base)
    const nextState: LearnerState = { ...changed, userId, version: base.version + 1, updatedAt: new Date().toISOString() }
    const payload = { user_id: userId, state: nextState, version: nextState.version, updated_at: nextState.updatedAt }
    const write = row
      ? await client.from('learner_state').update(payload).eq('user_id', userId).eq('version', base.version).select('version').maybeSingle()
      : await client.from('learner_state').insert(payload).select('version').maybeSingle()
    if (write.error) {
      if ('code' in write.error && write.error.code === '23505') continue
      throw write.error
    }
    if (!write.data) continue
    return nextState
  }
  throw new Error('Your progress changed elsewhere. Try again.')
}

/**
 * Candidates for the Planner: exercises across the first (up to three) CLOs
 * in the path that are not yet closed, capped at 30 — the same shape v1 sent
 * (`src/hooks/useExerciseLoop.ts:206-211`, trimmed under token pressure at
 * `src/lib/agents/shared.ts:54`, floor pinned at `src/lib/agents/planner.test.ts:149`).
 * `provisionalPlan`'s own three picks are the instant optimistic render, not
 * the candidate set — the Planner's reply validator rejects any id outside
 * `candidates` (`src/lib/agents/planner.ts:79-81`), so handing it only the
 * three ids it is meant to choose *from* leaves it nothing to choose.
 */
function candidatesFor(path: CloId[], mastery: LearnerState['mastery'], exercises: readonly ExercisePublic[]) {
  const openClos = path.filter((cloId) => !mastery[cloId]?.closed).slice(0, 3)
  return exercises
    .filter((exercise) => openClos.includes(exercise.cloId))
    .slice(0, 30)
    .map(({ id, cloId, pattern, difficulty, title }) => ({ id, cloId, pattern, difficulty, title }))
}

export interface SwitchCourseArgs {
  client: SupabaseClient
  userId: string
  code: CourseCode
  fallback: LearnerState
  /** Checked before the bundle load resolves, before the write, and right after the
   *  Planner settles: if a newer switch has started in the meantime, this run bails
   *  out with no write and no store/cache update, rather than persisting a stale
   *  course over whichever one the learner tapped last. */
  isSuperseded?: () => boolean
}

export interface SwitchCourseResult {
  state: LearnerState
  /** True when the Planner's reconciled plan actually differs from the provisional
   *  one — the only case the switch shows a "Path tuned." toast (spec 4.3 step 5). */
  pathTuned: boolean
}

/**
 * The switch itself, steps 2 through 6 of spec 4.3 / R4.4 (the optimistic
 * navigation in step 1 happens in the page component, before this is ever
 * called): a provisional plan computed from data already in the bundle, one
 * background `plan-refresh` call to the Planner, reconciliation, and exactly
 * one versioned `learner_state` write carrying whichever plan is final.
 * Returns `null` (no write at all) when superseded by a later switch.
 *
 * A Planner failure is swallowed here, never thrown: "a course is never
 * unusable because a model call failed" (R4.4). The provisional plan is
 * still written — the learner keeps a usable path either way.
 */
export async function switchCourse({ client, userId, code, fallback, isSuperseded }: SwitchCourseArgs): Promise<SwitchCourseResult | null> {
  const clos = closFor(code)
  const bundle = await loadCourseBundle(code)
  if (isSuperseded?.()) return null

  const provisional = provisionalPlan({ code, clos, exercises: bundle.exercises, mastery: fallback.mastery })

  let finalPlan: CoursePlan = provisional
  try {
    const candidates = candidatesFor(provisional.path, fallback.mastery, bundle.exercises)
    const envelope = await callAgent({
      agent: 'planner',
      trigger: 'plan-refresh',
      state: {
        userId, version: fallback.version, profile: fallback.profile,
        mastery: fallback.mastery, recentMistakes: fallback.recentMistakes, currentCourse: code,
      },
      course: code,
      clos: [...clos],
      candidates,
    })
    finalPlan = { path: envelope.reply.path, nextExerciseIds: envelope.reply.nextExerciseIds, focus: envelope.reply.focus }
  } catch {
    finalPlan = provisional
  }

  if (isSuperseded?.()) return null

  const state = await writeLearnerState(client, userId, fallback, (base) => withCoursePlan(base, code, finalPlan))

  return { state, pathTuned: !samePlan(provisional, finalPlan) }
}

/** Progress ring value (0-100): closed CLOs over the course's total, from data
 *  already in the bundle (`closFor` is a zero-network, build-time read). */
export function courseProgress(code: CourseCode, mastery: LearnerState['mastery']): number {
  const clos = closFor(code)
  if (!clos.length) return 0
  const closed = clos.filter((clo) => mastery[clo.id]?.closed).length
  return Math.round((closed / clos.length) * 100)
}
