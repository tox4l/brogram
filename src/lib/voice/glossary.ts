/**
 * The only vocabulary a learner sees. Internal words (CLO, mastery, chain,
 * pattern, difficulty N of 5) are translated here, once, at the edge — see
 * docs/superpowers/specs/2026-09-06-brogram-v2-bro.md §2.6. Admin and reports
 * may still use the internal words directly; this module is for anything
 * learner-facing.
 */

import type { Difficulty } from '@/lib/contracts'

/** CLO / learning outcome -> skill. */
export function skillWord(): 'skill' {
  return 'skill'
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

/** chain 1/2/3 -> "2 of 3 in a row". */
export function chainWord(n: number): string {
  return `${n} of 3 in a row`
}

/** mastery score -> "how locked in you are" (a bar, not a number). */
export function masteryWord(): 'how locked in you are' {
  return 'how locked in you are'
}
