/**
 * Local grading for lesson checks (R3.6). Every non-`micro-code` kind is
 * graded by a pure function here; `micro-code` is graded by the caller
 * running the runtime adapter and handing back the results. No check ever
 * calls an agent, and this module has no access to mastery, points or the
 * integrity score -- checks never punish (R3.7).
 */
import type { LessonCheck, LessonPublicBlock, TestResult } from '@/lib/contracts'
import { gradePredictOutput, gradeSpotTheBug } from '@/components/derot/scoring'

/**
 * The check-block shape the client actually holds: identical to `LessonCheck`
 * except a `micro-code` check has no `referenceSolution` (R3.5 strips it at
 * build). `gradeCheck` accepts either so a caller holding a `LessonPublicBlock`
 * check never needs an `as LessonCheck` cast -- that cast is exactly the crack
 * the secrecy rule exists to close.
 */
export type GradableCheck = LessonCheck | Extract<LessonPublicBlock, { type: 'check' }>

export interface CheckVerdict {
  right: boolean
  /** 'hint' after the first wrong answer, 'explain' after the second. A right answer also reveals
   *  'explain' (spec 7.6: the row goes green and explain expands). Nothing is ever consumed. */
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

/** Strip exactly one trailing newline (\n or \r\n), never more -- a snippet's
 *  terminal newline from print() is never the learner's job to type, but an
 *  extra blank line inside (or a second trailing one) is still content. */
function stripTerminalNewline(value: string): string {
  return value.replace(/\r?\n$/, '')
}

function isRight(check: GradableCheck, answer: CheckAnswer): boolean {
  if (check.kind === 'predict-output' && answer.kind === 'predict-output') {
    if (check.normalize === 'exact') {
      // 'exact' is whitespace-sensitive within and between lines, so this
      // stays a strict === -- but a browser textarea can hand back CRLF, and
      // the one terminal newline from a print() is never the learner's job
      // to type, so both are neutralized before the strict compare.
      const expected = stripTerminalNewline(check.expected)
      const given = stripTerminalNewline(answer.text.replace(/\r\n/g, '\n'))
      return expected === given
    }
    return gradePredictOutput(answer.text, check.expected)
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
    // Tied to the check's own tests, not just "some non-empty array of
    // passes" -- a short array, a padded/truncated array, or results that
    // belong to a different check must all grade wrong.
    return (
      answer.results.length === check.tests.length &&
      check.tests.every((t) => answer.results.some((r) => r.testId === t.id && r.passed))
    )
  }
  // A mismatched answer kind for this check is a wrong answer, not a broken screen.
  return false
}

export function gradeCheck(check: GradableCheck, answer: CheckAnswer, attemptNumber: number): CheckVerdict {
  const right = isRight(check, answer)
  // A right answer also reveals 'explain' (spec 7.6): the teaching payoff for
  // getting it right is the explanation, not silence. Only a wrong first
  // attempt gets the softer 'hint'.
  const reveal: CheckVerdict['reveal'] = right || attemptNumber > 1 ? 'explain' : 'hint'
  const why = check.kind === 'choose' && answer.kind === 'choose' ? check.why[answer.index] : undefined
  return { right, reveal, ...(why !== undefined ? { why } : {}) }
}
