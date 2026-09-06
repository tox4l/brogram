import { describe, expect, it } from 'vitest'
import type { DrillItem, DrillResult } from '@/lib/contracts'
import { computeDerotStreak, isDrillKind, mapDrillRow, pickDrillItem, statsForKind } from './lib'

function result(overrides: Partial<DrillResult> = {}): DrillResult {
  return { drillId: 'd1', kind: 'trace', correct: true, timeMs: 1000, score: 80, at: '2026-09-06T10:00:00.000Z', ...overrides }
}

function item(overrides: Partial<DrillItem> = {}): DrillItem {
  return { id: 'd1', kind: 'trace', difficulty: 3, payload: {}, timeLimitS: 60, ...overrides }
}

describe('isDrillKind', () => {
  it('accepts only the six known kinds', () => {
    expect(isDrillKind('trace')).toBe(true)
    expect(isDrillKind('speed-type')).toBe(true)
    expect(isDrillKind('made-up')).toBe(false)
    expect(isDrillKind(null)).toBe(false)
    expect(isDrillKind(undefined)).toBe(false)
  })
})

describe('mapDrillRow', () => {
  it('maps a snake_case drills row to a DrillItem', () => {
    const mapped = mapDrillRow({ id: 'trace-001', kind: 'trace', language: 'python', difficulty: 2, time_limit_s: 90, payload: { steps: 3 } })
    expect(mapped).toEqual({ id: 'trace-001', kind: 'trace', language: 'python', difficulty: 2, payload: { steps: 3 }, timeLimitS: 90 })
  })

  it('falls back to sane defaults for a malformed row', () => {
    const mapped = mapDrillRow({ id: 'x', kind: 'trace', difficulty: 'not-a-number', payload: null })
    expect(mapped.difficulty).toBe(3)
    expect(mapped.payload).toEqual({})
    expect(mapped.timeLimitS).toBe(60)
    expect(mapped.language).toBeUndefined()
  })
})

describe('statsForKind', () => {
  it('reports not attempted when there are no results for the kind', () => {
    expect(statsForKind([result({ kind: 'n-back' })], 'trace')).toEqual({ attempted: false, best: null, last: null, lastAt: null })
  })

  it('reports the highest score as best and the most recent as last', () => {
    const results = [
      result({ drillId: 'd1', score: 60, at: '2026-09-04T10:00:00.000Z' }),
      result({ drillId: 'd2', score: 95, at: '2026-09-05T10:00:00.000Z' }),
      result({ drillId: 'd3', score: 70, at: '2026-09-06T10:00:00.000Z' }),
    ]
    expect(statsForKind(results, 'trace')).toEqual({ attempted: true, best: 95, last: 70, lastAt: '2026-09-06T10:00:00.000Z' })
  })
})

describe('computeDerotStreak', () => {
  const now = new Date('2026-09-06T18:00:00.000Z')

  it('counts a streak once per day even with multiple results on the same day', () => {
    const timestamps = ['2026-09-06T08:00:00.000Z', '2026-09-06T09:00:00.000Z', '2026-09-05T08:00:00.000Z', '2026-09-04T08:00:00.000Z']
    expect(computeDerotStreak(timestamps, now)).toBe(3)
  })

  it('stays alive when the most recent day is yesterday', () => {
    expect(computeDerotStreak(['2026-09-05T08:00:00.000Z', '2026-09-04T08:00:00.000Z'], now)).toBe(2)
  })

  it('breaks on a gap and resets to zero when the run is not current', () => {
    expect(computeDerotStreak(['2026-09-03T08:00:00.000Z', '2026-09-01T08:00:00.000Z'], now)).toBe(0)
  })

  it('returns zero for no results', () => {
    expect(computeDerotStreak([], now)).toBe(0)
  })
})

describe('pickDrillItem', () => {
  const now = new Date('2026-09-06T18:00:00.000Z')

  it('returns null when there are no items', () => {
    expect(pickDrillItem([], [], now)).toBeNull()
  })

  it('honors an explicit deep-link id over any other rule', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' })]
    expect(pickDrillItem(items, [], now, 'b')?.id).toBe('b')
  })

  it('falls back to normal picking when the explicit id is not one of the items', () => {
    const items = [item({ id: 'a', difficulty: 3 })]
    expect(pickDrillItem(items, [], now, 'does-not-exist')?.id).toBe('a')
  })

  it('prefers a never-played item over one already played, even when its difficulty is farther from target', () => {
    const items = [item({ id: 'played', difficulty: 5 }), item({ id: 'fresh', difficulty: 1 })]
    // Played on a previous day: not "completed today", so it survives that filter,
    // but it is still "ever played". A high recent score pushes the target difficulty
    // toward 5, favoring "played" on difficulty alone -- but never-played must still win.
    const results = [result({ drillId: 'played', score: 95, at: '2026-09-01T08:00:00.000Z' })]
    expect(pickDrillItem(items, results, now)?.id).toBe('fresh')
  })

  it('prefers an item not yet completed today over one already completed today', () => {
    const items = [item({ id: 'today', difficulty: 3 }), item({ id: 'other-day', difficulty: 3 })]
    const results = [
      result({ drillId: 'today', score: 80, at: '2026-09-06T08:00:00.000Z' }),
      result({ drillId: 'other-day', score: 80, at: '2026-09-01T08:00:00.000Z' }),
    ]
    expect(pickDrillItem(items, results, now)?.id).toBe('other-day')
  })

  it('picks the difficulty closest to recent scores among the remaining candidates', () => {
    const items = [item({ id: 'easy', difficulty: 1 }), item({ id: 'hard', difficulty: 5 })]
    const results = [result({ drillId: 'other', score: 100, at: '2026-09-06T08:00:00.000Z' })]
    expect(pickDrillItem(items, results, now)?.id).toBe('hard')
  })
})
