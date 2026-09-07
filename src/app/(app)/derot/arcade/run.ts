/**
 * The Arcade run model (spec 7.9 step 1 / T2.9a). A run is six items of one
 * kind, tracked entirely client-side while it is in progress: the combo
 * streak, the best combo reached, and a combo-weighted running total.
 *
 * Exactly ONE `DrillResult` is ever produced for a completed run -- never
 * one per item. The rewards predicates `sharp` / `touch-grass`
 * (src/lib/rewards/achievements.ts) and the daily win count in
 * src/lib/rewards/goal.ts count `drillResults` rows directly as "a run
 * completed"; six rows for one run would inflate both by 6x and could clear
 * a daily goal on a single run. This is a controller correction on top of
 * the Opus review of T2.5 -- see docs/build-log.md.
 */
import type { DrillItem, DrillResult } from '@/lib/contracts'
import { clamp, comboMultiplier, nextComboStreak, weightedItemScore } from '@/components/derot/scoring'

export const RUN_SIZE = 6

/** One item answered during the run, kept only in memory. */
export interface RunAnswer {
  item: DrillItem
  result: DrillResult
}

export interface RunState {
  answers: RunAnswer[]
  /** Current consecutive-correct streak; a miss resets this to zero (never the run). */
  streak: number
  /** The highest streak reached at any point in the run. */
  bestCombo: number
  /** Combo-weighted sum of item scores so far -- can run well past 100. */
  weightedTotal: number
}

export const EMPTY_RUN: RunState = { answers: [], streak: 0, bestCombo: 0, weightedTotal: 0 }

export function isRunComplete(state: RunState): boolean {
  return state.answers.length >= RUN_SIZE
}

/**
 * Folds one submitted item result into the run. A run is exactly RUN_SIZE
 * items regardless of correctness -- a miss lowers the running total and
 * resets the streak, it never ends the run early. Once complete, further
 * calls are a no-op so a stray extra submit can never grow a run past six.
 */
export function recordRunAnswer(state: RunState, item: DrillItem, result: DrillResult): RunState {
  if (isRunComplete(state)) return state
  const streak = nextComboStreak(state.streak, result.correct)
  const weighted = weightedItemScore(result.score, streak, result.correct)
  return {
    answers: [...state.answers, { item, result }],
    streak,
    bestCombo: Math.max(state.bestCombo, streak),
    weightedTotal: state.weightedTotal + weighted,
  }
}

/**
 * The weighted total a run reaches when every item is a perfect (100) hit --
 * the combo ramp (1x, 1.2x, 1.5x, 2x) means no run can actually reach
 * `itemCount * 100 * 2`, since the multiplier only reaches its cap a few
 * items in. This is the true ceiling `summarizeRun` normalises against, so a
 * flawless run always lands at exactly 100, not some unreachable fraction of
 * it -- computed from the RUN'S OWN length (fix round 1, I2), not the
 * module-level `RUN_SIZE` constant: a partial run (built via a future path,
 * or reused by a Playground game of a different length) must normalise
 * against its own achievable ceiling, not silently divide by six-item math
 * it never played.
 */
function perfectRunCeiling(itemCount: number): number {
  let total = 0
  for (let streak = 1; streak <= itemCount; streak += 1) total += 100 * comboMultiplier(streak)
  return total
}

export interface RunSummaryStats {
  /** Normalised 0-100 -- this is what becomes the run's single DrillResult.score. */
  score: number
  /** Combo-weighted raw total before normalisation -- the "interesting number" shown on the summary. */
  rawTotal: number
  accuracy: number
  bestCombo: number
  itemCount: number
  correctCount: number
}

export function summarizeRun(state: RunState): RunSummaryStats {
  const itemCount = state.answers.length
  const correctCount = state.answers.filter((answer) => answer.result.correct).length
  const ceiling = perfectRunCeiling(itemCount)
  return {
    score: ceiling === 0 ? 0 : clamp(0, 100, Math.round((state.weightedTotal / ceiling) * 100)),
    rawTotal: state.weightedTotal,
    accuracy: itemCount === 0 ? 0 : correctCount / itemCount,
    bestCombo: state.bestCombo,
    itemCount,
    correctCount,
  }
}

/**
 * The single DrillResult a completed run submits (R7.6b, and the rewards
 * fix above): one row per run, never one per item.
 *
 * `drillId` is the first item's id -- the frozen contract has no run-id --
 * `timeMs` is the run's total elapsed time across every item, and `correct`
 * is a majority verdict (at least half the items right): no single boolean
 * can describe six answers, and no reward predicate reads it today (`sharp`
 * / `touch-grass` count rows by lane, `winsToday` counts rows landed on a
 * day, `beatYourself` compares `score` -- none reads `correct`; verified
 * independently by the Opus review, fix round 1).
 *
 * LANDMINE (upheld as a latent simplification, not a bug): `correctCount * 2
 * >= itemCount` means a 3-of-6 run and a 6-of-6 run are BOTH stored as
 * `correct: true`. Harmless while nothing reads the field -- not harmless
 * the day a predicate reads `DrillResult.correct` for an Arcade row and
 * assumes it means "passed" the way it does for every other drill kind.
 * Check `correctCount`/`itemCount` intent before adding that reader.
 */
export function buildRunResult(state: RunState, now: () => number = Date.now): DrillResult | null {
  if (state.answers.length === 0) return null
  const first = state.answers[0]
  const summary = summarizeRun(state)
  const timeMs = state.answers.reduce((sum, answer) => sum + answer.result.timeMs, 0)
  return {
    drillId: first.result.drillId,
    kind: first.item.kind,
    correct: summary.correctCount * 2 >= summary.itemCount,
    timeMs,
    score: summary.score,
    at: new Date(now()).toISOString(),
    lane: first.item.lane,
  }
}
