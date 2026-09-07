'use client'

/**
 * `/derot/play/[game]` -- Playground lane runner (spec 7.9 Lane B, 10.9).
 * Mirrors the Arcade runner's shape deliberately (same RunSummary, same
 * submit path, same streak update) so the two lanes feel like one product:
 * validate the id, a three-two-one start, mount the game, submit exactly one
 * DrillResult with lane 'play' through T2.9a's append helper.
 *
 * Unlike Arcade, a Playground game is code, not a seeded DB row (R7.5): its
 * `drillId` is the synthetic `play-<kind>` id the seed loader writes, and
 * there is no `drills` table read here at all.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { RunSummary } from '@/components/derot/RunSummary'
import {
  normalizeBreathe,
  normalizeColorNBack,
  normalizeFollowTheDot,
  normalizeMemoryGrid,
  normalizeReaction,
  normalizeRhythm,
  type NormalizedScore,
} from '@/components/derot/scoring'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useSession } from '@/store/session'
import type { DrillResult, WellnessPrefs } from '@/lib/contracts'
import { DRILL_META, computeDerotStreak, dateKey, isPlayKind, lastResultsForKind, statsForKind } from '../../lib'
import { submitRunResult } from '../../arcade/submit'
import type { PlayGameComponent, PlayGameId, PlayGameResult } from '@/components/derot/play/types'

/** Spec 7.9's Playground table, verbatim. Playground games are code, not DB rows, so this lives here rather than in a `drills` fetch. */
const PLAY_TIME_LIMIT_S: Record<PlayGameId, number> = {
  'follow-the-dot': 75,
  'color-nback': 90,
  reaction: 60,
  rhythm: 60,
  breathe: 90,
  'memory-grid': 90,
}

/**
 * `next/dynamic` by id (brief step: "a registry in the route file that maps
 * all six ids"). Agent B's three files land in the same commit window as
 * this route under this same task, so until they exist on disk this map
 * fails to typecheck/build -- expected and called out in the brief; it
 * compiles clean once `ColorBack.tsx`, `Breathe.tsx` and `MemoryGrid.tsx`
 * land. Each entry is only ever asked to resolve when that specific game is
 * actually played, never eagerly at module load.
 */
const GAME_COMPONENTS: Record<PlayGameId, PlayGameComponent> = {
  'follow-the-dot': dynamic(() => import('@/components/derot/play/FollowTheDot'), { ssr: false }),
  'color-nback': dynamic(() => import('@/components/derot/play/ColorBack'), { ssr: false }),
  reaction: dynamic(() => import('@/components/derot/play/Twitch'), { ssr: false }),
  rhythm: dynamic(() => import('@/components/derot/play/KeepTime'), { ssr: false }),
  breathe: dynamic(() => import('@/components/derot/play/Breathe'), { ssr: false }),
  'memory-grid': dynamic(() => import('@/components/derot/play/MemoryGrid'), { ssr: false }),
}

/**
 * Each game hands back its own primitive metric that the matching
 * `normalize*` function in scoring.ts expects as its own argument -- but not
 * always in `raw`. Follow the Dot, Twitch, Keep Time and Breathe (this
 * route's three plus Agent B's Breathe) all put the primitive itself in
 * `raw` (a share, a mean ms, a percent). Colour Back needs three numbers to
 * grade (hits, false alarms, planted matches), which do not fit a single
 * `raw` field, so that triple travels in `payload` instead. Grid's `raw` is
 * the spec table's already-scaled display figure (`roundsCleared * 250`),
 * with the primitive `roundsCleared` alongside it in `payload` -- read from
 * there instead, matching what MemoryGrid.tsx actually emits.
 */
function scoreForGame(game: PlayGameId, result: PlayGameResult): NormalizedScore {
  switch (game) {
    case 'follow-the-dot':
      return normalizeFollowTheDot(result.raw)
    case 'color-nback': {
      const payload = result.payload as { hits?: number; falseAlarms?: number; plantedMatches?: number }
      return normalizeColorNBack(payload.hits ?? 0, payload.falseAlarms ?? 0, payload.plantedMatches ?? 0)
    }
    case 'reaction':
      return normalizeReaction(result.raw)
    case 'rhythm':
      return normalizeRhythm(result.raw)
    case 'breathe':
      return normalizeBreathe(result.raw)
    case 'memory-grid': {
      const payload = result.payload as { roundsCleared?: number }
      return normalizeMemoryGrid(payload.roundsCleared ?? 0)
    }
  }
}

