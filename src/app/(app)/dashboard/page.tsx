'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Flame, LockKeyhole, Trophy } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { CourseCode } from '@/lib/contracts'
import { ACHIEVEMENTS, levelForXp, xpToReach } from '@/lib/contracts'
import { course as courseMeta, loadCourseBundle, type CourseBundle } from '@/lib/curriculum'
import { buildMap, currentCloId, nextUp } from '@/lib/course/map'
import { buildRewardContext } from '@/lib/rewards/context'
import { goalMet, levelBand, winsToday } from '@/lib/rewards/goal'
import { flameState } from '@/lib/rewards/streaks'
import { useAchievements, useActivityDays, useAttempts, useLessonProgress, useWellness } from '@/lib/query/hooks'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { getRuntime } from '@/lib/runtimes'
import { NextUpStack } from '@/components/course/NextUpStack'
import { cn } from '@/lib/utils'
import { useSession } from '@/store/session'

/** A skill closes at three passes (`src/lib/course/map.ts`'s `CHAIN_TARGET`, restated
 *  here because that constant is not exported and this screen only needs the number
 *  for the resume card's "you were N of 3 into {skill}" line). */
const CHAIN_TARGET = 3

interface BundleState {
  code: CourseCode
  bundle: CourseBundle | null
  failed: boolean
}

/**
 * The static curriculum bundle for the learner's current course (R5.1: zero
 * Supabase round trips; a CDN-cached static file, memoised per session by
 * `loadCourseBundle` itself). This is the only fetch this screen makes, and
 * it is what the resume card and Next-up stack need for titles and reps --
 * everything else on this page (streak, goal, level, trophies) comes straight
 * out of the layout-seeded query cache and the session store. `setState` only
 * ever runs inside the promise callbacks below, never synchronously in the
 * effect body.
 */
function useCourseBundle(code: CourseCode | null) {
  const [state, setState] = useState<BundleState | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    loadCourseBundle(code)
      .then((bundle) => { if (!cancelled) setState({ code, bundle, failed: false }) })
      .catch(() => { if (!cancelled) setState({ code, bundle: null, failed: true }) })
    return () => { cancelled = true }
  }, [code, attempt])

  const current = state && code && state.code === code ? state : null
  return {
    bundle: current?.bundle ?? null,
    loading: Boolean(code) && current === null,
    failed: current?.failed ?? false,
    retry: () => setAttempt((value) => value + 1),
  }
}

/** requestIdleCallback with the documented setTimeout(…, 1) fallback for
 *  engines that lack it (spec 5.4). Returns a canceller so the effect that
 *  scheduled it can clean up on unmount without leaking a callback. */
function onIdle(run: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void) => number
    cancelIdleCallback?: (handle: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(run)
    return () => w.cancelIdleCallback?.(handle)
  }
  const handle = setTimeout(run, 1)
  return () => clearTimeout(handle)
}

/** Fix round 1, I6: a learner on a metered or 2G connection did not ask for
 *  a ~10 MB Pyodide/CheerpJ prefetch just by opening the dashboard. Neither
 *  signal exists in every engine, so a missing `navigator.connection` reads
 *  as "no signal either way" -- warm up as normal. */
function prefersLessData(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (!conn) return false
  if (conn.saveData === true) return true
  return /(^|-)2g$/.test(conn.effectiveType ?? '')
}

function subscribeNever(): () => void { return () => {} }

/**
 * Fix round 1, I3: `getHours()` reads the runtime's configured timezone,
 * which differs between the UTC Vercel Node runtime that renders the
 * initial HTML and a learner's local machine (Doha, UTC+3) -- computing it
 * during render mismatched the at-risk streak branch on hydration every
 * evening (React logs the mismatch and the text visibly flips). `-1` before
 * hydration always reads as "not yet past the at-risk hour" so the server
 * and the very first client render agree; the real local hour lands in the
 * next paint, with no `setState` in an effect (standing constraint: no
 * synchronous `setState` in effects). `getUTCHours()` needs no such guard —
 * it returns the same value regardless of the runtime's timezone.
 */
