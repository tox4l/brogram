'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useLockdown } from '@/hooks/useLockdown'
import { LockdownOverlay } from '@/components/exercise/LockdownOverlay'
import { DrillRunner } from '@/components/derot'
import { useCountdown } from '@/components/derot/useCountdown'
import { ComboMeter } from '@/components/derot/ComboMeter'
import { CountdownRing } from '@/components/derot/CountdownRing'
import { RunSummary } from '@/components/derot/RunSummary'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { play, withInterfaceSounds } from '@/lib/sound/manager'
import { useSession } from '@/store/session'
import type { DrillItem, DrillKind, DrillResult } from '@/lib/contracts'
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
  current: DrillItem | null
  run: RunState
  runResult: DrillResult | null
  previousBest: number | null
  error: string | null
  saveError: string | null
}

const INITIAL_STATE: RunnerState = { phase: 'loading', items: [], allResults: [], current: null, run: EMPTY_RUN, runResult: null, previousBest: null, error: null, saveError: null }

function useArcadeRun(kind: DrillKind, userId: string | null, explicitId: string | null, reduced: boolean) {
  const [state, setState] = useState<RunnerState>(INITIAL_STATE)
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
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
          client.from('wellness').select('drill_results').eq('user_id', userId as string).maybeSingle(),
        ])
        if (drills.error || wellness.error) throw new Error('This drill could not open.')
        if (cancelled) return
        const items = (drills.data ?? []).map(mapDrillRow)
        const allResults = (wellness.data?.drill_results ?? []) as DrillResult[]
        if (items.length === 0) { setState({ ...INITIAL_STATE, phase: 'empty', allResults }); return }
        const forKind = allResults.filter((result) => result.kind === kind)
        const current = pickDrillItem(items, forKind, new Date(), explicitId)
        setState({ ...INITIAL_STATE, phase: 'ready', items, allResults, current })
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
    } catch {
      setState((prev) => ({ ...prev, saveError: 'Your run could not be saved. Check your connection, then try again.' }))
    }
  }, [userId, setLearnerState])

  const finishRun = useCallback((run: RunState) => {
    const runResult = buildRunResult(run)
    if (!runResult) return
    setState((prev) => {
      const previousBest = statsForKind(prev.allResults, kind).best
      // Optimistic: this run's own result is folded in immediately so the
      // summary (last runs, personal best) never waits on the network.
      return { ...prev, phase: 'run-complete', run, runResult, previousBest, allResults: [...prev.allResults, runResult] }
    })
    void submitFinishedRun(runResult)
  }, [kind, submitFinishedRun])

  const advanceToNext = useCallback((run: RunState) => {
    const { items, allResults } = stateRef.current
    const forKind = [...allResults, ...run.answers.map((a) => a.result)].filter((result) => result.kind === kind)
    const current = pickDrillItem(items, forKind, new Date())
    setState((prev) => ({ ...prev, run, current }))
  }, [kind])

  const onItemResult = useCallback((item: DrillItem, result: DrillResult) => {
    // Arcade turns drill.hit/drill.miss on for the duration of a run regardless of the tier toggle: there the tick IS the game (R7.8).
    withInterfaceSounds(() => play(result.correct ? 'drill.hit' : 'drill.miss'))
    const nextRun = recordRunAnswer(stateRef.current.run, item, result)
    const delay = reduced ? 0 : ADVANCE_DELAY_MS
    if (advanceTimer.current) clearTimeout(advanceTimer.current)
    advanceTimer.current = setTimeout(() => {
      if (isRunComplete(nextRun)) finishRun(nextRun)
      else advanceToNext(nextRun)
    }, delay)
    // Reflect the just-answered item's combo state immediately so the meter and ring update in step with the child's own feedback, even during the pause.
    setState((prev) => ({ ...prev, run: nextRun }))
  }, [reduced, finishRun, advanceToNext])

  const retrySave = useCallback(() => {
    if (stateRef.current.runResult) void submitFinishedRun(stateRef.current.runResult)
  }, [submitFinishedRun])

  const playAgain = useCallback(() => {
    const { items, allResults } = stateRef.current
    const forKind = allResults.filter((result) => result.kind === kind)
    const current = pickDrillItem(items, forKind, new Date())
    setState((prev) => ({ ...prev, phase: 'ready', current, run: EMPTY_RUN, runResult: null, saveError: null }))
  }, [kind])

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'loading', error: null }))
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, retry, onItemResult, retrySave, playAgain }
}

