'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { DrillRunner } from '@/components/derot'
import { useCountdown } from '@/components/derot/useCountdown'
import { ComboMeter } from '@/components/derot/ComboMeter'
import { CountdownRing } from '@/components/derot/CountdownRing'
import { RunSummary } from '@/components/derot/RunSummary'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { play, withInterfaceSounds } from '@/lib/sound/manager'
import { line, lineWith } from '@/lib/voice/lines'
import { useSession } from '@/store/session'
import { getQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { buildRewardContext } from '@/lib/rewards/context'
import { recordAchievements, recordGoalDay } from '@/lib/rewards/record'
import { isPersonalBest as computeIsPersonalBest } from '@/lib/rewards/bestRun'
import type { DrillItem, DrillKind, DrillResult, MotionPreference, UserAchievement, WellnessPrefs } from '@/lib/contracts'
import { comboMultiplier } from '@/components/derot/scoring'
import { DRILL_META, computeDerotStreak, dateKey, isDrillKind, lastResultsForKind, mapDrillRow, pickDrillItem, statsForKind } from '../../lib'
import { EMPTY_RUN, RUN_SIZE, buildRunResult, isRunComplete, recordRunAnswer, summarizeRun, type RunState } from '../run'
import { submitRunResult } from '../submit'

type Phase = 'loading' | 'ready' | 'run-complete' | 'empty' | 'error'

/** The pause after an item resolves before the next one appears (or the summary shows), so the child's own inline "Correct."/"Not quite." feedback is visible before it swaps out. Instant under reduced motion. */
const ADVANCE_DELAY_MS = 600

interface RunnerState {
  phase: Phase
  items: DrillItem[]
  /** wellness.drill_results as of page load, every kind -- streak math needs all of them, personal-best math filters to this kind. */
  allResults: DrillResult[]
  /**
   * Item-level results from every run completed THIS page session (fix
   * round 1, I5). Because one run persists as a single aggregate row
   * (`allResults` only ever gains the first item's id), `pickDrillItem`
   * would otherwise see the other five items of every finished run as
   * never-played and re-serve the exact same six items on "Run it again".
   * Never persisted -- purely so the picker sees what this session has
   * actually shown the learner.
   */
  sessionResults: DrillResult[]
  current: DrillItem | null
  run: RunState
  runResult: DrillResult | null
  previousBest: number | null
  motionPref: MotionPreference
  /** The full resolved row, not just `.motion` -- X7/X1 need it (dailyGoal, goalDays, sound) to build a `RewardContext` after a save. */
  prefs: WellnessPrefs
  error: string | null
  saveError: string | null
}

const INITIAL_STATE: RunnerState = {
  phase: 'loading', items: [], allResults: [], sessionResults: [], current: null, run: EMPTY_RUN, runResult: null, previousBest: null, motionPref: 'system', prefs: resolveWellnessPrefs(undefined), error: null, saveError: null,
}

/**
 * `reduced` is read from a ref, not a hook parameter: it depends on
 * `wellness.prefs.motion`, which this same hook loads (`state.motionPref`),
 * so the caller cannot compute it before this hook runs. `setReduced` lets
 * `RunnerBody` keep the ref current every render without that circularity;
 * `onItemResult` reads `reducedRef.current` at call time, so it is always
 * the latest value regardless of when it was last written.
 */
function useArcadeRun(kind: DrillKind, userId: string | null, explicitId: string | null) {
  const [state, setState] = useState<RunnerState>(INITIAL_STATE)
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const reducedRef = useRef(false)
  const learnerState = useSession((session) => session.learnerState)
  const setLearnerState = useSession((session) => session.setLearnerState)
  const learnerStateRef = useRef(learnerState)
  useEffect(() => { learnerStateRef.current = learnerState }, [learnerState])
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current) }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    async function load() {
      try {
        const client = createClient()
        const [drills, wellness] = await Promise.all([
          client.from('drills').select('*').eq('kind', kind),
          client.from('wellness').select('drill_results,prefs').eq('user_id', userId as string).maybeSingle(),
        ])
        if (drills.error || wellness.error) throw new Error('This drill could not open.')
        if (cancelled) return
        const items = (drills.data ?? []).map(mapDrillRow)
        const allResults = (wellness.data?.drill_results ?? []) as DrillResult[]
        const prefs = resolveWellnessPrefs(wellness.data?.prefs)
        if (items.length === 0) { setState({ ...INITIAL_STATE, phase: 'empty', allResults, motionPref: prefs.motion, prefs }); return }
        const forKind = allResults.filter((result) => result.kind === kind)
        const current = pickDrillItem(items, forKind, new Date(), explicitId)
        setState({ ...INITIAL_STATE, phase: 'ready', items, allResults, motionPref: prefs.motion, prefs, current })
      } catch (err) {
        if (!cancelled) setState({ ...INITIAL_STATE, phase: 'error', error: err instanceof Error ? err.message : 'This drill could not open.' })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [kind, userId, explicitId, attempt])

  const submitFinishedRun = useCallback(async (runResult: DrillResult) => {
    if (!userId) return
    try {
      const client = createClient()
      const serverResults = await submitRunResult(client, userId, runResult)
      setState((prev) => ({ ...prev, allResults: serverResults, saveError: null }))

      const learner = learnerStateRef.current
      if (learner) {
        setLearnerState({
          ...learner,
          streak: {
            ...learner.streak,
            derotDays: computeDerotStreak(serverResults.map((r) => r.at)),
            lastDerotDate: dateKey(runResult.at) ?? learner.streak.lastDerotDate,
          },
          updatedAt: new Date().toISOString(),
        })
      }

      // X2: the dashboard's goal ring and de-rot scores read `wellness` through
      // qk.wellness (staleTime/gcTime Infinity, seeded once server-side, never
      // refetched on navigation) -- without this the ring stays at its pre-run
      // count until a hard reload, mirroring useExerciseLoop.ts's own
      // qk.wellness invalidate on its pass path. Only reached once the save
      // above actually succeeded; the catch block below never runs this line,
      // so a failed save invalidates nothing.
      void getQueryClient().invalidateQueries({ queryKey: qk.wellness(userId) })

      // X7 / X1: a finished de-rot run is a win (spec 7.4) and a source for
      // sharp / touch-grass / beat-yourself (7.5) -- neither had a producer.
      // attempts/lessonProgress stay empty and courseLessonCounts stays {}:
      // this hook fetches none of them, so a context built from what it does
      // not have would just be wrong rather than honest. This can only ever
      // delay a goal day or an achievement to whichever caller (exercise
      // loop, lesson) next builds a fuller context, never over-fire one --
      // the same convention useExerciseLoop.ts's own recordGoalAndStreak
      // already established for the fields it cannot see either.
      if (learner) {
        const held = (getQueryClient().getQueryData<UserAchievement[]>(qk.achievements(userId)) ?? []).map((a) => a.achievementId)
        const ctx = buildRewardContext({
          state: learner,
          attempts: [],
          activityDays: [],
          lessonProgress: [],
          drillResults: serverResults,
          prefs: stateRef.current.prefs,
          courseLessonCounts: {},
          now: new Date(runResult.at),
        })
        void recordGoalDay(client, userId, ctx)
        void recordAchievements(client, userId, ctx, held)
      }
    } catch {
      setState((prev) => ({ ...prev, saveError: line('error.save') }))
    }
  }, [userId, setLearnerState])

  const finishRun = useCallback((run: RunState) => {
    const runResult = buildRunResult(run)
    if (!runResult) return
    const previousBest = statsForKind(stateRef.current.allResults, kind).best
    // X8: run-end audio. `withInterfaceSounds` gates `drill.hit` on the
    // interface-sounds toggle (Arcade already forces the same sound on
    // mid-run for itself, spec R7.8); `best` is a reward-tier sound and
    // always plays when it fires. The null guard inside `computeIsPersonalBest`
    // is the same one RunSummary's own badge uses (fix round 1, C2) -- a
    // first run of a kind never earns it.
    withInterfaceSounds(() => play('drill.hit'))
    if (computeIsPersonalBest(previousBest, runResult.score)) play('best')
    setState((prev) => ({
      ...prev,
      phase: 'run-complete',
      run,
      runResult,
      previousBest,
      // Optimistic: this run's own result is folded in immediately so the
      // summary (last runs, personal best) never waits on the network.
      allResults: [...prev.allResults, runResult],
      sessionResults: [...prev.sessionResults, ...run.answers.map((a) => a.result)],
    }))
    void submitFinishedRun(runResult)
  }, [kind, submitFinishedRun])

  const advanceToNext = useCallback((run: RunState) => {
    const { items, allResults, sessionResults } = stateRef.current
    const forKind = [...allResults, ...sessionResults, ...run.answers.map((a) => a.result)].filter((result) => result.kind === kind)
    // A run never repeats its own items (fix round 2, N3): a bank smaller
    // than RUN_SIZE must shorten the run instead of re-serving an item whose
    // answer the learner just saw two picks ago. `summarizeRun`'s per-length
    // normalisation (fix round 1, I2) already makes a shorter run's score
    // honest, so ending early here is a complete fix, not a partial one.
    const shownThisRun = new Set(run.answers.map((a) => a.item.id))
    const current = pickDrillItem(items, forKind, new Date(), null, shownThisRun)
    if (current === null) {
      finishRun(run)
      return
    }
    setState((prev) => ({ ...prev, run, current }))
  }, [kind, finishRun])

  const onItemResult = useCallback((item: DrillItem, result: DrillResult) => {
    // Arcade turns drill.hit/drill.miss on for the duration of a run regardless of the tier toggle: there the tick IS the game (R7.8).
    withInterfaceSounds(() => play(result.correct ? 'drill.hit' : 'drill.miss'))
    const nextRun = recordRunAnswer(stateRef.current.run, item, result)
    const delay = reducedRef.current ? 0 : ADVANCE_DELAY_MS
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(() => {
      if (isRunComplete(nextRun)) finishRun(nextRun)
      else advanceToNext(nextRun)
    }, delay)
    // Reflect the just-answered item's combo state immediately so the meter and ring update in step with the child's own feedback, even during the pause.
    setState((prev) => ({ ...prev, run: nextRun }))
  }, [finishRun, advanceToNext])

  const setReduced = useCallback((value: boolean) => { reducedRef.current = value }, [])

  const retrySave = useCallback(() => {
    if (stateRef.current.runResult) void submitFinishedRun(stateRef.current.runResult)
  }, [submitFinishedRun])

  const playAgain = useCallback(() => {
    const { items, allResults, sessionResults } = stateRef.current
    const forKind = [...allResults, ...sessionResults].filter((result) => result.kind === kind)
    const current = pickDrillItem(items, forKind, new Date())
    setState((prev) => ({ ...prev, phase: 'ready', current, run: EMPTY_RUN, runResult: null, saveError: null }))
  }, [kind])

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'loading', error: null }))
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, retry, onItemResult, retrySave, playAgain, setReduced }
}

