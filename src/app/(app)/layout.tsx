import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { serverClient } from '@/lib/supabase/server'
import { compileLearnerState, type WellnessRow } from '@/lib/learner/compile'
import type { AccountStatus, Attempt, LearnerState, LessonProgress, UserAchievement } from '@/lib/contracts'
import type { ActivityDay } from '@/lib/query/hooks'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { AppShell } from '@/components/shell/AppShell'
import { AccountNotice } from '@/components/shell/AccountNotice'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { QueryProvider } from '@/components/shell/QueryProvider'
import { QuerySeed } from '@/components/shell/QuerySeed'

/** Mirrors `ATTEMPTS_CAP` in `src/lib/query/hooks.ts` — the seed and the
 *  client hook must agree on the same window or a mutation's invalidation
 *  would refetch a different-shaped page than the one rendered at first paint. */
const ATTEMPTS_SEED_CAP = 50

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

  const supabase = await serverClient()
  // `learner_state` and `wellness` are read together on every single load,
  // whether or not a learner_state document already exists: the wellness
  // dock reads `wellness.prefs.dock.placement` on its very first render, and
  // a load that seeded nothing for it painted the default right rail and
  // then reflowed to the learner's real placement the moment `useWellness()`
  // resolved client-side (the Opus review of T2.4 caught this). Resolving
  // through `resolveWellnessPrefs` here, not just at each consumer's read
  // site, means a row stored before v2 (missing `dock`/`theme`/`sound`/
  // `motion`/`dailyGoal`/`goalDays`) already seeds a complete `WellnessPrefs`
  // — the same deep-merge C4 already requires everywhere else.
  const [{ data: row, error }, wellness] = await Promise.all([
    supabase.from('learner_state').select('state, version').eq('user_id', userId).maybeSingle(),
    supabase.from('wellness').select('user_id,prefs,pomodoro_sessions,water_log,drill_results,updated_at').eq('user_id', userId).maybeSingle(),
  ])
  if (error) throw new Error('Unable to load your learning progress', { cause: error })
  if (wellness.error) throw new Error('Unable to load your wellness settings', { cause: wellness.error })
  const rawWellness = (wellness.data as WellnessRow | null) ?? {}
  const wellnessRow: WellnessRow = { ...rawWellness, prefs: resolveWellnessPrefs(rawWellness.prefs) }
  const now = new Date()
  const document = row?.state
  const record = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
  const saved: LearnerState | null = record(document) && record(document.profile) &&
    record(document.streak) && record(document.mastery) ? document : null
  let learnerState = compileLearnerState(profile, [], [], [], null, undefined, now)
  let attempts: Attempt[] = []
  let lessonProgress: LessonProgress[] = []
  let achievements: UserAchievement[] = []
  let activityDays: ActivityDay[] = []

  if (saved) {
    // R5.2a: the unbounded `attempts` pager is gone. `my_activity_days` is one
    // bounded RPC (at most 120 rows of two small columns) returning distinct
    // UTC activity dates for exercises and de-rot alike — the only thing
    // streak math actually needs. Without it, capping `attempts` at 50 rows
    // (about sixteen days at three reps a day) would make a 30-day streak
    // unverifiable and let the "hydrated streaks never expire" bug back in.
    // These reads run together; only `lesson_progress` and `user_achievements`
    // tolerate a missing table below — migrations 0006/0007 have not reached
    // production yet, but `learner_state`, `attempts` and the RPC are all
    // live, so an error on either still fails the request.
    const [activity, attemptsResult, lessonProgressResult, achievementsResult] = await Promise.all([
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
    if (attemptsResult.error) throw new Error('Unable to load your recent attempts', { cause: attemptsResult.error })

    // `my_activity_days` ships in the same migration as the integrity
    // breakdown RPC (0008), which — like 0006/0007 below — has not reached
    // production yet (verified live: PGRST202, "Could not find the function
    // public.my_activity_days"). A missing function degrades to "no activity
    // history available this load" rather than a thrown 500: `saved.streak`
    // is kept exactly as persisted instead of being recomputed from an empty
    // activity list, which would otherwise zero out every returning
    // learner's streak the moment this ships, before 0008 has landed.
    activityDays = activity.error ? [] : ((activity.data as { kind: string; day: string }[] | null) ?? []).map((day) => ({
      kind: day.kind === 'derot' ? 'derot' : 'exercise', day: day.day,
    }))
    attempts = ((attemptsResult.data as Record<string, unknown>[] | null) ?? []).map((r) => mapAttemptRow(r, userId))
    // 0006/0007 have not shipped to production yet either: a missing-relation
    // error degrades to "no rows yet" so the page never slows down (no
    // retry) or logs noise on every request waiting on a table that is not
    // there. Once each migration lands, this same code starts seeding real rows.
    lessonProgress = lessonProgressResult.error ? [] : ((lessonProgressResult.data as Record<string, unknown>[] | null) ?? []).map((r) => mapLessonProgressRow(r, userId))
    achievements = achievementsResult.error ? [] : ((achievementsResult.data as Record<string, unknown>[] | null) ?? []).map((r) => mapAchievementRow(r, userId))

    if (!activity.error) {
      // The frozen compiler derives dates from history, not prev. Keep cached
      // aggregates, and supply date-only history so a returning learner cannot
      // keep an expired streak. Only the exercise half changes here — de-rot's
      // streak still comes from the real `wellness.drill_results` above,
      // unbounded exactly as it always was; only the exercise pager was ever unbounded.
      const exerciseActivity = activityDays
        .filter((day) => day.kind === 'exercise')
        .map((day) => ({ exercise_id: '', passed: false, created_at: day.day }))
      const refreshed = compileLearnerState(profile, [], exerciseActivity, [], rawWellness, saved, now)
      learnerState = { ...learnerState, ...saved, profile: refreshed.profile, streak: {
        ...refreshed.streak,
        lastExerciseDate: refreshed.streak.lastExerciseDate ?? saved.streak.lastExerciseDate ?? null,
        lastDerotDate: refreshed.streak.lastDerotDate ?? saved.streak.lastDerotDate ?? null,
      }, updatedAt: refreshed.updatedAt }
    } else {
      learnerState = { ...learnerState, ...saved }
    }
  }
  learnerState = { ...learnerState, userId, accountStatus: profile.account_status, version: row?.version ?? 0 }

  return (
    <QueryProvider>
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
      <SessionProvider key={`${userId}:${profile.account_status}:${profile.restricted_until}`} initialState={{ user: { id: userId } as User, profile, learnerState }}>
        <AccountNotice status={profile.account_status} restrictedUntil={profile.restricted_until} />
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </QueryProvider>
  )
}
