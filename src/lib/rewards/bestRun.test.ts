import { describe, expect, it } from 'vitest'
import { isPersonalBest } from './bestRun'

describe('isPersonalBest', () => {
  it('is true on a strict improvement over a real previous best', () => {
    expect(isPersonalBest(50, 51)).toBe(true)
  })

  it('is false on a tie or a lower score', () => {
    expect(isPersonalBest(50, 50)).toBe(false)
    expect(isPersonalBest(50, 49)).toBe(false)
  })

  it('is false on a first-ever run of a kind -- null never counts as beaten, whatever the score', () => {
    expect(isPersonalBest(null, 0)).toBe(false)
    expect(isPersonalBest(null, 100)).toBe(false)
  })
})
