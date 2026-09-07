import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, Clo, CourseCode, ExercisePublic, LearnerState } from '@/lib/contracts'
import { courseProgress, switchCourse } from './lib'

const mocks = vi.hoisted(() => ({ call: vi.fn(), closFor: vi.fn(), loadCourseBundle: vi.fn() }))

vi.mock('@/lib/agents/client', () => ({ callAgent: mocks.call }))
vi.mock('@/lib/curriculum', () => ({ closFor: mocks.closFor, loadCourseBundle: mocks.loadCourseBundle }))

const envelope = (reply: unknown): AgentEnvelope<unknown> =>
  ({ ok: true, agent: 'planner', reply, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } })

function clo(id: string, course: CourseCode, ordinal: number, prerequisites: string[] = []): Clo {
  return { id, course, ordinal, outcome: `Outcome ${id}`, topics: [], prerequisites, patterns: [], assessableInCode: true }
}

function exercise(id: string, cloId: string, pattern: string): ExercisePublic {
  return { id, cloId, language: 'python', kind: 'code', difficulty: 3, pattern, title: id, prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] }
}

function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'student',
    profile: {
      displayName: 'Maya', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: null, path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 3, derotDays: 1, lastExerciseDate: '2026-09-06', lastDerotDate: '2026-09-06' },
    points: 500, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-06T00:00:00Z',
    ...overrides,
  }
}

type Row = { user_id: string; state: LearnerState; version: number }

/** A minimal in-memory `learner_state` table: enough for the select/eq/update/insert
 *  chain `switchCourse`'s write path uses, no more. */