/** True while the document is hidden -- an alt-tab, not the old per-page lockdown overlay (fix round 1, I3 / I11: de-rot mounts no lockdown at all). */
function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const onChange = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return hidden
}

function RunnerBody({ kind }: { kind: DrillKind }) {
  const params = useSearchParams()
  const explicitId = params.get('item')
  const userId = useSession((session) => session.user?.id) ?? null
  const runner = useArcadeRun(kind, userId, explicitId)
  const reduced = useReducedMotion(runner.motionPref)
  useEffect(() => { runner.setReduced(reduced) })
  const paused = useDocumentHidden()
  const meta = DRILL_META[kind]

  const lastRuns = lastResultsForKind(runner.allResults, kind, 5)
  const isPersonalBest = runner.previousBest !== null && runner.runResult !== null && runner.runResult.score > runner.previousBest

  return (
    <div className="relative min-w-0 space-y-5">
      <div className="space-y-3">
        <Link href="/derot" className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3" aria-hidden="true" />Back to de-rot
        </Link>
        <h1 className="text-2xl font-medium tracking-tight">{meta.title}</h1>
      </div>

      <div className="space-y-5">
        {runner.saveError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3 text-sm">
            <p className="min-w-0 flex-1">{runner.saveError}</p>
            <Button variant="outline" onClick={runner.retrySave}>Retry save</Button>
          </div>
        )}

        {runner.phase === 'loading' && <p role="status" className="text-sm text-muted-foreground">Opening your drill.</p>}

        {runner.phase === 'error' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
            <p className="text-sm text-foreground">{runner.error}</p>
            <Button variant="outline" onClick={runner.retry}>Try again</Button>
          </div>
        )}

        {runner.phase === 'empty' && (
          <div className="rounded-xl border border-dashed border-input p-6">
            <p className="text-sm font-medium">No items yet</p>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">This drill is still being prepared. Choose another kind from de-rot.</p>
            <Link href="/derot" className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')}>Back to de-rot</Link>
          </div>
        )}

        {runner.phase === 'ready' && runner.current && (
          <div className="mx-auto w-full max-w-2xl space-y-3">
            {/* Composed header (fix round 1, item 12): ring, item counter and combo live in one strip
                directly above the card they belong to, instead of spread across the full page width. */}
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-3">
                <ItemCountdown key={runner.current.id} timeLimitS={runner.current.timeLimitS} reduced={reduced} paused={paused} />
                <p className="font-mono text-xs text-muted-foreground">Item {Math.min(runner.run.answers.length + 1, RUN_SIZE)} of {RUN_SIZE}</p>
              </div>
              {runner.run.streak > 0 && <ComboMeter streak={runner.run.streak} multiplier={comboMultiplier(runner.run.streak)} reduced={reduced} />}
            </div>
            <DrillRunner
              key={runner.current.id}
              item={runner.current}
              onResult={(result) => runner.onItemResult(runner.current as DrillItem, result)}
              paused={paused}
            />
          </div>
        )}

        {runner.phase === 'run-complete' && runner.runResult && (() => {
          const summary = summarizeRun(runner.run)
          return (
            <RunSummary
              title={meta.title}
              score={runner.runResult.score}
              accuracy={summary.accuracy}
              bestCombo={summary.bestCombo}
              itemResults={runner.run.answers.map((a) => a.result.correct)}
              rawLabel={`${summary.rawTotal} combo points`}
              isPersonalBest={isPersonalBest}
              previousBest={runner.previousBest}
              lastRuns={lastRuns}
              // A stable seed (fix round 2, N2): unseeded, `lineWith` picks a
              // fresh random variant on every render, so the line re-rolled
              // itself a few hundred ms after the summary mounted, the moment
              // `submitFinishedRun` resolved and re-rendered with the server's
              // `allResults`. `runResult.at` is unique per run and constant
              // for the summary's whole lifetime -- the same pattern
              // Celebration.tsx uses for its own `line`/`lineWith` calls.
              voiceLine={lineWith('derot.run.done', { n: summary.score, m: summary.bestCombo }, runner.runResult.at)}
              onPlayAgain={runner.playAgain}
              backHref="/derot"
              reduced={reduced}
            />
          )
        })()}
      </div>
    </div>
  )
}

