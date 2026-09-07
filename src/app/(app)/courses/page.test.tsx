import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, Clo, Course, ExercisePublic, LearnerState } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import CoursesPage from './page'

const mocks = vi.hoisted(() => {
  const toast = vi.fn() as unknown as { (message: string): void; error: ReturnType<typeof vi.fn> }
  ;(toast as unknown as { error: ReturnType<typeof vi.fn> }).error = vi.fn()
  return {
    push: vi.fn(),
    session: vi.fn(),
    setLearnerState: vi.fn(),
    call: vi.fn(),
    liveCourses: vi.fn(),
    closFor: vi.fn(),
    loadCourseBundle: vi.fn(),
    loadedBundle: vi.fn(),
    createClient: vi.fn(),
    toast,
  }
})

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
vi.mock('sonner', () => ({ toast: mocks.toast }))

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
const CLOS_C2: Clo[] = [
  { id: 'C2-1', course: 'C2', ordinal: 1, outcome: 'C2 outcome', topics: [], prerequisites: [], patterns: [], assessableInCode: true },
]
const EXERCISES_C1: ExercisePublic[] = [
  { id: 'e1', cloId: 'C1-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'guard', title: 'Ex1', prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] },
  { id: 'e2', cloId: 'C1-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'accumulate', title: 'Ex2', prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] },
]
const EXERCISES_C2: ExercisePublic[] = [
  { id: 'e3', cloId: 'C2-1', language: 'sql', kind: 'code', difficulty: 3, pattern: 'join', title: 'Ex3', prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] },
]
const BUNDLE_C1 = { code: 'C1', clos: CLOS_C1, lessons: [], exercises: EXERCISES_C1 }
const BUNDLE_C2 = { code: 'C2', clos: CLOS_C2, lessons: [], exercises: EXERCISES_C2 }

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

function session() {
  return { user: { id: 'student' }, setLearnerState: mocks.setLearnerState }
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

/** A `learner_state` client whose read always fails — used for the I4 rollback tests. */
function failingSupabase(message = 'Database unavailable') {
  return {
    from: (table: string) => {
      expect(table).toBe('learner_state')
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message } }) }) }) }
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
  mocks.session.mockReturnValue(session())
  mocks.liveCourses.mockReturnValue([COURSE_ONE, COURSE_TWO])
  mocks.closFor.mockImplementation((code: string) => (code === 'C1' ? CLOS_C1 : code === 'C2' ? CLOS_C2 : []))
  mocks.loadedBundle.mockImplementation((code: string) => (code === 'C1' ? BUNDLE_C1 : code === 'C2' ? BUNDLE_C2 : null))
  mocks.loadCourseBundle.mockImplementation(async (code: string) =>
    (code === 'C1' ? BUNDLE_C1 : code === 'C2' ? BUNDLE_C2 : { code, clos: [], lessons: [], exercises: [] }))
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

  it('updates the session store with the new course before navigating (C1) — every other screen reads that store, not the query cache', () => {
    const row: Row = { state: learnerState(), version: 1 }
    let pushedBeforeStoreUpdated = true
    mocks.push.mockImplementation(() => {
      // Runs synchronously, at the exact moment `router.push` is called — the
      // store must already reflect the new course by then.
      const lastCall = mocks.setLearnerState.mock.calls.at(-1) as [LearnerState] | undefined
      pushedBeforeStoreUpdated = !lastCall || lastCall[0].currentCourse !== 'C1'
    })
    renderPage(learnerState(), row)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))

    expect(mocks.push).toHaveBeenCalledWith('/course/C1')
    expect(pushedBeforeStoreUpdated).toBe(false)
    expect(mocks.setLearnerState).toHaveBeenCalledWith(expect.objectContaining({ currentCourse: 'C1' }))
  })

  it('updates the session store again once the switch settles, with the Planner-reconciled plan', async () => {
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e2', 'e1'], focus: 'New focus.' }))
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))
    await waitFor(() => expect(row.state.currentCourse).toBe('C1'))

    const settledCall = mocks.setLearnerState.mock.calls.at(-1)![0] as LearnerState & { focus?: string }
    expect(settledCall.currentCourse).toBe('C1')
    expect(settledCall.nextExerciseIds).toEqual(['e2', 'e1'])
    expect(settledCall.focus).toBe('New focus.')
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

  it('a double tap on the same card while it is pending does not fire a second plan-refresh call (I3)', async () => {
    const pending = deferred<AgentEnvelope<unknown>>()
    mocks.call.mockReturnValue(pending.promise)
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    const card = screen.getByRole('button', { name: /Course One/ })
    fireEvent.click(card)
    fireEvent.click(card)

    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1))
    expect(mocks.push).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e1', 'e2'], focus: '' }))
      await pending.promise
    })
    await waitFor(() => expect(row.state.currentCourse).toBe('C1'))
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })

  it('two rapid switches to different cards resolve to the last card tapped, even if its round trip lands first (I3)', async () => {
    const first = deferred<AgentEnvelope<unknown>>()
    const second = deferred<AgentEnvelope<unknown>>()
    mocks.call.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))
    // Let Course One's switch reach its Planner call before Course Two is tapped.
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /Course Two/ }))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))

    // Course Two's round trip resolves FIRST even though it was tapped second.
    await act(async () => {
      second.resolve(envelope({ path: ['C2-1'], nextExerciseIds: ['e3'], focus: '' }))
      await second.promise
    })
    await waitFor(() => expect(row.state.currentCourse).toBe('C2'))

    // Course One's round trip resolves LAST — it must not clobber Course Two.
    await act(async () => {
      first.resolve(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e1', 'e2'], focus: '' }))
      await first.promise
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(row.state.currentCourse).toBe('C2')
    expect(mocks.setLearnerState.mock.calls.at(-1)![0]).toMatchObject({ currentCourse: 'C2' })
  })

  it('rolls back the store and cache and shows a plain-English notice on a failed switch, returning to /courses (I4)', async () => {
    mocks.createClient.mockReturnValue(failingSupabase())
    mocks.call.mockResolvedValue(envelope({ path: ['C1-1', 'C1-2'], nextExerciseIds: ['e1', 'e2'], focus: '' }))
    const state = learnerState()
    const client = makeQueryClient()
    client.setQueryData(qk.learnerState('student'), state)
    render(<QueryClientProvider client={client}><CoursesPage /></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: /Course One/ }))
    expect(mocks.push).toHaveBeenCalledWith('/course/C1') // optimistic navigation still happened

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/courses'))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled())

    // Store rolled back to the pre-switch value.
    const lastStoreCall = mocks.setLearnerState.mock.calls.at(-1)![0] as LearnerState
    expect(lastStoreCall.currentCourse).toBeNull()
    // Query cache rolled back too — `useOptimistic`'s own machinery.
    expect(client.getQueryData(qk.learnerState('student'))).toMatchObject({ currentCourse: null })
  })

  it('a coming-soon course states its reason and is inert, but stays reachable by keyboard (M4)', () => {
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)

    const comingSoonGroup = screen.getByRole('group', { name: 'Coming soon' })
    const button = comingSoonGroup.querySelectorAll('button')[0] as HTMLButtonElement
    expect(button).toBeTruthy()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.disabled).toBe(false) // not `disabled` — a disabled button is unreachable by keyboard
    expect(button.textContent).toMatch(/not open yet/i)
    fireEvent.click(button)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('the Profiler is unreachable from this page — nothing on it links to /onboarding', () => {
    const row: Row = { state: learnerState(), version: 1 }
    renderPage(learnerState(), row)
    expect(document.body.querySelectorAll('a[href*="onboarding"]').length).toBe(0)
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
