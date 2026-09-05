import { describe, expect, it } from 'vitest'
import type { Attempt, Clo, DrillResult, LearnerState, Mastery, MistakeRecord } from '@/lib/contracts'
import {
  deriveDrillScores,
  deriveFocusLine,
  deriveMasteryRows,
  deriveMistakeTrend,
  derivePatternsPassed,
  deriveTimeSpent,
  formatDuration,
  formatReportDate,
  MAX_MASTERY_ROWS,
} from './derive'

function makeProfile(): LearnerState['profile'] {
  return {
    displayName: 'Test Student',
    learningStyle: 'mixed',
    styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
    tone: 'supportive',
    verbosity: 'short',
    motivation: { why: 'grades', beyondCourses: false, depth: 'pass', wantsAgenticCoding: false },
    onboardingComplete: true,
  }
}

function makeState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'u1',
    profile: makeProfile(),
    currentCourse: 'INFS1101',
    path: [],
    nextExerciseIds: [],
    mastery: {},
    recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0,
    integrityScore: 0,
    accountStatus: 'active',
    version: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeClo(overrides: Partial<Clo> = {}): Clo {
  return {
    id: 'INFS1101-1',
    course: 'INFS1101',
    ordinal: 1,
    outcome: 'Write a loop',
    topics: [],
    prerequisites: [],
    patterns: ['accumulate'],
    assessableInCode: true,
    ...overrides,
  }
}

