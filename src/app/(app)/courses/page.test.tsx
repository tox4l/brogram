import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, Clo, Course, ExercisePublic, LearnerState } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import CoursesPage from './page'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  session: vi.fn(),
  call: vi.fn(),
  liveCourses: vi.fn(),
  closFor: vi.fn(),
  loadCourseBundle: vi.fn(),
  loadedBundle: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/store/session', () => ({
  useSession: (selector: (session: ReturnType<typeof mocks.session>) => unknown) => selector(mocks.session()),
}))
vi.mock('@/lib/agents/client', () => ({ callAgent: mocks.call }))
vi.mock('@/lib/curriculum', () => ({
  liveCourses: () => mocks.liveCourses(),
  closFor: (code: string) => mocks.closFor(code),
  loadCourseBundle: (code: string) => mocks.loadCourseBundle(code),
  loadedBundle: (code: string) => mocks.loadedBundle(code),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => mocks.createClient() }))

/** Deferred promise, so a test controls exactly when the Planner call settles. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const envelope = (reply: unknown): AgentEnvelope<unknown> =>
  ({ ok: true, agent: 'planner', reply, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } })

const COURSE_ONE: Course = {
  code: 'C1', slug: 'course-one', title: 'Course One', language: 'python', runtime: 'browser',
  level: 1, prerequisites: [], topics: [], cloIds: ['C1-1', 'C1-2'], status: 'live',
}
const COURSE_TWO: Course = {
  code: 'C2', slug: 'course-two', title: 'Course Two', language: 'sql', runtime: 'browser',
  level: 2, prerequisites: [], topics: [], cloIds: ['C2-1'], status: 'live',
}
const CLOS_C1: Clo[] = [
  { id: 'C1-1', course: 'C1', ordinal: 1, outcome: 'First outcome', topics: [], prerequisites: [], patterns: [], assessableInCode: true },
  { id: 'C1-2', course: 'C1', ordinal: 2, outcome: 'Second outcome', topics: [], prerequisites: ['C1-1'], patterns: [], assessableInCode: true },
]
const EXERCISES_C1: ExercisePublic[] = [
  { id: 'e1', cloId: 'C1-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'guard', title: 'Ex1', prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] },
  { id: 'e2', cloId: 'C1-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'accumulate', title: 'Ex2', prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] },
]

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
    streak: { exerciseDays: 2, derotDays: 1, lastExerciseDate: '2026-09-06', lastDerotDate: '2026-09-06' },
    points: 300, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-06T00:00:00Z',
    ...overrides,
  }
}

type Row = { state: LearnerState; version: number }

function fakeSupabase(row: Row) {
  return {
    from: (table: string) => {
      expect(table).toBe('learner_state')
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { state: row.state, version: row.version }, error: null }) }),
        }),
        update: (payload: { state: LearnerState; version: number }) => ({
          eq: () => ({
            eq: (_column: string, expectedVersion: number) => ({
              select: () => ({
                maybeSingle: async () => {
                  if (row.version !== expectedVersion) return { data: null, error: null }
                  row.state = payload.state
                  row.version = payload.version
                  return { data: { version: payload.version }, error: null }
                },
              }),
            }),
          }),
        }),
      }
    },
  }
}

function renderPage(state: LearnerState, row: Row) {
  mocks.createClient.mockReturnValue(fakeSupabase(row))
  const client = makeQueryClient()
  client.setQueryData(qk.learnerState('student'), state)
  render(
    <QueryClientProvider client={client}>
      <CoursesPage />
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockReturnValue({ user: { id: 'student' } })
  mocks.liveCourses.mockReturnValue([COURSE_ONE, COURSE_TWO])
  mocks.closFor.mockImplementation((code: string) => (code === 'C1' ? CLOS_C1 : []))
  mocks.loadedBundle.mockImplementation((code: string) => (code === 'C1' ? { code, clos: CLOS_C1, lessons: [], exercises: EXERCISES_C1 } : null))
  mocks.loadCourseBundle.mockImplementation(async (code: string) => (code === 'C1' ? { code, clos: CLOS_C1, lessons: [], exercises: EXERCISES_C1 } : { code, clos: [], lessons: [], exercises: [] }))
})
afterEach(() => {
  cleanup()
})

describe('/courses — the optimistic switch', () => {
  it('navigates before the Planner call resolves, and resolves the Planner only afterwards', async () => {
    const pending = deferred<AgentEnvelope<unknown>>()
    mocks.call.mockReturnValue(pending.promise)
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))

    // The push already happened, synchronously, before the mutation's own async
    // chain (bundle load, then the Planner call) has had a chance to settle anything.
    expect(mocks.push).toHaveBeenCalledWith('/course/C1')

    // The switch is under way but the Planner call is still pending — resolving
    // it is the next thing this test does, deliberately, after the assertion above.
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1))
    expect(row.state.currentCourse).not.toBe('C1')

    await act(async () => {
      pending.resolve(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e1', 'e2'], focus: '' }))
      await pending.promise
    })
    await waitFor(() => expect(row.state.currentCourse).toBe('C1'))
  })

  it('fires exactly one callAgent call with trigger plan-refresh per switch', async () => {
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e1', 'e2'], focus: '' }))
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))
    await waitFor(() => expect(row.state.currentCourse).toBe('C1'))

    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ agent: 'planner', trigger: 'plan-refresh' }))
  })

  it('keeps and persists the provisional plan when the Planner call rejects', async () => {
    mocks.call.mockRejectedValue(new Error('DeepSeek is unavailable'))
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))
    await waitFor(() => expect(row.state.currentCourse).toBe('C1'))

    // The provisional plan for C1 (topological order, first non-closed CLO, two distinct patterns).
    expect(row.state.path).toEqual(['C1-1', 'C1-2'])
    expect(row.state.nextExerciseIds).toEqual(['e1', 'e2'])
  })

  it('a coming-soon course is not clickable and states its reason', () => {
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    const comingSoonGroup = screen.getByRole('group', { name: 'Coming soon' })
    const button = comingSoonGroup.querySelectorAll('button')[0] as HTMLButtonElement
    expect(button).toBeTruthy()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toMatch(/not open yet/i)
    fireEvent.click(button)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('the Profiler is unreachable from this page — nothing on it links to /onboarding', () => {
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)
    expect(document.body.querySelectorAll('a[href*="onboarding"]').length).toBe(0)
    expect(document.body.querySelectorAll('a').length).toBe(0)
  })

  it('shows a dismissible "tuning your path" chip while the switch is refining, never blocking the cards', async () => {
    const pending = deferred<AgentEnvelope<unknown>>()
    mocks.call.mockReturnValue(pending.promise)
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))
    const chip = await screen.findByRole('status')
    expect(chip.textContent).toMatch(/tuning your path/i)
    // Every course card is still present and interactive — never blocking.
    expect((screen.getByRole('button', { name: /Course Two/ }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()

    await act(async () => {
      pending.resolve(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e1', 'e2'], focus: '' }))
      await pending.promise
    })
  })
})
