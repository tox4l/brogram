import { describe, it, expect } from 'vitest'
import type { LearnerState } from '@/lib/contracts'
import type { AttemptRow, IntegrityEventRow, MasteryRow, ProfileRow, WellnessRow } from './compile'
import { DEFAULT_LEARNER_PROFILE, compileLearnerState } from './compile'

const CLO = 'INFS1101-3'

function profileRow(over: Partial<ProfileRow> = {}): ProfileRow {
  return { id: 'user-1', display_name: 'Musa', account_status: 'active', restricted_until: null, ...over }
}

function masteryRow(over: Partial<MasteryRow> = {}): MasteryRow {
  return {
    user_id: 'user-1',
    clo_id: CLO,
    score: 40,
    chain: 2,
    patterns_passed: ['loop-accumulate', 'guard-clause'],
    closed: false,
    last_attempt_at: '2026-03-01T10:00:00.000Z',
    ...over,
  }
}

function attemptRow(over: Partial<AttemptRow> = {}): AttemptRow {
  return { id: 'a-1', exercise_id: 'ex-1', passed: true, created_at: '2026-03-01T10:00:00.000Z', ...over }
}

function ago(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function eventRow(type: IntegrityEventRow['type'], over: Partial<IntegrityEventRow> = {}): IntegrityEventRow {
  return { type, exercise_id: 'ex-1', during_attempt: true, created_at: ago(1), ...over }
}

const NO_WELLNESS: WellnessRow = {}

describe('compileLearnerState', () => {
  it('builds the document from the server rows', () => {
    const state = compileLearnerState(profileRow(), [masteryRow()], [attemptRow()], [], NO_WELLNESS)

    expect(state.userId).toBe('user-1')
    expect(state.profile.displayName).toBe('Musa')
    expect(state.mastery[CLO]).toEqual({
      userId: 'user-1',
      cloId: CLO,
      score: 40,
      chain: 2,
      patternsPassed: ['loop-accumulate', 'guard-clause'],
      closed: false,
      lastAttemptAt: '2026-03-01T10:00:00.000Z',
    })
    expect(state.accountStatus).toBe('active')
    expect(state.integrityScore).toBe(0)
    expect(Number.isNaN(Date.parse(state.updatedAt))).toBe(false)
  })

  it('starts from the default profile and keeps the previous document fields', () => {
    const fresh = compileLearnerState(profileRow({ display_name: '' }), [], [], [], NO_WELLNESS)
    expect(fresh.profile).toEqual(DEFAULT_LEARNER_PROFILE)
    expect(fresh.currentCourse).toBeNull()
    expect(fresh.path).toEqual([])
    expect(fresh.nextExerciseIds).toEqual([])

    const prev: Partial<LearnerState> = {
      profile: { ...DEFAULT_LEARNER_PROFILE, tone: 'tough-love', onboardingComplete: true },
      currentCourse: 'INFS1101',
      path: [CLO],
      nextExerciseIds: ['ex-7'],
    }
    const state = compileLearnerState(profileRow(), [], [], [], NO_WELLNESS, prev)
    expect(state.profile.tone).toBe('tough-love')
    expect(state.profile.onboardingComplete).toBe(true)
    expect(state.profile.displayName).toBe('Musa')
    expect(state.currentCourse).toBe('INFS1101')
    expect(state.path).toEqual([CLO])
    expect(state.nextExerciseIds).toEqual(['ex-7'])
  })

  it('increments the version on every compile', () => {
    expect(compileLearnerState(profileRow(), [], [], [], NO_WELLNESS).version).toBe(1)
    expect(compileLearnerState(profileRow(), [], [], [], NO_WELLNESS, { version: 4 }).version).toBe(5)
    expect(compileLearnerState(profileRow(), [], [], [], NO_WELLNESS, { version: 0 }).version).toBe(1)
  })

  it('caps recentMistakes at the ten newest', () => {
    const attempts = Array.from({ length: 14 }, (_, i) =>
      attemptRow({
        id: `a-${i}`,
        exercise_id: `ex-${i}`,
        passed: false,
        created_at: `2026-03-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
        clo_id: CLO,
        pattern: 'loop-accumulate',
        mistake_label: `off-by-one ${i}`,
      }),
    )
    const state = compileLearnerState(profileRow(), [], attempts, [], NO_WELLNESS)

    expect(state.recentMistakes).toHaveLength(10)
    expect(state.recentMistakes[0]).toEqual({
      exerciseId: 'ex-13',
      cloId: CLO,
      pattern: 'loop-accumulate',
      label: 'off-by-one 13',
      at: '2026-03-14T10:00:00.000Z',
    })
    expect(state.recentMistakes[9].exerciseId).toBe('ex-4')
  })

  it('keeps mistakes carried by the previous document and ignores unlabelled failures', () => {
    const prev: Partial<LearnerState> = {
      recentMistakes: [{ exerciseId: 'ex-old', cloId: CLO, pattern: 'guard-clause', label: 'wrong guard', at: '2026-02-01T10:00:00.000Z' }],
    }
    const attempts = [
      attemptRow({ id: 'a-1', exercise_id: 'ex-1', passed: false, created_at: '2026-03-01T10:00:00.000Z' }),
      attemptRow({ id: 'a-2', exercise_id: 'ex-2', passed: false, created_at: '2026-03-02T10:00:00.000Z', clo_id: CLO, pattern: 'two-pointer', mistake_label: 'off-by-one' }),
    ]
    const state = compileLearnerState(profileRow(), [], attempts, [], NO_WELLNESS, prev)

    expect(state.recentMistakes.map((m) => m.exerciseId)).toEqual(['ex-2', 'ex-old'])
  })

  it('sums points over passed attempts, defaulting difficulty 3 and quality 70', () => {
    const attempts = [
      attemptRow({ id: 'a-1', passed: true }),
      attemptRow({ id: 'a-2', passed: true, difficulty: 5, hint_count: 2, quality: 100 }),
      attemptRow({ id: 'a-3', passed: false, difficulty: 5 }),
    ]
    expect(compileLearnerState(profileRow(), [], attempts, [], NO_WELLNESS).points).toBe(865)
  })

  it('counts the exercise streak by consecutive local date keys, whatever the machine timezone', () => {
    const attempts = [
      attemptRow({ id: 'a-1', created_at: '2026-03-01T23:00:00+03:00' }),
      attemptRow({ id: 'a-2', created_at: '2026-03-02T01:00:00+03:00' }),
      attemptRow({ id: 'a-3', created_at: '2026-03-02T09:00:00+03:00' }),
      attemptRow({ id: 'a-4', created_at: '2026-03-03T12:00:00+03:00' }),
    ]
    const state = compileLearnerState(profileRow(), [], attempts, [], NO_WELLNESS)

    expect(state.streak.exerciseDays).toBe(3)
    expect(state.streak.lastExerciseDate).toBe('2026-03-03')
  })

  it('breaks the streak on a missed day and counts only the newest run', () => {
    const attempts = [
      attemptRow({ id: 'a-1', created_at: '2026-03-01T10:00:00.000Z' }),
      attemptRow({ id: 'a-2', created_at: '2026-03-02T10:00:00.000Z' }),
      attemptRow({ id: 'a-3', created_at: '2026-03-05T10:00:00.000Z' }),
      attemptRow({ id: 'a-4', created_at: '2026-03-06T10:00:00.000Z' }),
    ]
    const state = compileLearnerState(profileRow(), [], attempts, [], NO_WELLNESS)

    expect(state.streak.exerciseDays).toBe(2)
    expect(state.streak.lastExerciseDate).toBe('2026-03-06')
  })

  it('counts the de-rot streak from drill results and leaves both streaks at zero with no activity', () => {
    const wellness: WellnessRow = {
      drill_results: [
        { drillId: 'd1', kind: 'trace', correct: true, timeMs: 900, score: 10, at: '2026-03-04T20:00:00.000Z' },
        { drillId: 'd2', kind: 'n-back', correct: false, timeMs: 900, score: 0, at: '2026-03-05T20:00:00.000Z' },
      ],
    }
    const state = compileLearnerState(profileRow(), [], [], [], wellness)
    expect(state.streak.derotDays).toBe(2)
    expect(state.streak.lastDerotDate).toBe('2026-03-05')

    const empty = compileLearnerState(profileRow(), [], [], [], NO_WELLNESS)
    expect(empty.streak).toEqual({ exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null })
  })

  it('scores integrity over the last seven days and escalates the account status', () => {
    const events = [
      ...Array.from({ length: 10 }, () => eventRow('blur')),
      ...Array.from({ length: 30 }, () => eventRow('paste-blocked', { created_at: ago(9) })),
    ]
    const state = compileLearnerState(profileRow(), [], [], events, NO_WELLNESS)

    expect(state.integrityScore).toBe(10)
    expect(state.accountStatus).toBe('warned')
  })

  it('restricts on five blocked pastes in one exercise whatever the score', () => {
    const events = Array.from({ length: 5 }, () => eventRow('paste-blocked', { exercise_id: 'ex-9' }))
    const state = compileLearnerState(profileRow(), [], [], events, NO_WELLNESS)

    expect(state.integrityScore).toBe(10)
    expect(state.accountStatus).toBe('restricted')
  })

  it('never softens a status the server already set', () => {
    const state = compileLearnerState(profileRow({ account_status: 'banned' }), [], [], [], NO_WELLNESS)
    expect(state.accountStatus).toBe('banned')
  })

  it('does not mutate the previous document or the rows it was given', () => {
    const prev: Partial<LearnerState> = { version: 2, path: [CLO], recentMistakes: [] }
    const frozen = JSON.stringify(prev)
    const rows = [masteryRow()]
    const rowsFrozen = JSON.stringify(rows)

    const state = compileLearnerState(profileRow(), rows, [attemptRow()], [], NO_WELLNESS, prev)
    state.path.push('INFS1101-4')

    expect(JSON.stringify(prev)).toBe(frozen)
    expect(JSON.stringify(rows)).toBe(rowsFrozen)
  })
})
