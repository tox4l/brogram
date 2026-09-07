/**
 * Pure grading and scoring functions for the six de-rot drills.
 *
 * Every formula here is a controller ruling on top of spec section 11
 * (docs/superpowers/specs/2026-09-05-brogram-design.md). Kept side-effect
 * free so components stay thin and every rule has a direct unit test.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Score for the four timed drills whose grading is a single correct/incorrect
 * verdict (predict-output, spot-the-bug, trace, hold-focus): full credit for
 * an instant answer, decaying to a floor of 50 as the time limit is used up.
 * Wrong answers always score 0. Clamped to [50, 100] so a backwards clock
 * (elapsedMs < 0) can never push the score past 100.
 */
export function scoreTimedCorrect(correct: boolean, elapsedMs: number, timeLimitS: number): number {
  if (!correct) return 0
  const totalMs = timeLimitS * 1000
  const ratio = totalMs > 0 ? elapsedMs / totalMs : 1
  return clamp(50, 100, Math.round(100 * (1 - 0.5 * ratio)))
}

// ---------------------------------------------------------------------------
// predict-output: normalized string match
// ---------------------------------------------------------------------------

/**
 * Normalize line by line: trim each line and collapse runs of spaces/tabs
 * within it, drop trailing empty lines, then rejoin with '\n'. Newlines are
 * never collapsed into spaces -- a one-line answer must not match a
 * multi-line expected output (or vice versa).
 */
export function normalizeOutput(value: string): string {
  const lines = value.split('\n').map((line) => line.trim().replace(/[ \t]+/g, ' '))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

export function gradePredictOutput(input: string, expectedOutput: string): boolean {
  return normalizeOutput(input) === normalizeOutput(expectedOutput)
}

// ---------------------------------------------------------------------------
// spot-the-bug: clicked line in the bug-line set
// ---------------------------------------------------------------------------

export function gradeSpotTheBug(clickedLine: number | null, bugLines: number[]): boolean {
  return clickedLine !== null && bugLines.includes(clickedLine)
}

// ---------------------------------------------------------------------------
// trace: every variable cell matches exactly (trimmed)
// ---------------------------------------------------------------------------

export function gradeTrace(answers: Record<string, string>, expected: Record<string, string>): boolean {
  return Object.keys(expected).every((name) => (answers[name] ?? '').trim() === expected[name].trim())
}

// ---------------------------------------------------------------------------
// hold-focus: chosen option matches the answer index
// ---------------------------------------------------------------------------

export function gradeHoldFocus(selectedIndex: number | null, answerIndex: number): boolean {
  return selectedIndex === answerIndex
}

// ---------------------------------------------------------------------------
// n-back: hits minus false alarms against the planted matches
// ---------------------------------------------------------------------------

/** How many positions in the token stream are an actual n-back match. */
export function countPlantedMatches(tokens: string[], n: number): number {
  let count = 0
  for (let i = n; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - n]) count++
  }
  return count
}

export interface NBackGrade {
  correct: boolean
  score: number
}

export function gradeNBack(hits: number, falseAlarms: number, plantedMatches: number): NBackGrade {
  const net = hits - falseAlarms
  if (plantedMatches === 0) {
    // Nothing was plantable to hit; there is nothing to grade as correct.
    return { correct: false, score: 0 }
  }
  return {
    correct: net >= plantedMatches / 2,
    score: clamp(0, 100, Math.round((100 * net) / plantedMatches)),
  }
}

// ---------------------------------------------------------------------------
// speed-type: character accuracy against the snippet
// ---------------------------------------------------------------------------

/** Matching characters at each position, over the snippet length. Extra typed characters past the snippet are ignored. */
export function computeAccuracy(typed: string, snippet: string): number {
  if (snippet.length === 0) return typed.length === 0 ? 1 : 0
  let matches = 0
  for (let i = 0; i < snippet.length; i++) {
    if (typed[i] === snippet[i]) matches++
  }
  return matches / snippet.length
}

export interface SpeedTypeGrade {
  correct: boolean
  score: number
  accuracy: number
}

export function gradeSpeedType(typed: string, snippet: string): SpeedTypeGrade {
  const accuracy = computeAccuracy(typed, snippet)
  return {
    correct: accuracy >= 0.95,
    score: Math.round(100 * accuracy),
    accuracy,
  }
}

// ---------------------------------------------------------------------------
// Arcade run combo (spec 7.9 / T2.9a step 1): consecutive correct answers
// multiply the item's score for the RUN total only. The persisted
// `DrillResult.score` from the grading functions above is never touched by
// this -- a miss resets the multiplier, never the run itself, so the caller
// keeps accumulating raw scores (at 1x) after a miss rather than ending.
// ---------------------------------------------------------------------------

