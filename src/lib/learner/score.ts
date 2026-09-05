import type { Difficulty, Mastery, PatternId } from '@/lib/contracts'
import { pointsForPass, nextMasteryScore } from '@/lib/contracts'
import { nextInChain } from './chain'

/** The scoring rules are product decisions and live in the contracts; this module applies them to a Mastery row. */
export { pointsForPass, nextMasteryScore }

/**
 * A pass: mastery score up, pattern recorded, chain advanced when the pattern
 * is new in this chain, CLO closed at three. Returns the points the attempt
 * earned so the screen can add them without recomputing the arguments.
 */
export function applyPass(
  mastery: Mastery,
  difficulty: Difficulty,
  pattern: PatternId,
  quality: number,
  hintCount: number,
): { mastery: Mastery; points: number } {
  const { chain, closed } = nextInChain(mastery, pattern, [])

  return {
    mastery: {
      ...mastery,
      score: nextMasteryScore(mastery.score, true, difficulty),
      chain,
      closed: mastery.closed || closed,
      patternsPassed: mastery.patternsPassed.includes(pattern) ? [...mastery.patternsPassed] : [...mastery.patternsPassed, pattern],
      lastAttemptAt: new Date().toISOString(),
    },
    points: pointsForPass(difficulty, hintCount, quality),
  }
}

/** A fail: mastery score down, chain back to zero, patternsPassed and a closed CLO untouched. */
export function applyFail(mastery: Mastery, difficulty: Difficulty): Mastery {
  return {
    ...mastery,
    score: nextMasteryScore(mastery.score, false, difficulty),
    chain: 0,
    patternsPassed: [...mastery.patternsPassed],
    lastAttemptAt: new Date().toISOString(),
  }
}
