import { describe, it, expect } from 'vitest'
import type { Mastery } from '@/lib/contracts'
import { pointsForPass, nextMasteryScore, applyPass, applyFail } from './score'

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

describe('pointsForPass', () => {
  it('pointsForPass(3, 0, 90) is 345', () => {
    expect(pointsForPass(3, 0, 90)).toBe(345)
  })

  it('pointsForPass(1, 5, 0) is 50', () => {
    expect(pointsForPass(1, 5, 0)).toBe(50)
  })
})

describe('nextMasteryScore', () => {
  it('nextMasteryScore(95, true, 5) is 100', () => {
    expect(nextMasteryScore(95, true, 5)).toBe(100)
  })

  it('nextMasteryScore(3, false, 1) is 0', () => {
    expect(nextMasteryScore(3, false, 1)).toBe(0)
  })
})

describe('applyPass', () => {
  it('raises the score, appends the pattern, advances the chain and stamps the attempt', () => {
    const before = mastery({ score: 40 })
    const { mastery: after, points } = applyPass(before, 3, 'loop-accumulate', 90, 0)

    expect(after.score).toBe(54)
    expect(after.patternsPassed).toEqual(['loop-accumulate'])
    expect(after.chain).toBe(1)
    expect(after.closed).toBe(false)
    expect(points).toBe(345)
    expect(typeof after.lastAttemptAt).toBe('string')
    expect(Number.isNaN(Date.parse(after.lastAttemptAt as string))).toBe(false)
  })

  it('does not mutate the mastery it was given', () => {
    const before = mastery()
    applyPass(before, 3, 'loop-accumulate', 90, 0)
    expect(before).toEqual(mastery())
  })

  it('never records the same pattern twice in patternsPassed', () => {
    const first = applyPass(mastery(), 3, 'loop-accumulate', 70, 0).mastery
    const second = applyPass(applyFail(first, 3), 3, 'loop-accumulate', 70, 0).mastery
    expect(second.patternsPassed).toEqual(['loop-accumulate'])
  })

  it('scores points from difficulty, hints and quality', () => {
    expect(applyPass(mastery(), 1, 'p', 0, 5).points).toBe(50)
  })

  it('moves a repeated pattern to the end of patternsPassed instead of duplicating it', () => {
    const pass = (m: Mastery, pattern: string) => applyPass(m, 3, pattern, 70, 0).mastery
    const m = pass(pass(pass(mastery(), 'a'), 'b'), 'a')

    expect(m.patternsPassed).toEqual(['b', 'a'])
    expect(m.chain).toBe(2)
    expect(m.patternsPassed.slice(-m.chain)).toEqual(['b', 'a'])
  })

  it('caps the chain at patternsPassed.length and keeps a closed CLO closed on a fourth distinct pass', () => {
    const pass = (m: Mastery, pattern: string) => applyPass(m, 3, pattern, 70, 0).mastery
    let m = pass(pass(pass(mastery(), 'a'), 'b'), 'c')
    expect(m.chain).toBe(3)
    expect(m.closed).toBe(true)

    m = pass(m, 'd')
    expect(m.patternsPassed).toEqual(['a', 'b', 'c', 'd'])
    expect(m.chain).toBe(m.patternsPassed.length)
    expect(m.closed).toBe(true)

    const inconsistent = pass(mastery({ chain: 9, patternsPassed: ['a'] }), 'b')
    expect(inconsistent.chain).toBe(inconsistent.patternsPassed.length)
  })
})

describe('applyFail', () => {
  it('lowers the score, resets the chain and keeps patternsPassed', () => {
    const before = mastery({ score: 30, chain: 2, patternsPassed: ['a', 'b'] })
    const after = applyFail(before, 1)

    expect(after.score).toBe(25)
    expect(after.chain).toBe(0)
    expect(after.patternsPassed).toEqual(['a', 'b'])
    expect(typeof after.lastAttemptAt).toBe('string')
  })

  it('floors the score at 0 and does not mutate its input', () => {
    const before = mastery({ score: 3 })
    expect(applyFail(before, 1).score).toBe(0)
    expect(before.score).toBe(3)
  })
})
