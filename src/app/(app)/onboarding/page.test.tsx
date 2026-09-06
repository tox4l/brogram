import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, AgentName } from '@/lib/contracts'
import Onboarding from './page'
import { FIRST_QUESTION } from './lib'

const mocks = vi.hoisted(() => ({ session: vi.fn(), call: vi.fn(), from: vi.fn(), push: vi.fn(), setLearnerState: vi.fn() }))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/lib/agents/client', () => ({ callAgent: mocks.call }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: mocks.from }) }))

const envelope = (agent: AgentName, reply: unknown): AgentEnvelope<unknown> => ({ ok: true, agent, reply, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } })

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let lastInFilter: { table: string; key: string; values: unknown[] } | null

function query(table: string) {
  let payload: Row | undefined
  let action: 'read' | 'insert' | 'update' = 'read'
  let single = false
  const filters: Array<(row: Row) => boolean> = []
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return builder },
    in: (key: string, values: unknown[]) => { lastInFilter = { table, key, values }; filters.push((row) => values.includes(row[key])); return builder },
    order: () => builder,
    maybeSingle: () => { single = true; return builder },
    insert: (value: Row) => { action = 'insert'; payload = value; return builder },
    update: (value: Row) => { action = 'update'; payload = value; return builder },
    then: (resolve: (result: { data: unknown; error: { message: string; code?: string } | null }) => unknown) => {
      const rows = tables[table] ??= []
      if (action === 'insert') {
        const row = { ...payload! }
        rows.push(row)
        if (table === 'learner_state') return Promise.resolve(resolve({ data: single ? { version: row.version } : [row], error: null }))
        return Promise.resolve(resolve({ data: single ? row : [row], error: null }))
      }
      if (action === 'update') {
        const found = rows.filter((row) => filters.every((filter) => filter(row)))
        found.forEach((row) => Object.assign(row, payload))
        if (!found.length) return Promise.resolve(resolve({ data: null, error: null }))
        return Promise.resolve(resolve({ data: single ? { version: found[0].version } : found, error: null }))
      }
      const found = rows.filter((row) => filters.every((filter) => filter(row)))
      return Promise.resolve(resolve({ data: single ? found[0] ?? null : found, error: null }))
    },
  }
  return builder
}

