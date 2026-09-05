import { describe, it, expect } from 'vitest'
import type { Mastery } from '@/lib/contracts'
import { nextInChain } from './chain'
import { applyPass, applyFail } from './score'

const CLO_PATTERNS = ['loop-accumulate', 'guard-clause', 'two-pointer', 'dict-count']

function mastery(over: Partial<Mastery> = {}): Mastery {
  return {
    userId: 'user-1',
    cloId: 'INFS1101-3',
    score: 0,
    chain: 0,
    patternsPassed: [],
    closed: false,
    lastAttemptAt: null,
    ...over,
  }
}

describe('nextInChain', () => {
  it('closes the CLO after three distinct patterns', () => {
    let m = mastery()
    let step = nextInChain(m, 'loop-accumulate', CLO_PATTERNS)
    expect(step.chain).toBe(1)
    expect(step.closed).toBe(false)
    expect(step.preferPatterns).toEqual(['guard-clause', 'two-pointer', 'dict-count'])

    m = applyPass(m, 3, 'loop-accumulate', 70, 0).mastery
    step = nextInChain(m, 'guard-clause', CLO_PATTERNS)
    expect(step.chain).toBe(2)
    expect(step.closed).toBe(false)
    expect(step.preferPatterns).toEqual(['two-pointer', 'dict-count'])

    m = applyPass(m, 3, 'guard-clause', 70, 0).mastery
    step = nextInChain(m, 'two-pointer', CLO_PATTERNS)
    expect(step.chain).toBe(3)
    expect(step.closed).toBe(true)
    expect(step.preferPatterns).toEqual(['dict-count'])

    m = applyPass(m, 3, 'two-pointer', 70, 0).mastery
    expect(m.chain).toBe(3)
    expect(m.closed).toBe(true)
    expect(m.patternsPassed).toEqual(['loop-accumulate', 'guard-clause', 'two-pointer'])
  })

  it('does not advance when the same pattern is passed twice in one chain', () => {
    const m = applyPass(mastery(), 3, 'loop-accumulate', 70, 0).mastery
    const step = nextInChain(m, 'loop-accumulate', CLO_PATTERNS)

    expect(step.chain).toBe(1)
    expect(step.closed).toBe(false)
    expect(step.preferPatterns).toEqual(['guard-clause', 'two-pointer', 'dict-count'])

    const again = applyPass(m, 3, 'loop-accumulate', 70, 0).mastery
    expect(again.chain).toBe(1)
    expect(again.patternsPassed).toEqual(['loop-accumulate'])
    expect(again.closed).toBe(false)
  })

  it('counts only the patterns of the current chain, not every pattern ever passed', () => {
    const m = mastery({ chain: 1, patternsPassed: ['guard-clause', 'loop-accumulate'] })
    const step = nextInChain(m, 'guard-clause', CLO_PATTERNS)

    expect(step.chain).toBe(2)
    expect(step.preferPatterns).toEqual(['two-pointer', 'dict-count'])
  })
})

describe('a fail in the middle of a chain', () => {
  it('resets the chain to 0 and keeps patternsPassed', () => {
    let m = applyPass(mastery(), 3, 'loop-accumulate', 70, 0).mastery
    m = applyPass(m, 3, 'guard-clause', 70, 0).mastery
    expect(m.chain).toBe(2)

    const failed = applyFail(m, 3)
    expect(failed.chain).toBe(0)
    expect(failed.closed).toBe(false)
    expect(failed.patternsPassed).toEqual(['loop-accumulate', 'guard-clause'])

    const step = nextInChain(failed, 'two-pointer', CLO_PATTERNS)
    expect(step.chain).toBe(1)
    expect(step.closed).toBe(false)
  })
})
