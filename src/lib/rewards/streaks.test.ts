import { describe, expect, it } from 'vitest'
import { MILESTONES, crossedMilestone, flameState } from './streaks'

describe('MILESTONES', () => {
  it('is exactly 3, 7, 14, 30, 50, 100', () => {
    expect(MILESTONES).toEqual([3, 7, 14, 30, 50, 100])
  })
})

describe('flameState', () => {
  it('is cold at streak 0', () => {
    expect(flameState(0, false, 10, false)).toBe('cold')
    expect(flameState(0, true, 10, false)).toBe('cold')
  })

  it('is lit once the streak is alive and today is already counted', () => {
    expect(flameState(5, true, 10, false)).toBe('lit')
    expect(flameState(5, true, 23, false)).toBe('lit')
  })

  it('is lit for a live streak not yet counted today, before the at-risk hour', () => {
    // Not yet urgent: spec 7.4 never frames the earlier part of the day as at
    // risk, and there is no state between "cold" and "at risk" for this.
    expect(flameState(5, false, 9, false)).toBe('lit')
    expect(flameState(5, false, 17, false)).toBe('lit')
  })

  it('is at-risk once local time reaches 18:00 with nothing counted today', () => {
    expect(flameState(5, false, 18, false)).toBe('at-risk')
    expect(flameState(5, false, 23, false)).toBe('at-risk')
  })

  it('is never at-risk once today is already counted, regardless of hour', () => {
    expect(flameState(5, true, 22, false)).toBe('lit')
  })

  it('is ignite on the day\'s first qualifying action, for a non-milestone streak', () => {
    expect(flameState(1, false, 10, true)).toBe('ignite')
    expect(flameState(4, false, 10, true)).toBe('ignite')
    expect(flameState(8, false, 10, true)).toBe('ignite')
  })

  it('is milestone when the freshly-counted streak lands on a milestone', () => {
    for (const milestone of MILESTONES) {
      expect(flameState(milestone, false, 10, true)).toBe('milestone')
    }
  })

  it('is reset when a fresh evaluation lands on zero', () => {
    expect(flameState(0, false, 10, true)).toBe('reset')
  })
})

describe('crossedMilestone', () => {
  it('reports the milestone crossed by a small forward step', () => {
    expect(crossedMilestone(2, 3)).toBe(3)
    expect(crossedMilestone(6, 7)).toBe(7)
    expect(crossedMilestone(29, 30)).toBe(30)
  })

  it('returns null when the step does not reach a milestone', () => {
    expect(crossedMilestone(0, 1)).toBeNull()
    expect(crossedMilestone(3, 3)).toBeNull()
    expect(crossedMilestone(4, 6)).toBeNull()
  })

  it('reports the highest milestone crossed when a jump skips over more than one', () => {
    expect(crossedMilestone(2, 8)).toBe(7)
    expect(crossedMilestone(0, 100)).toBe(100)
  })

  it('returns null past the last milestone', () => {
    expect(crossedMilestone(100, 105)).toBeNull()
  })

  it('returns null when the streak did not move forward (a reset-and-restart that lands lower)', () => {
    expect(crossedMilestone(10, 2)).toBeNull()
    expect(crossedMilestone(30, 30)).toBeNull()
  })
})
