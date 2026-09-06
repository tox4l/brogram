import type { SupabaseClient } from '@supabase/supabase-js'
import type { CloId, CourseCode, LearnerState } from '@/lib/contracts'
import { callAgent } from '@/lib/agents/client'
import { closFor, loadCourseBundle } from '@/lib/curriculum'
import { provisionalPlan } from '@/lib/learner/provisional'

type Plan = { path: CloId[]; nextExerciseIds: string[] }

function samePlan(a: Plan, b: Plan): boolean {
  return a.path.length === b.path.length && a.path.every((id, index) => id === b.path[index]) &&
    a.nextExerciseIds.length === b.nextExerciseIds.length && a.nextExerciseIds.every((id, index) => id === b.nextExerciseIds[index])
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

export interface SwitchCourseArgs {
  client: SupabaseClient
  userId: string
  code: CourseCode
  fallback: LearnerState
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
 *
 * A Planner failure is swallowed here, never thrown: "a course is never
 * unusable because a model call failed" (R4.4). The provisional plan is
 * still written — the learner keeps a usable path either way.
 */
export async function switchCourse({ client, userId, code, fallback }: SwitchCourseArgs): Promise<SwitchCourseResult> {
  const clos = closFor(code)
  const bundle = await loadCourseBundle(code)
  const provisional = provisionalPlan({ code, clos, exercises: bundle.exercises, mastery: fallback.mastery })

  let finalPlan: Plan = provisional
  try {
    const candidates = provisional.nextExerciseIds.flatMap((id) => {
      const exercise = bundle.exercises.find((row) => row.id === id)
      return exercise ? [{ id: exercise.id, cloId: exercise.cloId, pattern: exercise.pattern, difficulty: exercise.difficulty, title: exercise.title }] : []
    })
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
    finalPlan = { path: envelope.reply.path, nextExerciseIds: envelope.reply.nextExerciseIds }
  } catch {
    finalPlan = provisional
  }

  const state = await writeLearnerState(client, userId, fallback, (base) => ({
    ...base,
    currentCourse: code,
    path: finalPlan.path,
    nextExerciseIds: finalPlan.nextExerciseIds,
  }))

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