/** 1x for the first hit in a fresh streak, then 1.2x, 1.5x, 2x -- capped there. */
const COMBO_STEPS: readonly number[] = [1, 1.2, 1.5, 2]

export function comboMultiplier(streak: number): number {
  if (streak <= 0) return 1
  return COMBO_STEPS[Math.min(streak, COMBO_STEPS.length) - 1]
}

/** A correct answer extends the streak by one; a miss resets it to zero. */
export function nextComboStreak(streak: number, correct: boolean): number {
  return correct ? streak + 1 : 0
}

/** The run-total contribution of one item: its own 0-100 score, times the combo multiplier earned by this answer (1x on a miss). */
export function weightedItemScore(score: number, streakAfterThisItem: number, correct: boolean): number {
  const multiplier = correct ? comboMultiplier(streakAfterThisItem) : 1
  return Math.round(score * multiplier)
}

// ---------------------------------------------------------------------------
// Playground score normalisation (R7.6a). Every raw formula in spec 7.9's
// table can run past 100 -- sometimes into the thousands -- but every
// DrillResult.score must land in [0, 100] so a Playground run compares
// against an Arcade kind in the same report table and the same
// personal-best comparison. Each function below is pure and returns the
// game's own untouched `raw` figure (the number worth showing on the run
// summary -- "842 ms mean reaction") alongside the normalised `score` that
// actually becomes DrillResult.score. Personal bests compare `score` within
// one kind only, per R7.6a -- `raw` is display-only.
// ---------------------------------------------------------------------------

export interface NormalizedScore {
  /** The game's own raw figure (spec 7.9's table), untouched. Shown on the run summary, never persisted as `score`. */
  raw: number
  /** Always in [0, 100]. This is what becomes DrillResult.score. */
  score: number
}

/** Follow the Dot: raw = share of frames inside the dot (0..1) times 1000. */
export function normalizeFollowTheDot(shareInside: number): NormalizedScore {
  const share = clamp(0, 1, shareInside)
  return { raw: Math.round(share * 1000), score: clamp(0, 100, Math.round(share * 100)) }
}

/**
 * Colour Back: raw = (hits - falseAlarms) times 100. Normalised the same way
 * gradeNBack normalises the Arcade n-back -- net hits over the plantable
 * matches -- so the two n-back-shaped drills stay consistent in intent.
 */
export function normalizeColorNBack(hits: number, falseAlarms: number, plantedMatches: number): NormalizedScore {
  const net = hits - falseAlarms
  const raw = net * 100
  const score = plantedMatches <= 0 ? 0 : clamp(0, 100, Math.round((100 * net) / plantedMatches))
  return { raw, score }
}

/** Twitch: raw = 10000 minus mean reaction ms, floored at 0 -- already a 0..10000 scale. */
export function normalizeReaction(meanReactionMs: number): NormalizedScore {
  const raw = Math.max(0, 10000 - meanReactionMs)
  return { raw, score: clamp(0, 100, Math.round(raw / 100)) }
}

/**
 * Keep Time: raw = mean absolute offset in ms, inverted against a tolerance
 * window -- past the window the beat is missed entirely and the score is 0.
 * `toleranceMs` is exposed as a parameter (default below) so the Playground
 * implementation can tune it to its actual tempo mechanics without this
 * function's shape changing.
 */
export const RHYTHM_OFFSET_TOLERANCE_MS = 500

export function normalizeRhythm(meanAbsOffsetMs: number, toleranceMs: number = RHYTHM_OFFSET_TOLERANCE_MS): NormalizedScore {
  const raw = Math.max(0, toleranceMs - meanAbsOffsetMs)
  const score = toleranceMs <= 0 ? 0 : clamp(0, 100, Math.round((raw / toleranceMs) * 100))
  return { raw, score }
}

/** Breathe: raw = completion percentage. Cannot be failed (spec 7.9) -- score always mirrors raw. */
export function normalizeBreathe(completionPercent: number): NormalizedScore {
  const score = clamp(0, 100, Math.round(completionPercent))
  return { raw: completionPercent, score }
}

/**
 * Grid: raw = rounds cleared times 250, normalised against a realistic
 * ceiling for a growing 4x4 pattern. `maxRounds` is a parameter (default
 * below) for the same reason as `normalizeRhythm`'s tolerance.
 */
export const MEMORY_GRID_MAX_ROUNDS = 12

export function normalizeMemoryGrid(roundsCleared: number, maxRounds: number = MEMORY_GRID_MAX_ROUNDS): NormalizedScore {
  const raw = roundsCleared * 250
  const score = maxRounds <= 0 ? 0 : clamp(0, 100, Math.round((roundsCleared / maxRounds) * 100))
  return { raw, score }
}