function useLocalHour(): number {
  return useSyncExternalStore(subscribeNever, () => new Date().getHours(), () => -1)
}

function StatTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div role="group" aria-label={label} className="min-w-0 py-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  )
}

export default function Dashboard() {
  const { learnerState, profile } = useSession()
  const restricted = profile?.account_status === 'restricted'

  // Every read below is either the session store the layout already seeded
  // before paint, or a query key the layout seeded through `QuerySeed` --
  // `staleTime: Infinity` (or a fresh 30s window for `attempts`, seeded in
  // the same request) means none of these fires a Supabase read on mount.
  const attemptsQuery = useAttempts()
  const lessonProgressQuery = useLessonProgress()
  const wellnessQuery = useWellness()
  const achievementsQuery = useAchievements()
  const activityDaysQuery = useActivityDays()

  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const reducedMotion = useReducedMotion(prefs.motion)

  const { bundle, failed: bundleFailed, retry: retryBundle } = useCourseBundle(learnerState?.currentCourse ?? null)
  const bundleLoading = Boolean(learnerState?.currentCourse) && !bundle && !bundleFailed

  const meta = learnerState?.currentCourse ? courseMeta(learnerState.currentCourse) : null
  const currentClo = bundle && learnerState ? currentCloId(learnerState.path, learnerState.mastery) : null
  const cards = bundle && learnerState
    ? nextUp({
      currentCloId: currentClo,
      clos: bundle.clos,
      lessons: bundle.lessons,
      lessonProgress: lessonProgressQuery.data ?? [],
      nextExerciseIds: learnerState.nextExerciseIds,
      exercises: bundle.exercises,
    })
    : []
  const nodes = bundle && learnerState
    ? buildMap({ clos: bundle.clos, code: learnerState.currentCourse as CourseCode, mastery: learnerState.mastery, lessonProgress: lessonProgressQuery.data ?? [], lessons: bundle.lessons, path: learnerState.path })
    : []
  const lockedIn = nodes.filter((node) => node.state === 'locked-in').length

  // Prefetch ladder step 1 (spec 5.4): curriculum already resolved from the
  // bundle above with zero requests; warm the runtime for the top card that
  // actually needs one, at idle, so a normal connection never pays the cold
  // start on the click that follows. This never guarantees a warm runtime
  // (R5.4) -- the exercise screen keeps its own real-progress warming.
  const warmupLanguage = cards.find((card) => card.language)?.language
  useEffect(() => {
    if (!warmupLanguage) return
    if (prefersLessData()) return
    return onIdle(() => { void getRuntime(warmupLanguage).warmup() })
  }, [warmupLanguage])

  const now = new Date()
  const rewardCtx = learnerState ? buildRewardContext({
    state: learnerState,
    attempts: attemptsQuery.data ?? [],
    activityDays: activityDaysQuery.data ?? [],
    lessonProgress: lessonProgressQuery.data ?? [],
    drillResults: wellnessQuery.data?.drill_results ?? [],
    prefs,
    courseLessonCounts: {},
    now,
  }) : null
  const wins = rewardCtx ? winsToday(rewardCtx) : 0
  const goalReached = rewardCtx ? goalMet(rewardCtx) : false
  const goalPercent = prefs.dailyGoal > 0 ? Math.min(100, Math.round((wins / prefs.dailyGoal) * 100)) : 0

  const exerciseDays = learnerState?.streak.exerciseDays ?? 0
  const derotDays = learnerState?.streak.derotDays ?? 0
  const countedToday = learnerState?.streak.lastExerciseDate === (rewardCtx?.today ?? now.toISOString().slice(0, 10))
  const localHour = useLocalHour()
  // justTransitioned is always false here (fix round 1, streaks.ts): this is
  // a plain mount-time read, never the on-load "did it just die" comparison
  // or a fresh win -- both of those belong to the mutation that actually
  // records an action, not to rendering "Today". `getUTCHours()` is safe to
  // read during render on both the server and the client (I3): unlike
  // `getHours()`, it never depends on the runtime's configured timezone.
  const flame = flameState(exerciseDays, countedToday, localHour, now.getUTCHours(), false)
  const flameCopy = flame === 'at-risk'
    ? { label: 'Streak at risk', note: 'No rep yet today. One keeps it alive.' }
    : exerciseDays > 0
      ? { label: 'Streak kept', note: 'One day at a time.' }
      : { label: 'Streak reset', note: 'Today is a good day to start it.' }

  const points = learnerState?.points ?? 0
  const level = levelForXp(points)
  const band = levelBand(level)
  const levelFloor = xpToReach(level)
  const levelCeiling = xpToReach(level + 1)
  const levelPercent = levelCeiling > levelFloor ? Math.min(100, Math.round(((points - levelFloor) / (levelCeiling - levelFloor)) * 100)) : 100

  const trophies = [...(achievementsQuery.data ?? [])]
    .sort((a, b) => Date.parse(b.unlockedAt) - Date.parse(a.unlockedAt))
    .slice(0, 3)
    .flatMap((unlocked) => {
      const meta = ACHIEVEMENTS.find((achievement) => achievement.id === unlocked.achievementId)
      return meta ? [{ ...meta, unlockedAt: unlocked.unlockedAt }] : []
    })

  const currentMastery = currentClo && learnerState ? learnerState.mastery[currentClo] : undefined
  const currentProgress = currentClo ? (lessonProgressQuery.data ?? []).find((row) => row.cloId === currentClo) : undefined
  const currentTitle = bundle?.clos.find((clo) => clo.id === currentClo)?.outcome
  const resumeChain = currentMastery && currentMastery.chain > 0 && !currentMastery.closed ? currentMastery.chain : null
  const resumeWalkthrough = currentProgress?.status === 'started' ? currentProgress : null

  return (
    <div className="space-y-7">
      <div>
        <h1 className="max-w-4xl text-2xl font-medium tracking-tight sm:text-3xl">
          {learnerState?.profile.displayName.trim() ? `Keep building, ${learnerState.profile.displayName.trim()}.` : 'Today.'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {learnerState?.currentCourse ? 'Pick up where you left off.' : 'Choose a course and make space for your first small win.'}
        </p>
      </div>

      {!learnerState?.currentCourse ? (
        <section aria-labelledby="resume-heading" className="rounded-xl border border-dashed border-input p-5">
          <h2 id="resume-heading" className="text-sm font-medium">Pick a course</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">A course gives your practice a direction. You can change it anytime.</p>
          <Link href="/onboarding" className={cn(buttonVariants({ variant: 'default' }), 'mt-3 h-9')}>
            Choose a course<ArrowUpRight aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <section aria-labelledby="resume-heading" className="rounded-xl border border-border bg-linear-to-br from-emerald-200/[0.06] to-transparent p-5">
          <h2 id="resume-heading" className="text-xs font-medium text-muted-foreground">{meta?.title ?? 'Course'}</h2>
          {bundleFailed ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-foreground">Course details couldn&apos;t load. Progress is saved separately.</p>
              <Button variant="outline" onClick={retryBundle}>Try again</Button>
            </div>
          ) : resumeWalkthrough && currentTitle ? (
            <>
              <p className="mt-2 text-lg font-medium tracking-tight">Continue the walkthrough</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">You were partway through {currentTitle}.</p>
            </>
          ) : resumeChain && currentTitle ? (
            <>
              <p className="mt-2 text-lg font-medium tracking-tight">Pick up where you left off</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">You were {resumeChain} of {CHAIN_TARGET} into {currentTitle}.</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-lg font-medium tracking-tight">Ready when you are</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{lockedIn} of {nodes.length} skills locked in.</p>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {/* N2-1 (T3.2 fix round 3): tried `prefetch` (shorthand for
                `prefetch={true}`, the same treatment `CourseCard.tsx` already
                carries) here first, on the theory that requesting the full
                dynamic route ahead of time on viewport entry (this build's
                own `node_modules/next/dist/docs/01-app/02-guides/
                prefetching.md`, "the full route is prefetched for both
                static and dynamic routes") would move the cost off the
                click. Measured against a real production build twice: it
                made the click *slower* (857ms, 863ms) than the unprefetched
                baseline (494-509ms, matching round 2's own numbers, 503.8ms
                re-confirmed here) -- `/course/[code]` itself makes zero
                Supabase reads (`useCourseBundle` reads the static curriculum
                bundle only), so both numbers are paying for the same
                upstream cost: `src/proxy.ts` -> `src/lib/supabase/
                middleware.ts`'s `updateSession`, which runs
                `supabase.rpc('lift_expired_restriction')` then a `profiles`
                select in series (both real network round trips against the
                production Supabase project) before `(app)/layout.tsx`'s own
                six-way `Promise.all` even starts -- on every request this
                proxy's matcher covers, prefetch included. A second,
                concurrent full-route prefetch competes with that same path
                (and this route's parallel-6-read layout) for the project's
                connection pool instead of moving the cost off the critical
                path, which is the regression measured above. Left at the
                default (no `prefetch` prop) rather than shipping a change
                that measurably makes the budget worse; the real fix is
                serial-round-trip work in `src/lib/supabase/middleware.ts`
                and is out of this task's file grant -- see the T3.2 report,
                Fix round 3, for the exact change to hand to whoever owns
                that file. */}
            <Link href={`/course/${learnerState.currentCourse}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-9')}>
              Open your course<ArrowUpRight aria-hidden="true" />
            </Link>
            <Link href="/courses" className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              Change course
            </Link>
          </div>
        </section>
      )}

      <div className="grid grid-cols-3 gap-3 border-b border-border pb-5 sm:gap-6">
        <div role="group" aria-label="Rep streak" className="min-w-0 py-1">
          <p className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Flame className="size-3" aria-hidden="true" />{flameCopy.label}</p>
          <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{exerciseDays} {exerciseDays === 1 ? 'day' : 'days'}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{flameCopy.note}</p>
        </div>
        <div className="min-w-0 py-1">
          <p className="text-xs text-muted-foreground">Today&apos;s goal</p>
          <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{wins} / {prefs.dailyGoal}</p>
          <Progress value={goalPercent} aria-label="Today's goal" className="mt-2 h-1.5" />
          {goalReached && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Goal met today.</p>}
        </div>
        <StatTile label="Points" value={points.toLocaleString('en-US')} note="Earned through practice." />
      </div>

      {bundleLoading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading your next reps. Progress saves as you go.</p>
      ) : (
        <NextUpStack cards={cards} reducedMotion={reducedMotion} restricted={restricted} />
      )}

      <section aria-labelledby="level-heading" className="rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="level-heading" className="text-sm font-medium">Level {level} &middot; {band}</h2>
          <p className="text-xs text-muted-foreground">{points.toLocaleString('en-US')} XP</p>
        </div>
        <Progress value={levelPercent} aria-label="Level progress" className="mt-3 h-1.5" />
        <div className="mt-4">
          <h3 className="text-xs font-medium text-muted-foreground">Last trophies</h3>
          {trophies.length ? (
            <ul className="mt-2 flex flex-wrap gap-3">
              {trophies.map((trophy) => (
                <li key={trophy.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                  <Trophy className="size-3.5 text-primary" aria-hidden="true" />
                  <span className="font-medium text-foreground">{trophy.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nothing on the shelf yet. First pass puts something here.</p>
          )}
        </div>
      </section>

      <section aria-label="De-rot practice" className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <div>
          <h2 className="text-sm font-medium">A change of pace</h2>
          <p className="mt-1 text-sm text-muted-foreground">{derotDays > 0 ? `De-rot streak: ${derotDays} ${derotDays === 1 ? 'day' : 'days'}.` : 'Train your attention with a short coding drill.'}</p>
        </div>
        <Link href="/derot" className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring">
          Try a de-rot drill<ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </section>

      <p className="text-sm text-muted-foreground">
        Stuck on something, or want a second opinion? Ask your Buddy from the header, any time.
      </p>

      {restricted && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LockKeyhole className="size-3.5" aria-hidden="true" />Reps are paused while your account is restricted. Walkthroughs and De-rot stay open.
        </p>
      )}
    </div>
  )
}