/**
 * The value stamped into `DrillResult.timeMs` -- the frozen contract has no
 * spare field for a Playground game's own raw metric (T2.9a's seam note), so
 * it lives here, same as the four timed Arcade kinds repurpose the field.
 * Every game's primitive is already a meaningful "ms"-shaped or count-shaped
 * number except follow-the-dot's, which is a 0..1 share -- scaled by 1000
 * (the same scaling the spec's own table and `normalizeFollowTheDot`'s own
 * display `raw` use) so it reads as a real number instead of rounding to 0 or 1.
 * Grid's primitive round count lives in `payload`, not `raw` -- see `scoreForGame`.
 */
function timeMsForGame(game: PlayGameId, result: PlayGameResult, normalized: NormalizedScore): number {
  if (game === 'follow-the-dot') return normalized.raw
  if (game === 'memory-grid') return Math.round((result.payload as { roundsCleared?: number }).roundsCleared ?? 0)
  return Math.round(result.raw)
}

function buildDrillResult(game: PlayGameId, result: PlayGameResult, now: () => number = Date.now): DrillResult {
  const normalized = scoreForGame(game, result)
  return {
    drillId: `play-${game}`,
    kind: game,
    // R7.4: Playground has no judgment -- a completed run is never graded pass/fail, and nothing
    // downstream reads `correct` for a `lane: 'play'` row (rewards/report both key off `score`).
    correct: true,
    timeMs: timeMsForGame(game, result, normalized),
    score: normalized.score,
    at: new Date(now()).toISOString(),
    lane: 'play',
  }
}

type Phase = 'loading' | 'countdown' | 'playing' | 'complete' | 'error'

interface RunnerState {
  phase: Phase
  prefs: WellnessPrefs
  allResults: DrillResult[]
  runResult: DrillResult | null
  previousBest: number | null
  error: string | null
  saveError: string | null
}

function initialState(): RunnerState {
  return { phase: 'loading', prefs: resolveWellnessPrefs(undefined), allResults: [], runResult: null, previousBest: null, error: null, saveError: null }
}

function usePlayRun(game: PlayGameId, userId: string | null) {
  const [state, setState] = useState<RunnerState>(initialState)
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })
  const learnerState = useSession((session) => session.learnerState)
  const setLearnerState = useSession((session) => session.setLearnerState)
  const learnerStateRef = useRef(learnerState)
  useEffect(() => { learnerStateRef.current = learnerState })

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    async function load() {
      try {
        const client = createClient()
        const { data, error } = await client.from('wellness').select('prefs,drill_results').eq('user_id', userId as string).maybeSingle()
        if (error) throw new Error('This game could not open.')
        if (cancelled) return
        const prefs = resolveWellnessPrefs((data as { prefs?: unknown } | null)?.prefs)
        const allResults = ((data as { drill_results?: DrillResult[] } | null)?.drill_results ?? []) as DrillResult[]
        setState({ ...initialState(), phase: 'countdown', prefs, allResults })
      } catch (err) {
        if (!cancelled) setState({ ...initialState(), phase: 'error', error: err instanceof Error ? err.message : 'This game could not open.' })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [game, userId, attempt])

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

  const finishGame = useCallback((result: PlayGameResult) => {
    const runResult = buildDrillResult(game, result)
    setState((prev) => {
      const previousBest = statsForKind(prev.allResults, game).best
      // Optimistic, exactly like Arcade: this run's own row is folded in immediately so the
      // summary (last runs, personal best) never waits on the network.
      return { ...prev, phase: 'complete', runResult, previousBest, allResults: [...prev.allResults, runResult] }
    })
    void submitFinishedRun(runResult)
  }, [game, submitFinishedRun])

  const retrySave = useCallback(() => {
    if (stateRef.current.runResult) void submitFinishedRun(stateRef.current.runResult)
  }, [submitFinishedRun])

  const playAgain = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'countdown', runResult: null, saveError: null }))
  }, [])

  const startPlaying = useCallback(() => {
    setState((prev) => (prev.phase === 'countdown' ? { ...prev, phase: 'playing' } : prev))
  }, [])

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'loading', error: null }))
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, retry, finishGame, retrySave, playAgain, startPlaying }
}