function RunnerBody({ kind }: { kind: DrillKind }) {
  const params = useSearchParams()
  const explicitId = params.get('item')
  const userId = useSession((session) => session.user?.id) ?? null
  const reduced = useReducedMotion()
  const runner = useArcadeRun(kind, userId, explicitId, reduced)
  const meta = DRILL_META[kind]

  // exercise_id is a uuid column; a drill id is not one, so this screen logs
  // with a null exercise reference. idleGuard is off for hold-focus, whose
  // own blur/scroll voids are the reading guard -- the 15s idle overlay would
  // otherwise cover a student who is reading, not idle.
  const lockdown = useLockdown(null, { enabled: Boolean(runner.current), idleGuard: runner.current?.kind !== 'hold-focus' })

  const lastRuns = lastResultsForKind(runner.allResults, kind, 5)
  const isPersonalBest = runner.runResult !== null && runner.runResult.score > (runner.previousBest ?? -1)

  return (
    <div {...lockdown.containerProps} className="relative min-w-0 space-y-5">
      <div className="space-y-3" inert={Boolean(lockdown.overlay)}>
        <Link href="/derot" className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3" aria-hidden="true" />Back to de-rot
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-medium tracking-tight">{meta.title}</h1>
          {runner.phase === 'ready' && (
            <p className="font-mono text-xs text-muted-foreground">Item {runner.run.answers.length + 1} of {RUN_SIZE}</p>
          )}
        </div>
      </div>

      <div inert={Boolean(lockdown.overlay)} className="space-y-5">
        {lockdown.pasteMessage && <p role="status" className="text-sm text-muted-foreground">{lockdown.pasteMessage}</p>}
        {lockdown.loggingError && <p role="alert" className="text-sm text-muted-foreground">{lockdown.loggingError}</p>}
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
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <ItemCountdown key={runner.current.id} timeLimitS={runner.current.timeLimitS} reduced={reduced} />
              <ComboMeter streak={runner.run.streak} multiplier={comboMultiplier(runner.run.streak)} reduced={reduced} />
            </div>
            <DrillRunner
              key={runner.current.id}
              item={runner.current}
              onResult={(result) => runner.onItemResult(runner.current as DrillItem, result)}
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
              rawLabel={`${summary.rawTotal} raw points, combo-weighted`}
              isPersonalBest={isPersonalBest}
              previousBest={runner.previousBest}
              lastRuns={lastRuns}
              voiceLine={voiceLineFor(isPersonalBest, summary.accuracy)}
              onPlayAgain={runner.playAgain}
              backHref="/derot"
              reduced={reduced}
            />
          )
        })()}
      </div>
      <LockdownOverlay reason={lockdown.overlay} onResume={lockdown.resume} />
    </div>
  )
}

/** Plain strings pending the T2.7a/T2.7b voice bank -- see the T2.9a report. */
function voiceLineFor(isPersonalBest: boolean, accuracy: number): string {
  if (isPersonalBest) return 'New personal best. Run it again.'
  if (accuracy >= 0.8) return 'Sharp run. Keep the streak going.'
  if (accuracy >= 0.5) return 'Solid run. A little more focus next time.'
  return 'Rough one. Shake it off and go again.'
}

/**
 * A per-item countdown mirror, independent of the child component's own
 * timer (which stays untouched -- the frozen per-kind components own the
 * authoritative clock and submission). Built on the same frozen
 * `useCountdown` hook they use, so it ticks in lockstep without duplicating
 * timer logic; purely visual, it never sets `onExpire` and so never
 * auto-submits. The caller remounts this via `key={item.id}` on every new
 * item, exactly like DrillRunner, so the clock restarts cleanly.
 */
function ItemCountdown({ timeLimitS, reduced }: { timeLimitS: number; reduced: boolean }) {
  const { remainingMs, percentRemaining } = useCountdown({ timeLimitS })
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
