/**
 * The only vocabulary a learner sees. Internal words (CLO, mastery, chain,
 * pattern, difficulty N of 5) are translated here, once, at the edge — see
 * docs/superpowers/specs/2026-09-06-brogram-v2-bro.md §2.6. Admin and reports
 * may still use the internal words directly; this module is for anything
 * learner-facing.
 *
 * All eleven rows of §2.6's table get a function here (fix round 1, I13 —
 * the frozen interface block named only four; T2.7b Step 2 needs the rest).
 * "de-rot" is the twelfth row, and is deliberately not translated — it is
 * the owner's own word, kept as-is, so there is nothing to wrap in a function.
 */

import type { Difficulty } from '@/lib/contracts'

/** CLO / learning outcome -> skill. */
export function skillWord(): 'skill' {
  return 'skill'
}

/** `Clo.outcome` sentence -> "what this skill is". */
export function skillDescriptionWord(): 'what this skill is' {
  return 'what this skill is'
}

const DIFFICULTY_WORDS: Record<Difficulty, 'easy' | 'light' | 'medium' | 'spicy' | 'brutal'> = {
  1: 'easy',
  2: 'light',
  3: 'medium',
  4: 'spicy',
  5: 'brutal',
}

/** difficulty 3 of 5 -> medium (1 easy, 2 light, 3 medium, 4 spicy, 5 brutal). */
export function difficultyWord(d: Difficulty): 'easy' | 'light' | 'medium' | 'spicy' | 'brutal' {
  return DIFFICULTY_WORDS[d]
}

/** chain 1/2/3 -> "2 of 3 in a row". Clamped: call sites control `n`, but a stray 0 or 7 costs nothing to guard against. */
export function chainWord(n: number): string {
  const clamped = Math.min(Math.max(Math.round(n), 1), 3)
  return `${clamped} of 3 in a row`
}

/** mastery score -> "how locked in you are" (a bar, not a number). */
export function masteryWord(): 'how locked in you are' {
  return 'how locked in you are'
}

/** CLO closed -> "skill locked". */
export function skillLockedWord(): 'skill locked' {
  return 'skill locked'
}

/** pattern -> "angle" (as in "a different angle on the same skill"). */
export function angleWord(): 'angle' {
  return 'angle'
}

/** bank / exercise -> "rep". */
export function repWord(): 'rep' {
  return 'rep'
}

/** lesson -> "walkthrough". */
export function walkthroughWord(): 'walkthrough' {
  return 'walkthrough'
}

/** attempt -> "run" (free) / "submit" (graded). */
export function attemptWord(kind: 'free' | 'graded'): 'run' | 'submit' {
  return kind === 'free' ? 'run' : 'submit'
}

/** integrity score -> "flags". */
export function flagsWord(): 'flags' {
  return 'flags'
}