/** Spec 10.9: "Ready (a three-two-one start so nobody is caught cold)." Instant under reduced motion rather than removed, matching Arcade's own advance-delay pattern. */
function ThreeTwoOne({ reduced, onDone }: { reduced: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const labels = ['3', '2', '1', 'Go']
  useEffect(() => {
    const delay = reduced ? 0 : step === labels.length - 1 ? 500 : 700
    const id = setTimeout(() => {
      if (step >= labels.length - 1) onDone()
      else setStep((s) => s + 1)
    }, delay)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labels is a fixed literal, intentionally not a dependency
  }, [step, reduced, onDone])

  return (
    <div role="status" aria-live="polite" className="flex h-72 w-full items-center justify-center rounded-xl border border-border bg-muted/40">
      <span className="font-mono text-6xl font-semibold tabular-nums text-foreground">{labels[step]}</span>
    </div>
  )
}

/** Plain strings pending the T2.7a/T2.7b voice bank -- mirrors Arcade's own voiceLineFor exactly (T2.9a report). */
function voiceLineFor(isPersonalBest: boolean, score: number): string {
  if (isPersonalBest) return 'New personal best. Run it again.'
  if (score >= 80) return 'Sharp run. Keep the streak going.'
  if (score >= 50) return 'Solid run. A little more focus next time.'
  return 'Rough one. Shake it off and go again.'
}

/** The run summary's "interesting number" (T2.9a's phrase) -- built from `timeMs`, which is where this game's own primitive raw metric lives (see `timeMsForGame`). */
function rawLabelFor(game: PlayGameId, timeMs: number): string {
  switch (game) {
    case 'follow-the-dot': return `${Math.round(timeMs / 10)}% of frames inside the dot`
    case 'reaction': return `${Math.round(timeMs)} ms mean reaction`
    case 'rhythm': return `${Math.round(timeMs)} ms mean offset from the beat`
    case 'color-nback': return `${Math.round(timeMs)} net hits`
    case 'breathe': return `${Math.round(timeMs)}% of the pacer completed`
    case 'memory-grid': return `${Math.round(timeMs)} rounds cleared`
  }
}

function RunnerBody({ game }: { game: PlayGameId }) {
  const router = useRouter()
  const userId = useSession((session) => session.user?.id) ?? null
  const runner = usePlayRun(game, userId)
  const reducedMotion = useReducedMotion(runner.prefs.motion)
  const soundOn = runner.prefs.sound.interface
  const meta = DRILL_META[game]
  const GameComponent = GAME_COMPONENTS[game]
  const timeLimitS = PLAY_TIME_LIMIT_S[game]

  const onAbort = useCallback(() => router.push('/derot'), [router])

  const lastRuns = lastResultsForKind(runner.allResults, game, 5)
  const isPersonalBest = runner.runResult !== null && runner.runResult.score > (runner.previousBest ?? -1)

  return (
    <div className="relative min-w-0 space-y-5">
      <div className="space-y-3">
        <Link href="/derot" className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3" aria-hidden="true" />Back to de-rot
        </Link>
        <h1 className="text-2xl font-medium tracking-tight">{meta.title}</h1>
      </div>

      {runner.phase === 'loading' && <p role="status" className="text-sm text-muted-foreground">Opening your game.</p>}

      {runner.phase === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
          <p className="text-sm text-foreground">{runner.error}</p>
          <Button variant="outline" onClick={runner.retry}>Try again</Button>
        </div>
      )}

      {runner.saveError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3 text-sm">
          <p className="min-w-0 flex-1">{runner.saveError}</p>
          <Button variant="outline" onClick={runner.retrySave}>Retry save</Button>
        </div>
      )}

      {runner.phase === 'countdown' && <ThreeTwoOne reduced={reducedMotion} onDone={runner.startPlaying} />}

      {runner.phase === 'playing' && (
        <GameComponent
          timeLimitS={timeLimitS}
          soundOn={soundOn}
          reducedMotion={reducedMotion}
          onComplete={runner.finishGame}
          onAbort={onAbort}
        />
      )}

      {runner.phase === 'complete' && runner.runResult && (
        <RunSummary
          title={meta.title}
          score={runner.runResult.score}
          accuracy={runner.runResult.score / 100}
          rawLabel={rawLabelFor(game, runner.runResult.timeMs)}
          isPersonalBest={isPersonalBest}
          previousBest={runner.previousBest}
          lastRuns={lastRuns}
          voiceLine={voiceLineFor(isPersonalBest, runner.runResult.score)}
          onPlayAgain={runner.playAgain}
          backHref="/derot"
          reduced={reducedMotion}
        />
      )}
    </div>
  )
}

export default function DerotPlayRunnerPage() {
  const { game } = useParams<{ game: string }>()
  if (!isPlayKind(game)) return <InvalidGame />
  return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Opening your game.</p>}><RunnerBody key={game} game={game as PlayGameId} /></Suspense>
}

function InvalidGame() {
  return (
    <div className="space-y-4 py-10">
      <h1 className="text-2xl font-medium tracking-tight">This game could not open</h1>
      <p className="text-sm text-muted-foreground">Choose a game from the de-rot Playground lane.</p>
      <Link href="/derot" className={buttonVariants({ variant: 'outline' })}>Back to de-rot</Link>
    </div>
  )
}
