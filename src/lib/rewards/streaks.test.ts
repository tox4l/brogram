import { describe, expect, it } from 'vitest'
import { MILESTONES, crossedMilestone, flameState } from './streaks'

describe('MILESTONES', () => {
  it('is exactly 3, 7, 14, 30, 50, 100', () => {
    expect(MILESTONES).toEqual([3, 7, 14, 30, 50, 100])
  })
})

describe('flameState', () => {
  // utcHour === localHour below simulates a UTC+0 learner, isolating the
  // local-hour arm of "at risk" -- the cross-timezone arm gets its own
  // dedicated tests further down (Important 4, fix round 1).

  it('is cold at streak 0', () => {
    expect(flameState(0, false, 10, 10, false)).toBe('cold')
    expect(flameState(0, true, 10, 10, false)).toBe('cold')
  })

  it('is lit once the streak is alive and today is already counted', () => {
    expect(flameState(5, true, 10, 10, false)).toBe('lit')
    expect(flameState(5, true, 23, 23, false)).toBe('lit')
  })

  it('is lit for a live streak not yet counted today, before the at-risk hour', () => {
    // Not yet urgent: spec 7.4 never frames the earlier part of the day as at
    // risk, and there is no state between "cold" and "at risk" for this.
    expect(flameState(5, false, 9, 9, false)).toBe('lit')
    expect(flameState(5, false, 17, 17, false)).toBe('lit')
  })

  it('is at-risk once local time reaches 18:00 with nothing counted today', () => {
    expect(flameState(5, false, 18, 18, false)).toBe('at-risk')
    expect(flameState(5, false, 23, 23, false)).toBe('at-risk')
  })

  it('is never at-risk once today is already counted, regardless of hour', () => {
    expect(flameState(5, true, 22, 22, false)).toBe('lit')
  })

  it("is ignite on the day's first qualifying action (post-action call), for a non-milestone streak", () => {
    // Post-action call shape: justTransitioned=true right after the action
    // that produced this streak count.
    expect(flameState(1, false, 10, 10, true)).toBe('ignite')
    expect(flameState(4, false, 10, 10, true)).toBe('ignite')
    expect(flameState(8, false, 10, 10, true)).toBe('ignite')
  })

  it('is milestone when the freshly-counted streak lands on a milestone (post-action call)', () => {
    for (const milestone of MILESTONES) {
      expect(flameState(milestone, false, 10, 10, true)).toBe('milestone')
    }
  })

  // Important 2 / Ruling 3 (fix round 1): the on-load call shape is its own
  // call site, distinct from the post-action one above -- both must be
  // exercised directly or `reset` and the on-load `lit` read ship dead.

  it('on-load call: reset when the mount check finds the streak already expired since the last visit', () => {
    // The check that runs once on mount compares the freshly loaded streak
    // against what the caller last knew and finds it broke -- streak is 0
    // here, not a fresh count, so this is called with justTransitioned=true.
    expect(flameState(0, false, 9, 9, true)).toBe('reset')
    expect(flameState(0, false, 22, 22, true)).toBe('reset')
  })

  it('on-load call: a mount that finds the streak still alive is not a transition -- reads lit/at-risk normally', () => {
    // Finding the streak intact is not itself a transition worth flagging,
    // so this is called with justTransitioned=false, same as any other quiet
    // render -- it must never read as `ignite` just because it happens on load.
    expect(flameState(5, true, 10, 10, false)).toBe('lit')
    expect(flameState(5, false, 9, 9, false)).toBe('lit')
    expect(flameState(5, false, 19, 19, false)).toBe('at-risk')
  })

  // Important 4 (fix round 1): the streak day rolls on UTC, not local time,
  // so "at risk" must also fire off the UTC hour -- otherwise a learner east
  // of UTC reads calm minutes before the streak actually dies.

  it('is at-risk from the UTC clock alone, even while local time reads early morning (Doha, UTC+3)', () => {
    // 01:00 local in Doha (UTC+3) is 22:00 UTC the same streak-day -- two
    // hours left before the UTC roll that actually ends the streak.
    expect(flameState(5, false, 1, 22, false)).toBe('at-risk')
  })

  it('is still lit when neither clock has reached the at-risk hour', () => {
    // 09:00 local in Doha (UTC+3) is 06:00 UTC -- plenty of the streak day left.
    expect(flameState(5, false, 9, 6, false)).toBe('lit')
  })

  it('is at-risk from the local clock alone even when the UTC hour is early (west of UTC)', () => {
    // 19:00 local in Los Angeles (UTC-7) is 02:00 UTC the next calendar day --
    // the local evening cue still fires on its own.
    expect(flameState(5, false, 19, 2, false)).toBe('at-risk')
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
