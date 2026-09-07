import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { serverClient } from '@/lib/supabase/server'
import { compileLearnerState, type WellnessRow } from '@/lib/learner/compile'
import type { AccountStatus, Attempt, LearnerState, LessonProgress, UserAchievement } from '@/lib/contracts'
import type { ActivityDay } from '@/lib/query/hooks'
import { utcDateKey } from '@/lib/rewards/context'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { RouteReadyMark } from '@/lib/perf/RouteReadyMark'
import { AppShell } from '@/components/shell/AppShell'
import { AccountNotice } from '@/components/shell/AccountNotice'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { QueryProvider } from '@/components/shell/QueryProvider'
import { QuerySeed } from '@/components/shell/QuerySeed'
import { AppEffects } from './providers'

/** Mirrors `ATTEMPTS_CAP` in `src/lib/query/hooks.ts` — the seed and the
 *  client hook must agree on the same window or a mutation's invalidation
 *  would refetch a different-shaped page than the one rendered at first paint. */
const ATTEMPTS_SEED_CAP = 50

/** Postgres/PostgREST codes for "the object being asked for is not there
 *  yet" -- a relation (`42P01`/`PGRST205`) or a function (`42883`/`PGRST202`).
 *  Fix round 1, I1 (critic): only these degrade to an empty result. A 500, a
 *  connection-pool exhaustion, an expired JWT mid-render or an RLS
 *  regression is a different failure entirely and must not be silently
 *  cached as "this learner has none of these" for the rest of the tab
 *  session (`lesson_progress`/`achievements`/`activity-days` are all seeded
 *  with `staleTime: Infinity` and nothing in the app invalidates them). */
const MISSING_OBJECT_CODES = new Set(['42P01', 'PGRST205', '42883', 'PGRST202'])

function isMissingObjectError(err: { code?: string } | null | undefined): boolean {
  return err != null && typeof err.code === 'string' && MISSING_OBJECT_CODES.has(err.code)
}

function mapAttemptRow(row: Record<string, unknown>, userId: string): Attempt {
  return {
    id: String(row.id),
    userId,
    exerciseId: String(row.exercise_id),
    code: String(row.code ?? ''),
    results: (row.results as Attempt['results'] | null) ?? [],
    passed: row.passed === true,
    durationMs: Number(row.duration_ms ?? 0),
    hintCount: Number(row.hint_count ?? 0),
    createdAt: String(row.created_at),
  }
}

function mapLessonProgressRow(row: Record<string, unknown>, userId: string): LessonProgress {
  return {
    userId,
    lessonId: String(row.lesson_id),
    cloId: String(row.clo_id),
    status: row.status as LessonProgress['status'],
    blockIndex: Number(row.block_index ?? 0),
    checksPassed: Number(row.checks_passed ?? 0),
    checksFailed: Number(row.checks_failed ?? 0),
    lessonVersion: Number(row.lesson_version ?? 1),
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
  }
}

function mapAchievementRow(row: Record<string, unknown>, userId: string): UserAchievement {
  return { userId, achievementId: String(row.achievement_id), unlockedAt: String(row.unlocked_at) }
}

/** The UTC calendar day before `key` ("YYYY-MM-DD"). Inlined rather than
 *  imported from `src/lib/learner/compile.ts`'s module-private `dayBefore`
 *  (fix round 1, I2) — that file is not in this task's owned paths and no
 *  other Wave-2 task has claimed it either; two lines of UTC subtraction do
 *  not justify reopening it for an export. */
