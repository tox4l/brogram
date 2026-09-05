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

describe('the chain is recoverable from the order of patternsPassed', () => {
  const [A, B, C] = CLO_PATTERNS
  const pass = (m: Mastery, pattern: string) => applyPass(m, 3, pattern, 70, 0).mastery

  it('closes on A, B, fail, A, B, C', () => {
    let m = pass(pass(mastery(), A), B)
    m = applyFail(m, 3)
    expect(m.chain).toBe(0)

    m = pass(m, A)
    expect(m.chain).toBe(1)
    expect(m.patternsPassed.slice(-m.chain)).toEqual([A])

    m = pass(m, B)
    expect(m.chain).toBe(2)
    expect(m.patternsPassed.slice(-m.chain)).toEqual([A, B])

    m = pass(m, C)
    expect(m.chain).toBe(3)
    expect(m.closed).toBe(true)
    expect(m.patternsPassed.slice(-m.chain)).toEqual([A, B, C])
    expect([...m.patternsPassed].sort()).toEqual([A, B, C].sort())
  })

  it('leaves A, A, A at chain 1 with the CLO open', () => {
    const m = pass(pass(pass(mastery(), A), A), A)

    expect(m.chain).toBe(1)
    expect(m.closed).toBe(false)
    expect(m.patternsPassed).toEqual([A])
  })

  it('closes on A, B, A, C', () => {
    let m = pass(pass(mastery(), A), B)

    m = pass(m, A)
    expect(m.chain).toBe(2)
    expect(m.patternsPassed).toEqual([B, A])

    m = pass(m, C)
    expect(m.chain).toBe(3)
    expect(m.closed).toBe(true)
    expect(m.patternsPassed.slice(-3)).toEqual([B, A, C])
  })

  it('prefers exactly the other CLO patterns after A, B, fail, A', () => {
    const failed = applyFail(pass(pass(mastery(), A), B), 3)

    const onA = nextInChain(failed, A, CLO_PATTERNS)
    expect(onA.chain).toBe(1)
    expect(onA.preferPatterns).toEqual(CLO_PATTERNS.filter((pattern) => pattern !== A))

    const m = pass(failed, A)
    expect(m.patternsPassed).toEqual([B, A])

    const onB = nextInChain(m, B, CLO_PATTERNS)
    expect(onB.chain).toBe(2)
    expect(onB.preferPatterns).toEqual(CLO_PATTERNS.filter((pattern) => pattern !== A && pattern !== B))
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
