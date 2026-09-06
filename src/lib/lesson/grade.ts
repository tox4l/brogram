/**
 * Local grading for lesson checks (R3.6). Every non-`micro-code` kind is
 * graded by a pure function here; `micro-code` is graded by the caller
 * running the runtime adapter and handing back the results. No check ever
 * calls an agent, and this module has no access to mastery, points or the
 * integrity score -- checks never punish (R3.7).
 */
import type { LessonCheck, TestResult } from '@/lib/contracts'
import { gradePredictOutput, gradeSpotTheBug } from '@/components/derot/scoring'

export interface CheckVerdict {
  right: boolean
  /** 'hint' after the first wrong answer, 'explain' after the second. Nothing is ever consumed. */
  reveal: 'none' | 'hint' | 'explain'
  /** For `choose`: the line for the option actually chosen -- this is where the teaching happens. */
  why?: string
}

export type CheckAnswer =
  | { kind: 'predict-output'; text: string }
  | { kind: 'choose'; index: number }
  | { kind: 'spot-the-bug'; lines: number[] }
  | { kind: 'fill-blank'; values: Record<string, string> }
  | { kind: 'micro-code'; results: TestResult[] }

function foldAccept(value: string): string {
  return value.trim().toLowerCase()
}

function isRight(check: LessonCheck, answer: CheckAnswer): boolean {
  if (check.kind === 'predict-output' && answer.kind === 'predict-output') {
    return check.normalize === 'exact'
      ? check.expected === answer.text
      : gradePredictOutput(answer.text, check.expected)
  }
  if (check.kind === 'choose' && answer.kind === 'choose') {
    return answer.index === check.correctIndex
  }
  if (check.kind === 'spot-the-bug' && answer.kind === 'spot-the-bug') {
    return answer.lines.length > 0 && answer.lines.every((line) => gradeSpotTheBug(line, check.bugLines))
  }
  if (check.kind === 'fill-blank' && answer.kind === 'fill-blank') {
    return check.blanks.every((blank) => {
      const given = answer.values[blank.id]
      return given !== undefined && blank.accept.some((accepted) => foldAccept(accepted) === foldAccept(given))
    })
  }
  if (check.kind === 'micro-code' && answer.kind === 'micro-code') {
    return answer.results.length > 0 && answer.results.every((r) => r.passed)
  }
  // A mismatched answer kind for this check is a wrong answer, not a broken screen.
  return false
}

export function gradeCheck(check: LessonCheck, answer: CheckAnswer, attemptNumber: number): CheckVerdict {
  const right = isRight(check, answer)
  const reveal = right ? 'none' : attemptNumber <= 1 ? 'hint' : 'explain'
  const why = check.kind === 'choose' && answer.kind === 'choose' ? check.why[answer.index] : undefined
  return { right, reveal, ...(why !== undefined ? { why } : {}) }
}
