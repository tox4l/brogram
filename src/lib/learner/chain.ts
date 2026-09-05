import type { Mastery, PatternId } from '@/lib/contracts'

/** Distinct passes with distinct patterns that close a CLO. */
export const CHAIN_LENGTH = 3

/** The patterns of the chain in progress: the last `chain` entries of patternsPassed. */
function currentChainPatterns(mastery: Mastery): PatternId[] {
  if (mastery.chain <= 0) return []
  return mastery.patternsPassed.slice(-mastery.chain)
}

/**
 * Where a pass leaves the chain, and which patterns the next bank query should prefer.
 *
 * The chain only advances on a pattern it has not already seen; three distinct
 * patterns close the CLO. `preferPatterns` are the CLO's patterns still missing
 * from this chain, in the CLO's own order.
 */
export function nextInChain(
  mastery: Mastery,
  passedPattern: PatternId,
  cloPatterns: PatternId[],
): { chain: number; closed: boolean; preferPatterns: PatternId[] } {
  const inChain = new Set(currentChainPatterns(mastery))
  const chain = inChain.has(passedPattern) ? mastery.chain : mastery.chain + 1
  inChain.add(passedPattern)

  return {
    chain,
    closed: chain >= CHAIN_LENGTH,
    preferPatterns: cloPatterns.filter((pattern) => !inChain.has(pattern)),
  }
}