function session(overrides: Partial<{ version: number; onboardingComplete: boolean }> = {}) {
  return {
    user: { id: 'student' },
    profile: { id: 'student', account_status: 'active', restricted_until: null },
    learnerState: {
      userId: 'student',
      profile: {
        displayName: 'Maya', learningStyle: 'mixed',
        styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
        tone: 'supportive', verbosity: 'short',
        motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
        onboardingComplete: overrides.onboardingComplete ?? false,
      },
      currentCourse: null, path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
      streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
      points: 0, integrityScore: 0, accountStatus: 'active', version: overrides.version ?? 4, updatedAt: '2026-09-05T09:00:00Z',
    },
    setLearnerState: mocks.setLearnerState,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  lastInFilter = null
  tables = {
    courses: [
      { code: 'C1', slug: 'foundations', title: 'Programming foundations', language: 'python', level: 1, status: 'live' },
    ],
    clos: [
      { id: 'C1-1', course: 'C1', ordinal: 1, outcome: 'Outcome one', topics: [], prerequisites: [], patterns: [], assessable_in_code: true, draft: false },
      { id: 'C1-2', course: 'C1', ordinal: 2, outcome: 'Outcome two', topics: [], prerequisites: [], patterns: [], assessable_in_code: true, draft: false },
      { id: 'C1-3', course: 'C1', ordinal: 3, outcome: 'Outcome three', topics: [], prerequisites: [], patterns: [], assessable_in_code: true, draft: false },
      { id: 'C1-4', course: 'C1', ordinal: 4, outcome: 'Outcome four', topics: [], prerequisites: [], patterns: [], assessable_in_code: true, draft: false },
    ],
    exercises_public: [
      { id: 'ex1', clo_id: 'C1-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'p', title: 'Ex1', prompt: '', starter_code: '', tests: [], origin: 'seed', tags: [], verified: true },
      { id: 'ex2', clo_id: 'C1-4', language: 'python', kind: 'code', difficulty: 3, pattern: 'p', title: 'Ex2', prompt: '', starter_code: '', tests: [], origin: 'seed', tags: [], verified: true },
    ],
    learner_state: [{ user_id: 'student', state: session().learnerState, version: session().learnerState!.version }],
  }
  mocks.session.mockReturnValue(session())
  mocks.from.mockImplementation(query)
})
afterEach(cleanup)

async function completeToCoursePicker() {
  mocks.call.mockResolvedValueOnce(envelope('profiler', { nextQuestion: null, profileDelta: { onboardingComplete: true }, done: true }))
  render(<Onboarding />)
  fireEvent.click(screen.getByRole('button', { name: FIRST_QUESTION.options[0] }))
  return screen.findByRole('heading', { name: 'Choose your course' })
}

describe('onboarding', () => {
  it('calls no agent on mount and shows the first phase-1 question from the fallback fixture', () => {
    render(<Onboarding />)
    expect(screen.getByText(FIRST_QUESTION.text)).toBeTruthy()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('sends cumulative answers and merges the returned styleVector for a phase-1 answer', async () => {
    mocks.call.mockResolvedValueOnce(envelope('profiler', {
      nextQuestion: { id: 'p1q2', text: 'Second question', options: ['A', 'B'] },
      profileDelta: { styleVector: { visual: 0.7, verbal: 0.3, example: 0.5, theory: 0.5 }, learningStyle: 'visual' },
      done: false,
    }))
    render(<Onboarding />)
    const firstOption = FIRST_QUESTION.options[0]
    fireEvent.click(screen.getByRole('button', { name: firstOption }))
    await screen.findByText('Second question')
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'profiler', trigger: 'onboarding-answer', phase: 1,
      answers: [{ questionId: FIRST_QUESTION.id, answer: firstOption }],
    }))

    mocks.call.mockResolvedValueOnce(envelope('profiler', { nextQuestion: { id: 'p1q3', text: 'Third question', options: ['C', 'D'] }, profileDelta: {}, done: false }))
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    await screen.findByText('Third question')
    const secondRequest = mocks.call.mock.calls[1][0]
    expect(secondRequest.answers).toEqual([
      { questionId: FIRST_QUESTION.id, answer: firstOption },
      { questionId: 'p1q2', answer: 'A' },
    ])
    expect(secondRequest.state.profile.styleVector).toEqual({ visual: 0.7, verbal: 0.3, example: 0.5, theory: 0.5 })
  })

  it('merges phase-2 motivation keys one at a time without an earlier key being erased', async () => {
    mocks.call
      .mockResolvedValueOnce(envelope('profiler', { nextQuestion: { id: 'p2q1', text: 'How deep do you want to go?', options: ['Pass', 'Master'] }, profileDelta: {}, done: false }))
      .mockResolvedValueOnce(envelope('profiler', { nextQuestion: { id: 'p2q2', text: 'Why are you learning?', options: ['To build something'] }, profileDelta: { motivation: { depth: 'master' } }, done: false }))
      .mockResolvedValueOnce(envelope('profiler', { nextQuestion: { id: 'p2q3', text: 'Talk tone?', options: ['Direct'] }, profileDelta: { motivation: { why: 'To build something' } }, done: false }))
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: FIRST_QUESTION.options[0] }))
    await screen.findByText('How deep do you want to go?')
    fireEvent.click(screen.getByRole('button', { name: 'Master' }))
    await screen.findByText('Why are you learning?')
    fireEvent.click(screen.getByRole('button', { name: 'To build something' }))
    await screen.findByText('Talk tone?')
    fireEvent.click(screen.getByRole('button', { name: 'Direct' }))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(4))
    const lastRequest = mocks.call.mock.calls[3][0]
    expect(lastRequest.state.profile.motivation).toMatchObject({ depth: 'master', why: 'To build something' })
  })

  it('shows the course picker once the Profiler reports done', async () => {
    await completeToCoursePicker()
    expect(await screen.findByRole('button', { name: /Programming foundations/ })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Coming soon' })).toBeTruthy()
  })

  it('fetches candidates for exactly the first three CLOs by ordinal and calls the Planner once', async () => {
    await completeToCoursePicker()
    mocks.call.mockResolvedValueOnce(envelope('planner', { path: ['C1-1', 'C1-2', 'C1-3', 'C1-4'], nextExerciseIds: ['ex1'], focus: 'Start with the basics.' }))
    fireEvent.click(await screen.findByRole('button', { name: /Programming foundations/ }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'))
    expect(lastInFilter).toEqual({ table: 'exercises_public', key: 'clo_id', values: ['C1-1', 'C1-2', 'C1-3'] })
    expect(mocks.call.mock.calls.filter(([req]) => req.agent === 'planner')).toHaveLength(1)
    const plannerRequest = mocks.call.mock.calls.find(([req]) => req.agent === 'planner')![0]
    expect(plannerRequest.trigger).toBe('plan-refresh')
    expect(plannerRequest.candidates.map((candidate: { id: string }) => candidate.id)).toEqual(['ex1'])
  })

  it('writes onboardingComplete, version + 1, path, and nextExerciseIds through the learner_state upsert path', async () => {
    await completeToCoursePicker()
    mocks.call.mockResolvedValueOnce(envelope('planner', { path: ['C1-1', 'C1-2', 'C1-3', 'C1-4'], nextExerciseIds: ['ex1'], focus: 'Start with the basics.' }))
    fireEvent.click(await screen.findByRole('button', { name: /Programming foundations/ }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'))
    const row = tables.learner_state.find((entry) => entry.user_id === 'student')!
    expect(row.version).toBe(5)
    const state = row.state as { profile: { onboardingComplete: boolean }; path: string[]; nextExerciseIds: string[]; currentCourse: string }
    expect(state.profile.onboardingComplete).toBe(true)
    expect(state.path).toEqual(['C1-1', 'C1-2', 'C1-3', 'C1-4'])
    expect(state.nextExerciseIds).toEqual(['ex1'])
    expect(state.currentCourse).toBe('C1')
    expect(mocks.setLearnerState).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }))
  })

  it('completes onboarding even when no candidates are available for the chosen CLOs', async () => {
    tables.clos = []
    tables.exercises_public = []
    await completeToCoursePicker()
    mocks.call.mockResolvedValueOnce(envelope('planner', { path: [], nextExerciseIds: [], focus: 'Your next exercises are still being prepared.' }))
    fireEvent.click(await screen.findByRole('button', { name: /Programming foundations/ }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'))
    const plannerRequest = mocks.call.mock.calls.find(([req]) => req.agent === 'planner')![0]
    expect(plannerRequest.candidates).toEqual([])
    expect(plannerRequest.clos).toEqual([])
    const row = tables.learner_state.find((entry) => entry.user_id === 'student')!
    const state = row.state as { nextExerciseIds: string[] }
    expect(state.nextExerciseIds).toEqual([])
  })
})