function utcDayBefore(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`
}

/** Whether a streak dated `last` is still alive on `todayKey` -- the
 *  compiler's own liveness rule (`streakOf` in `src/lib/learner/compile.ts`),
 *  restated here for the one path that has no activity list to recompute
 *  from at all (fix round 1, I2): the RPC is missing at schema 0005, so
 *  `activity.error` is truthy on every single request in production today.
 *  Freezing `saved.streak` untouched on that path (round 1's original fix)
 *  avoided zeroing every returning learner's streak, but it also silently
 *  restored the exact bug R5.2a exists to kill — a `lastExerciseDate` three
 *  weeks stale keeps reading as a live streak forever. Expiry needs only the
 *  last date, which `saved` already carries; it does not need the day list. */
function isStreakAlive(last: string | null, todayKey: string): boolean {
  return last !== null && (last === todayKey || last === utcDayBefore(todayKey))
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers()
  // R5.2: `src/proxy.ts` (via `updateSession`) already verified this request's
  // session and forwards the identity it found, the same way it already
  // forwards the account status below — re-verifying the session here would
  // be a duplicate network round trip on every single protected page. Absence
  // of this header means the layout was somehow reached without going through
  // the proxy (it is not a normal "signed out" visit — the proxy's own
  // matcher already redirects that case to /login before it gets here), so
  // this fails the same way a genuinely unauthenticated visit always has.
  const userId = requestHeaders.get('x-brogram-user-id')
  if (!userId) redirect('/login')
  const status = requestHeaders.get('x-brogram-account-status')
  if (!status || !['active', 'warned', 'restricted', 'banned'].includes(status)) throw new Error('Unable to load your profile')
  const profile = { id: userId, account_status: status as AccountStatus, restricted_until: requestHeaders.get('x-brogram-restricted-until') || null }
  // Cookie mutation is forbidden during rendering. This handler verifies the ban and clears cookies.
  if (profile.account_status === 'banned') redirect('/auth/signout')
  const pathname = requestHeaders.get('x-brogram-pathname') ?? ''
  if (profile.account_status === 'restricted' && /^\/exercise(?:\/|$)/.test(pathname)) redirect('/dashboard')
  // Fix round 1, C1: the proxy forwards the verified email the same way it
  // forwards the id (`src/lib/supabase/middleware.ts`) — the only source of
  // it now that this layout never re-verifies the session itself. Without this,
  // /account's `user?.email` fallback fires forever.
  const userEmail = requestHeaders.get('x-brogram-user-email') ?? undefined

  const supabase = await serverClient()
  const now = new Date()
  // Fix round 1, I4/I5: all six reads run in a single wave. Wave two used to
  // wait on wave one's own round trip even though none of its four reads
  // consume `saved` — only the *decision to recompute the streak* needs it —
  // and gating the fetches themselves behind it meant a learner whose stored
  // document fails the shape check below (a real, if rare, case: commit
  // 9bc1896 "completion survives a failed write") lost their real attempts,
  // lesson progress and achievements for the whole session even though every
  // one of those rows still exists.
  const [
    { data: row, error },
    wellness,
    activity,
    attemptsResult,
    lessonProgressResult,
    achievementsResult,
  ] = await Promise.all([
    supabase.from('learner_state').select('state, version').eq('user_id', userId).maybeSingle(),
    supabase.from('wellness').select('user_id,prefs,pomodoro_sessions,water_log,drill_results,updated_at').eq('user_id', userId).maybeSingle(),
    supabase.rpc('my_activity_days'),
    supabase.from('attempts')
      .select('id,exercise_id,code,results,passed,duration_ms,hint_count,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(ATTEMPTS_SEED_CAP),
    supabase.from('lesson_progress')
      .select('lesson_id,clo_id,status,block_index,checks_passed,checks_failed,lesson_version,started_at,completed_at,updated_at')
      .eq('user_id', userId),
    supabase.from('user_achievements').select('achievement_id,unlocked_at').eq('user_id', userId),
  ])
  if (error) throw new Error('Unable to load your learning progress', { cause: error })
  if (wellness.error) throw new Error('Unable to load your wellness settings', { cause: wellness.error })
  if (attemptsResult.error) throw new Error('Unable to load your recent attempts', { cause: attemptsResult.error })

  // `learner_state` and `wellness` are read on every single load, whether or
  // not a learner_state document already exists: the wellness dock reads
  // `wellness.prefs.dock.placement` on its very first render, and a load
  // that seeded nothing for it painted the default right rail and then
  // reflowed to the learner's real placement the moment `useWellness()`
  // resolved client-side (the Opus review of T2.4 caught this). Resolving
  // through `resolveWellnessPrefs` here, not just at each consumer's read
  // site, means a row stored before v2 (missing `dock`/`theme`/`sound`/
  // `motion`/`dailyGoal`/`goalDays`) already seeds a complete `WellnessPrefs`
  // — the same deep-merge C4 already requires everywhere else.
  const rawWellness = (wellness.data as WellnessRow | null) ?? {}
  const wellnessRow: WellnessRow = { ...rawWellness, prefs: resolveWellnessPrefs(rawWellness.prefs) }
  const document = row?.state
  const record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const saved: LearnerState | null = record(document) && record(document.profile) &&
    record(document.streak) && record(document.mastery) ? document : null

  const attempts: Attempt[] = ((attemptsResult.data as Record<string, unknown>[] | null) ?? []).map((r) => mapAttemptRow(r, userId))

  // Fix round 1, I1: only a confirmed "not there yet" (0006/0007 have not
  // reached production) seeds an empty array. Any other error seeds
  // `undefined` instead — `QuerySeed` already skips undefined props
  // (`src/components/shell/QuerySeed.tsx`), so the key stays unseeded and
  // the client hook fetches it on mount instead of caching a false "this
  // learner has none of these" for the rest of an `Infinity`-stale session.
  let lessonProgress: LessonProgress[] | undefined
  if (!lessonProgressResult.error) {
    lessonProgress = ((lessonProgressResult.data as Record<string, unknown>[] | null) ?? []).map((r) => mapLessonProgressRow(r, userId))
  } else if (isMissingObjectError(lessonProgressResult.error)) {
    lessonProgress = []
  } else {
    console.error('Unable to load lesson progress', lessonProgressResult.error)
  }

  let achievements: UserAchievement[] | undefined
  if (!achievementsResult.error) {
    achievements = ((achievementsResult.data as Record<string, unknown>[] | null) ?? []).map((r) => mapAchievementRow(r, userId))
  } else if (isMissingObjectError(achievementsResult.error)) {
    achievements = []
  } else {
    console.error('Unable to load achievements', achievementsResult.error)
  }

  let activityDays: ActivityDay[] | undefined
  if (!activity.error) {
    activityDays = ((activity.data as { kind: string; day: string }[] | null) ?? []).map((day) => ({
      kind: day.kind === 'derot' ? 'derot' : 'exercise', day: day.day,
    }))
  } else if (isMissingObjectError(activity.error)) {
    // `my_activity_days` ships in the same migration as the integrity
    // breakdown RPC (0008), which has not reached production yet (verified
    // live: PGRST202, "Could not find the function public.my_activity_days").
    activityDays = []
  } else {
    console.error('Unable to load activity history', activity.error)
  }

  let learnerState = compileLearnerState(profile, [], [], [], null, undefined, now)
  if (saved) {
    // Whether there is real activity data to recompute a streak from is a
    // different question from what gets cached for `['activity-days', userId]`
    // (I1, just above): a "not there yet" error also seeds `activityDays` as
    // `[]`, but `[]` there means "treat this the same as the RPC never
    // existing", not "confirmed zero activity" — using it to recompute would
    // wrongly zero every returning learner's streak on the very error path
    // this whole fix exists to handle honestly instead (I2, below).
    if (!activity.error) {
      const successfulActivityDays: ActivityDay[] = ((activity.data as { kind: string; day: string }[] | null) ?? []).map((day) => ({
        kind: day.kind === 'derot' ? 'derot' : 'exercise', day: day.day,
      }))
      // The frozen compiler derives dates from history, not prev. Keep cached
      // aggregates, and supply date-only history so a returning learner cannot
      // keep an expired streak. Only the exercise half changes here — de-rot's
      // streak still comes from the real `wellness.drill_results` above,
      // unbounded exactly as it always was; only the exercise pager was ever unbounded.
      const exerciseActivity = successfulActivityDays
        .filter((day) => day.kind === 'exercise')
        .map((day) => ({ exercise_id: '', passed: false, created_at: day.day }))
      const refreshed = compileLearnerState(profile, [], exerciseActivity, [], rawWellness, saved, now)
      learnerState = { ...learnerState, ...saved, profile: refreshed.profile, streak: {
        ...refreshed.streak,
        lastExerciseDate: refreshed.streak.lastExerciseDate ?? saved.streak.lastExerciseDate ?? null,
        lastDerotDate: refreshed.streak.lastDerotDate ?? saved.streak.lastDerotDate ?? null,
      }, updatedAt: refreshed.updatedAt }
    } else {
      // No activity list at all this load (the RPC is missing at 0005, or
      // errored outright) — recomputing a fresh streak from zero rows is not
      // an option (see the module doc above), but freezing `saved.streak`
      // untouched is the exact bug R5.2a exists to kill. Expire from the
      // last known date instead: a stale date zeroes the count; a live one
      // (today or yesterday, UTC) survives exactly as the full recompute
      // would have found it.
      const todayKey = utcDateKey(now.toISOString()) ?? now.toISOString().slice(0, 10)
      learnerState = { ...learnerState, ...saved, streak: {
        ...saved.streak,
        exerciseDays: isStreakAlive(saved.streak.lastExerciseDate, todayKey) ? saved.streak.exerciseDays : 0,
        derotDays: isStreakAlive(saved.streak.lastDerotDate, todayKey) ? saved.streak.derotDays : 0,
      } }
    }
  }
  learnerState = { ...learnerState, userId, accountStatus: profile.account_status, version: row?.version ?? 0 }

  return (
    <QueryProvider>
      <AppEffects />
      <QuerySeed
        key={userId}
        userId={userId}
        learnerState={learnerState}
        attempts={attempts}
        wellness={wellnessRow}
        lessonProgress={lessonProgress}
        achievements={achievements}
        activityDays={activityDays}
      />
      <SessionProvider key={`${userId}:${profile.account_status}:${profile.restricted_until}`} initialState={{ user: { id: userId, email: userEmail } as User, profile, learnerState }}>
        <AccountNotice status={profile.account_status} restrictedUntil={profile.restricted_until} />
        <RouteReadyMark />
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </QueryProvider>
  )
}
