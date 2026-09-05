import type { Mastery, PatternId } from '@/lib/contracts'

/** Distinct passes with distinct patterns that close a CLO. */
export const CHAIN_LENGTH = 3

/**
 * `patternsPassed` with `pattern` at the end.
 *
 * The contract stores no separate list for the chain in progress, so the chain
 * is recovered from the ORDER of `patternsPassed`: its last `chain` entries are
 * always exactly the patterns of the current chain. Every pass moves its
 * pattern to the end, which leaves the SET of patterns ever passed unchanged
 * and only rewrites the order.
 */
export function withPatternAtEnd(patternsPassed: PatternId[], pattern: PatternId): PatternId[] {
  return [...patternsPassed.filter((passed) => passed !== pattern), pattern]
}

/** The patterns of the chain in progress: the last `chain` entries of patternsPassed. */
function currentChainPatterns(mastery: Mastery): PatternId[] {
  if (mastery.chain <= 0) return []
  return mastery.patternsPassed.slice(-mastery.chain)
}

/**
 * Where a pass leaves the chain, and which patterns the next bank query should prefer.
 *
 * The chain advances only on a pattern that is not already in the current
 * chain, measured before the pattern moves to the end. Three distinct patterns
 * close the CLO, and a closed CLO stays closed. `preferPatterns` are the CLO's
 * patterns still missing from the resulting chain, in the CLO's own order.
 */
export function nextInChain(
  mastery: Mastery,
  passedPattern: PatternId,
  cloPatterns: PatternId[],
): { chain: number; closed: boolean; preferPatterns: PatternId[] } {
  const before = currentChainPatterns(mastery)
  const advanced = before.includes(passedPattern) ? mastery.chain : mastery.chain + 1

  const patternsPassed = withPatternAtEnd(mastery.patternsPassed, passedPattern)
  const chain = Math.min(advanced, patternsPassed.length)
  const inChain = new Set(patternsPassed.slice(-chain))

  return {
    chain,
    closed: mastery.closed || chain >= CHAIN_LENGTH,
    preferPatterns: cloPatterns.filter((pattern) => !inChain.has(pattern)),
  }
}