/**
 * A per-item countdown mirror, independent of the child component's own
 * timer (which stays untouched -- the frozen per-kind components own the
 * authoritative clock and submission). Built on the same frozen
 * `useCountdown` hook they use, so it ticks in lockstep without duplicating
 * timer logic; purely visual, it never sets `onExpire` and so never
 * auto-submits. The caller remounts this via `key={item.id}` on every new
 * item, exactly like DrillRunner, so the clock restarts cleanly. `paused`
 * mirrors the same flag passed to the real per-kind component (fix round 1,
 * I3) so the ring visually freezes in sync with the timer it represents,
 * rather than drifting from a clock that has actually stopped underneath it.
 */
function ItemCountdown({ timeLimitS, reduced, paused }: { timeLimitS: number; reduced: boolean; paused: boolean }) {
  const { remainingMs, percentRemaining } = useCountdown({ timeLimitS, active: !paused })
  return <CountdownRing remainingMs={remainingMs} percentRemaining={percentRemaining} reduced={reduced} tickEnabled />
}

function InvalidKind() {
  return (
    <div className="space-y-4 py-10">
      <h1 className="text-2xl font-medium tracking-tight">This drill could not open</h1>
      <p className="text-sm text-muted-foreground">Choose a drill kind from the de-rot section.</p>
      <Link href="/derot" className={buttonVariants({ variant: 'outline' })}>Back to de-rot</Link>
    </div>
  )
}

export default function DerotArcadeRunnerPage() {
  const { kind } = useParams<{ kind: string }>()
  if (!isDrillKind(kind)) return <InvalidKind />
  return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Opening your drill.</p>}><RunnerBody key={kind} kind={kind} /></Suspense>
}