function fakeSupabase(initial: Row) {
  let row: Row | null = { ...initial, state: { ...initial.state } }
  const updateCalls: unknown[] = []

  const client = {
    from: (table: string) => {
      expect(table).toBe('learner_state')
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row ? { state: row.state, version: row.version } : null, error: null }),
          }),
        }),
        update: (payload: { state: LearnerState; version: number }) => {
          updateCalls.push(payload)
          return {
            eq: () => ({
              eq: (_col: string, expectedVersion: number) => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (!row || row.version !== expectedVersion) return { data: null, error: null }
                    row = { user_id: row.user_id, state: payload.state, version: payload.version }
                    return { data: { version: payload.version }, error: null }
                  },
                }),
              }),
            }),
          }
        },
        insert: () => { throw new Error('not exercised in these tests — a row always already exists') },
      }
    },
  }

  return { client, currentRow: () => row!, updateCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** Narrows `switchCourse`'s `SwitchCourseResult | null` for tests that expect a real
 *  write — `null` means "superseded", which has its own dedicated tests below. */
async function mustSwitch(...args: Parameters<typeof switchCourse>) {
  const result = await switchCourse(...args)
  if (!result) throw new Error('expected switchCourse to write, not to report superseded')
  return result
}

describe('switchCourse', () => {
  it('fires exactly one plan-refresh call to the Planner', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1)])
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [exercise('e1', 'C1-1', 'guard')] })
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1'], nextExerciseIds: ['e1'], focus: 'Keep going.' }))

    const state = learnerState()
    const { client } = fakeSupabase({ user_id: 'student', state, version: state.version })
    await switchCourse({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ agent: 'planner', trigger: 'plan-refresh', course: 'C1' }))
  })

  it('keeps and persists the provisional plan when the Planner rejects', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1), clo('C1-2', 'C1', 2, ['C1-1'])])
    mocks.loadCourseBundle.mockResolvedValue({
      code: 'C1', clos: [], lessons: [],
      exercises: [exercise('e1', 'C1-1', 'guard'), exercise('e2', 'C1-1', 'accumulate')],
    })
    mocks.call.mockRejectedValue(new Error('DeepSeek is unavailable'))

    const state = learnerState()
    const { client, currentRow } = fakeSupabase({ user_id: 'student', state, version: state.version })
    const result = await mustSwitch({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    expect(result.state.path).toEqual(['C1-1', 'C1-2'])
    expect(result.state.nextExerciseIds).toEqual(['e1', 'e2'])
    expect(result.state.currentCourse).toBe('C1')
    expect(result.pathTuned).toBe(false)
    // Persisted, not just returned — the write actually landed.
    expect(currentRow().state.currentCourse).toBe('C1')
    expect(currentRow().state.path).toEqual(['C1-1', 'C1-2'])
  })

  it('writes learner_state exactly once even when the Planner succeeds', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1)])
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [exercise('e1', 'C1-1', 'guard')] })
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1'], nextExerciseIds: ['e1'], focus: 'Keep going.' }))

    const state = learnerState()
    const { client, updateCalls } = fakeSupabase({ user_id: 'student', state, version: state.version })
    await switchCourse({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    expect(updateCalls).toHaveLength(1)
  })

  it('reports pathTuned true only when the reconciled plan actually differs from the provisional one', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1)])
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [exercise('e1', 'C1-1', 'guard')] })
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1'], nextExerciseIds: ['e9'], focus: 'Keep going.' }))

    const state = learnerState()
    const { client } = fakeSupabase({ user_id: 'student', state, version: state.version })
    const result = await mustSwitch({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    expect(result.pathTuned).toBe(true)
    expect(result.state.nextExerciseIds).toEqual(['e9'])
  })

  it('preserves a course you switched away from: mastery and points survive switching to a second course and back', async () => {
    mocks.closFor.mockImplementation((code: CourseCode) =>
      code === 'C1' ? [clo('C1-1', 'C1', 1)] : [clo('C2-1', 'C2', 1)])
    mocks.loadCourseBundle.mockImplementation(async (code: CourseCode) => ({
      code, clos: [], lessons: [],
      exercises: code === 'C1' ? [exercise('e1', 'C1-1', 'guard')] : [exercise('e2', 'C2-1', 'search')],
    }))
    mocks.call.mockResolvedValue(envelope({ path: ['irrelevant'], nextExerciseIds: [], focus: '' }))

    const initial = learnerState({
      currentCourse: 'C1',
      mastery: { 'C1-1': { userId: 'student', cloId: 'C1-1', score: 80, chain: 3, patternsPassed: ['guard', 'accumulate'], closed: true, lastAttemptAt: '2026-09-05T00:00:00Z' } },
      points: 777,
    })
    const { client, currentRow } = fakeSupabase({ user_id: 'student', state: initial, version: initial.version })

    // Switch to a second course.
    let latest = (await mustSwitch({ client: client as never, userId: 'student', code: 'C2', fallback: currentRow().state })).state
    expect(latest.currentCourse).toBe('C2')

    // Switch back to the first course.
    latest = (await mustSwitch({ client: client as never, userId: 'student', code: 'C1', fallback: latest })).state

    expect(latest.currentCourse).toBe('C1')
    expect(latest.mastery['C1-1']).toEqual(initial.mastery['C1-1'])
    expect(latest.points).toBe(777)
  })

  it('sends the Planner a wide candidate set from the bundle, not just the three provisional picks (I1)', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1), clo('C1-2', 'C1', 2, ['C1-1'])])
    // 15 exercises on the first open CLO alone — well past the three
    // `provisionalPlan` would have picked, and past the 12-candidate floor.
    const exercises = Array.from({ length: 15 }, (_, i) => exercise(`e${i}`, 'C1-1', `pattern-${i}`))
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises })
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e0', 'e1', 'e2'], focus: 'Keep going.' }))

    const state = learnerState()
    const { client } = fakeSupabase({ user_id: 'student', state, version: state.version })
    await mustSwitch({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    const sent = mocks.call.mock.calls[0][0] as { candidates: unknown[] }
    expect(sent.candidates.length).toBeGreaterThanOrEqual(12)
    // Strictly wider than the three ids `provisionalPlan` already picked — the
    // Planner must have room to choose something other than what was handed to it.
    expect(sent.candidates.length).toBeGreaterThan(3)
  })

  it('caps candidates at 30 and only offers CLOs that are not yet closed', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1), clo('C1-2', 'C1', 2, ['C1-1'])])
    const open = Array.from({ length: 40 }, (_, i) => exercise(`open-${i}`, 'C1-2', `pattern-${i}`))
    const closedClo = [exercise('closed-1', 'C1-1', 'guard')]
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [...closedClo, ...open] })
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['open-0'], focus: '' }))

    const state = learnerState({
      mastery: { 'C1-1': { userId: 'student', cloId: 'C1-1', score: 100, chain: 3, patternsPassed: ['guard'], closed: true, lastAttemptAt: null } },
    })
    const { client } = fakeSupabase({ user_id: 'student', state, version: state.version })
    await mustSwitch({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    const sent = mocks.call.mock.calls[0][0] as { candidates: { cloId: string }[] }
    expect(sent.candidates).toHaveLength(30)
    expect(sent.candidates.every((c) => c.cloId === 'C1-2')).toBe(true)
  })

  it('persists the Planner\'s focus line with the plan (I2)', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1)])
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [exercise('e1', 'C1-1', 'guard')] })
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1'], nextExerciseIds: ['e1'], focus: 'Fresh focus for the new course.' }))

    const state = learnerState()
    const { client, currentRow } = fakeSupabase({ user_id: 'student', state, version: state.version })
    const result = await mustSwitch({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    expect((result.state as LearnerState & { focus?: string }).focus).toBe('Fresh focus for the new course.')
    expect((currentRow().state as LearnerState & { focus?: string }).focus).toBe('Fresh focus for the new course.')
  })

  it('clears a stale focus line rather than keeping the previous course\'s sentence when the Planner fails', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1)])
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [exercise('e1', 'C1-1', 'guard')] })
    mocks.call.mockRejectedValue(new Error('DeepSeek is unavailable'))

    const state: LearnerState & { focus?: string } = { ...learnerState(), focus: 'The old course\'s sentence.' }
    const { client, currentRow } = fakeSupabase({ user_id: 'student', state, version: state.version })
    const result = await mustSwitch({ client: client as never, userId: 'student', code: 'C1', fallback: state })

    expect((result.state as LearnerState & { focus?: string }).focus).toBeUndefined()
    expect((currentRow().state as LearnerState & { focus?: string }).focus).toBeUndefined()
  })

  it('returns null and writes nothing when superseded before the write (I3)', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1)])
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [exercise('e1', 'C1-1', 'guard')] })
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1'], nextExerciseIds: ['e1'], focus: '' }))

    const state = learnerState()
    const { client, updateCalls, currentRow } = fakeSupabase({ user_id: 'student', state, version: state.version })
    const result = await switchCourse({ client: client as never, userId: 'student', code: 'C1', fallback: state, isSuperseded: () => true })

    expect(result).toBeNull()
    expect(updateCalls).toHaveLength(0)
    expect(currentRow().state.currentCourse).toBeNull()
  })

  it('never calls the Planner once superseded, even after the bundle has already loaded', async () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1)])
    mocks.loadCourseBundle.mockResolvedValue({ code: 'C1', clos: [], lessons: [], exercises: [exercise('e1', 'C1-1', 'guard')] })

    const state = learnerState()
    const { client } = fakeSupabase({ user_id: 'student', state, version: state.version })
    const result = await switchCourse({ client: client as never, userId: 'student', code: 'C1', fallback: state, isSuperseded: () => true })

    expect(result).toBeNull()
    expect(mocks.call).not.toHaveBeenCalled()
  })
})

describe('courseProgress', () => {
  it('is the fraction of the course\'s CLOs that are closed, as a rounded percentage', () => {
    mocks.closFor.mockReturnValue([clo('C1-1', 'C1', 1), clo('C1-2', 'C1', 2), clo('C1-3', 'C1', 3)])
    const mastery: LearnerState['mastery'] = {
      'C1-1': { userId: 'u', cloId: 'C1-1', score: 100, chain: 3, patternsPassed: [], closed: true, lastAttemptAt: null },
    }
    expect(courseProgress('C1', mastery)).toBe(33)
  })

  it('is zero for a course with no CLOs', () => {
    mocks.closFor.mockReturnValue([])
    expect(courseProgress('C1', {})).toBe(0)
  })
})