function makeMastery(overrides: Partial<Mastery> = {}): Mastery {
  return {
    userId: 'u1',
    cloId: 'INFS1101-1',
    score: 40,
    chain: 1,
    patternsPassed: ['accumulate'],
    closed: false,
    lastAttemptAt: null,
    ...overrides,
  }
}

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    userId: 'u1',
    exerciseId: 'e1',
    code: 'code',
    results: [],
    passed: true,
    durationMs: 60000,
    hintCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMistake(overrides: Partial<MistakeRecord> = {}): MistakeRecord {
  return {
    exerciseId: 'e1',
    cloId: 'INFS1101-1',
    pattern: 'accumulate',
    label: 'off-by-one',
    at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeDrill(overrides: Partial<DrillResult> = {}): DrillResult {
  return {
    drillId: 'd1',
    kind: 'trace',
    correct: true,
    timeMs: 1000,
    score: 80,
    at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('formatDuration', () => {
  it('formats zero as 0m', () => {
    expect(formatDuration(0)).toBe('0m')
  })

  it('formats minutes only under an hour', () => {
    expect(formatDuration(45 * 60000)).toBe('45m')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(2 * 3600000 + 15 * 60000)).toBe('2h 15m')
  })
})

describe('formatReportDate', () => {
  it('formats an ISO date in UTC as a long date', () => {
    expect(formatReportDate('2026-09-05T00:00:00.000Z')).toBe('September 5, 2026')
  })

  it('falls back to the raw string on an invalid date instead of throwing', () => {
    expect(formatReportDate('not-a-date')).toBe('not-a-date')
  })
})

describe('deriveMasteryRows', () => {
  it('renders no rows without throwing when there is no course and no CLOs', () => {
    const state = makeState({ currentCourse: null })
    expect(deriveMasteryRows(state, [])).toEqual([])
  })

  it('orders CLOs of the current course by ordinal, defaulting CLOs with no mastery row yet, and drops other courses', () => {
    const state = makeState({
      mastery: {
        'INFS1101-2': makeMastery({ cloId: 'INFS1101-2', score: 75, chain: 2, closed: true, patternsPassed: ['accumulate', 'filter'] }),
      },
    })
    const clos = [
      makeClo({ id: 'INFS1101-2', ordinal: 2, outcome: 'Use conditionals' }),
      makeClo({ id: 'INFS1101-1', ordinal: 1, outcome: 'Write a loop' }),
      makeClo({ id: 'OTHER-1', course: 'OTHER', ordinal: 1, outcome: 'Not this course' }),
    ]
    const rows = deriveMasteryRows(state, clos)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ cloId: 'INFS1101-1', score: 0, chain: 0, closed: false, patternsPassed: [] })
    expect(rows[1]).toMatchObject({ cloId: 'INFS1101-2', score: 75, chain: 2, closed: true, patternsPassed: ['accumulate', 'filter'] })
  })

  it('caps at MAX_MASTERY_ROWS', () => {
    const state = makeState()
    const clos = Array.from({ length: MAX_MASTERY_ROWS + 5 }, (_, i) => makeClo({ id: `INFS1101-${i + 1}`, ordinal: i + 1 }))
    expect(deriveMasteryRows(state, clos)).toHaveLength(MAX_MASTERY_ROWS)
  })
})

describe('derivePatternsPassed', () => {
  it('returns an empty, non-throwing result when there is no mastery at all', () => {
    const data = derivePatternsPassed(makeState(), [])
    expect(data).toEqual({ groups: [], moreGroupsCount: 0, totalDistinctPatterns: 0 })
  })

  it('groups by CLO, unions distinct patterns, and truncates a long list with a "+N more" count', () => {
    const state = makeState({
      mastery: {
        'INFS1101-1': makeMastery({ cloId: 'INFS1101-1', patternsPassed: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
        'INFS1101-2': makeMastery({ cloId: 'INFS1101-2', patternsPassed: [] }),
      },
    })
    const clos = [makeClo({ id: 'INFS1101-1', ordinal: 1 }), makeClo({ id: 'INFS1101-2', ordinal: 2 })]
    const data = derivePatternsPassed(state, clos)
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].patterns).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(data.groups[0].moreCount).toBe(1)
    expect(data.totalDistinctPatterns).toBe(7)
  })

  it('caps the number of CLO groups shown and reports the remainder', () => {
    const mastery: LearnerState['mastery'] = {}
    const clos: Clo[] = []
    for (let i = 1; i <= 12; i++) {
      const id = `INFS1101-${i}`
      mastery[id] = makeMastery({ cloId: id, patternsPassed: ['p'] })
      clos.push(makeClo({ id, ordinal: i }))
    }
    const data = derivePatternsPassed(makeState({ mastery }), clos, 10, 6)
    expect(data.groups).toHaveLength(10)
    expect(data.moreGroupsCount).toBe(2)
  })
})

describe('deriveMistakeTrend', () => {
  it('returns twelve zero-count weeks and no throw when there is no history', () => {
    const data = deriveMistakeTrend(makeState(), [], '2026-09-05T00:00:00.000Z')
    expect(data.weeks).toHaveLength(12)
    expect(data.weeks.every(w => w.count === 0)).toBe(true)
    expect(data.totalMistakes).toBe(0)
    // 2026-09-05 is a Saturday; the Monday that starts its week is 2026-08-31, and it is the last (most recent) bucket.
    expect(data.weeks[11]).toMatchObject({ weekKey: '2026-08-31', label: 'Aug 31' })
  })

  it('buckets recentMistakes and failed attempts into the same weeks, ignoring passed attempts', () => {
    const state = makeState({ recentMistakes: [makeMistake({ at: '2026-09-01T10:00:00.000Z' })] })
    const attempts: Attempt[] = [
      makeAttempt({ passed: false, createdAt: '2026-08-24T10:00:00.000Z' }),
      makeAttempt({ passed: true, createdAt: '2026-09-01T10:00:00.000Z' }),
    ]
    const data = deriveMistakeTrend(state, attempts, '2026-09-05T00:00:00.000Z')
    expect(data.totalMistakes).toBe(2)
    expect(data.weeks[11].count).toBe(1)
    expect(data.weeks[10].count).toBe(1)
  })

  it('counts a diagnosed failure once when a failed attempt and its recentMistakes entry share an exercise and minute', () => {
    const state = makeState({
      // Same exercise, same minute as the attempt below (different second: 45s vs 00s), so it must dedupe.
      recentMistakes: [makeMistake({ exerciseId: 'e1', at: '2026-09-01T10:00:45.000Z' })],
    })
    const attempts: Attempt[] = [makeAttempt({ exerciseId: 'e1', passed: false, createdAt: '2026-09-01T10:00:00.000Z' })]
    const data = deriveMistakeTrend(state, attempts, '2026-09-05T00:00:00.000Z')
    expect(data.totalMistakes).toBe(1)
    expect(data.weeks[11].count).toBe(1)
  })

  it('still counts a recentMistakes entry with no matching failed attempt', () => {
    const state = makeState({ recentMistakes: [makeMistake({ exerciseId: 'e2', at: '2026-09-01T10:00:00.000Z' })] })
    const data = deriveMistakeTrend(state, [], '2026-09-05T00:00:00.000Z')
    expect(data.totalMistakes).toBe(1)
    expect(data.weeks[11].count).toBe(1)
  })

  it('drops events older than the twelve-week window', () => {
    const state = makeState({ recentMistakes: [makeMistake({ at: '2020-01-01T00:00:00.000Z' })] })
    const data = deriveMistakeTrend(state, [], '2026-09-05T00:00:00.000Z')
    expect(data.totalMistakes).toBe(0)
  })
})

describe('deriveTimeSpent', () => {
  it('renders zeroes without throwing when there are no attempts', () => {
    expect(deriveTimeSpent([])).toEqual({ totalMs: 0, totalLabel: '0m', daysActive: 0, days: [] })
  })

  it('sums durationMs per UTC day and reports the grand total and active day count', () => {
    const attempts: Attempt[] = [
      makeAttempt({ createdAt: '2026-09-01T01:00:00.000Z', durationMs: 60000 }),
      makeAttempt({ createdAt: '2026-09-01T22:00:00.000Z', durationMs: 120000 }),
      makeAttempt({ createdAt: '2026-09-02T01:00:00.000Z', durationMs: 3600000 }),
    ]
    const data = deriveTimeSpent(attempts)
    expect(data.daysActive).toBe(2)
    expect(data.totalMs).toBe(60000 + 120000 + 3600000)
    expect(data.totalLabel).toBe('1h 3m')
    expect(data.days.find(d => d.date === '2026-09-01')?.ms).toBe(180000)
    expect(data.days.find(d => d.date === '2026-09-02')?.durationLabel).toBe('1h 0m')
  })

  it('caps the shown days to the most recent `limit`, while daysActive still counts them all', () => {
    const attempts: Attempt[] = Array.from({ length: 20 }, (_, i) =>
      makeAttempt({ createdAt: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, durationMs: 60000 })
    )
    const data = deriveTimeSpent(attempts, 14)
    expect(data.daysActive).toBe(20)
    expect(data.days).toHaveLength(14)
    expect(data.days[13].date).toBe('2026-08-20')
  })
})

describe('deriveDrillScores', () => {
  it('always returns all six kinds, zeroed and non-throwing, when there is no history', () => {
    const rows = deriveDrillScores([])
    expect(rows).toHaveLength(6)
    expect(rows.every(r => r.count === 0 && r.best === 0 && r.mean === 0)).toBe(true)
    expect(rows.map(r => r.kind)).toEqual(['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type'])
  })

  it('computes best, mean, and count per kind', () => {
    const results: DrillResult[] = [
      makeDrill({ kind: 'trace', score: 60 }),
      makeDrill({ kind: 'trace', score: 90 }),
      makeDrill({ kind: 'n-back', score: 50 }),
    ]
    const rows = deriveDrillScores(results)
    expect(rows.find(r => r.kind === 'trace')).toMatchObject({ best: 90, mean: 75, count: 2 })
    expect(rows.find(r => r.kind === 'n-back')).toMatchObject({ best: 50, mean: 50, count: 1 })
    expect(rows.find(r => r.kind === 'speed-type')).toMatchObject({ best: 0, mean: 0, count: 0 })
  })
})

describe('deriveFocusLine', () => {
  it('carries the focus and name through unchanged, and formats the date', () => {
    const data = deriveFocusLine('Work on loops next.', 'Ada', '2026-09-05T00:00:00.000Z')
    expect(data).toEqual({ focus: 'Work on loops next.', displayName: 'Ada', generatedAtLabel: 'September 5, 2026' })
  })

  it('does not throw on an empty focus string', () => {
    expect(() => deriveFocusLine('', 'Ada', '2026-09-05T00:00:00.000Z')).not.toThrow()
  })
})
