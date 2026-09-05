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
