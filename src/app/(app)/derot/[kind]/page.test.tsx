import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrillItem, DrillResult, LearnerState } from '@/lib/contracts'
import DerotRunnerPage from './page'

const mocks = vi.hoisted(() => ({
  params: vi.fn(),
  searchParams: vi.fn(),
  lockdown: vi.fn(),
  setLearnerState: vi.fn(),
  learnerState: null as LearnerState | null,
}))
vi.mock('next/navigation', () => ({ useParams: () => mocks.params(), useSearchParams: () => mocks.searchParams() }))
vi.mock('@/store/session', () => ({
  useSession: (selector: (session: { user: { id: string }; learnerState: LearnerState | null; setLearnerState: typeof mocks.setLearnerState }) => unknown) =>
    selector({ user: { id: 'student' }, learnerState: mocks.learnerState, setLearnerState: mocks.setLearnerState }),
}))
vi.mock('@/hooks/useLockdown', () => ({ useLockdown: (...args: unknown[]) => mocks.lockdown(...args) }))
vi.mock('@/components/derot', () => ({
  DrillRunner: ({ item, onResult }: { item: DrillItem; onResult: (result: DrillResult) => void }) => (
    <button onClick={() => onResult({ drillId: item.id, kind: item.kind, correct: true, timeMs: 500, score: 88, at: '2026-09-06T12:00:00.000Z', lane: item.lane })}>
      Simulate result for {item.id}
    </button>
  ),
}))

let drillsRows: Record<string, unknown>[]
let wellnessRow: { drill_results: DrillResult[] } | null
let updateAffectsRow: boolean
let insertShouldFail: boolean
const updateSpy = vi.fn()
const eqAfterUpdateSpy = vi.fn()
const insertSpy = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'drills') {
        return { select: () => ({ eq: (_col: string, value: string) => Promise.resolve({ data: drillsRows.filter((row) => row.kind === value), error: null }) }) }
      }
      if (table === 'wellness') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: wellnessRow, error: null }) }) }),
          update: (payload: Record<string, unknown>) => {
            updateSpy(payload)
            return {
              eq: (col: string, value: string) => {
                eqAfterUpdateSpy(col, value)
                return { select: () => ({ maybeSingle: () => Promise.resolve(updateAffectsRow ? { data: { user_id: value }, error: null } : { data: null, error: null }) }) }
              },
            }
          },
          insert: (payload: Record<string, unknown>) => {
            insertSpy(payload)
            return Promise.resolve(insertShouldFail ? { error: { message: 'insert failed' } } : { error: null })
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

function drillRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return { id: 'd1', kind: 'trace', difficulty: 3, time_limit_s: 60, payload: {}, ...overrides }
}
function result(overrides: Partial<DrillResult>): DrillResult {
  return { drillId: 'd1', kind: 'trace', correct: true, timeMs: 500, score: 50, at: '2026-01-01T00:00:00.000Z', lane: 'arcade', ...overrides }
}
function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'student',
    profile: {
      displayName: '', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'course-1', path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 2, derotDays: 0, lastExerciseDate: '2026-09-05', lastDerotDate: null },
    points: 100, integrityScore: 0, accountStatus: 'active', version: 3, updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.params.mockReturnValue({ kind: 'trace' })
  mocks.searchParams.mockReturnValue(new URLSearchParams())
  mocks.lockdown.mockReturnValue({ overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', loggingError: null })
  mocks.learnerState = learnerState()
  drillsRows = [drillRow({ id: 'd1' })]
  wellnessRow = { drill_results: [] }
  updateAffectsRow = true
  insertShouldFail = false
})
afterEach(cleanup)

describe('de-rot runner', () => {
  it('picks a never-played item over one already played', async () => {
    drillsRows = [drillRow({ id: 't-played' }), drillRow({ id: 't-fresh' })]
    // Played on a previous day: survives the "not done today" filter but counts as played.
    wellnessRow = { drill_results: [result({ drillId: 't-played', at: '2026-09-01T08:00:00.000Z' })] }
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for t-fresh')).toBeTruthy())
  })

  it('mounts lockdown with a null exercise id (drill ids are not exercise_id uuids), gated until an item loads', async () => {
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for d1')).toBeTruthy())
    const lastCall = mocks.lockdown.mock.calls.at(-1)
    expect(lastCall?.[0]).toBeNull()
    expect((lastCall?.[1] as { enabled?: boolean })?.enabled).toBe(true)
  })

  it('keeps the idle guard on for a non-hold-focus kind', async () => {
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for d1')).toBeTruthy())
    const lastCall = mocks.lockdown.mock.calls.at(-1)
    expect((lastCall?.[1] as { idleGuard?: boolean })?.idleGuard).toBe(true)
  })

  it('turns the idle guard off for hold-focus, whose own blur and scroll voids are the reading guard', async () => {
    mocks.params.mockReturnValue({ kind: 'hold-focus' })
    drillsRows = [drillRow({ id: 'hf-1', kind: 'hold-focus' })]
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for hf-1')).toBeTruthy())
    const lastCall = mocks.lockdown.mock.calls.at(-1)
    expect((lastCall?.[1] as { idleGuard?: boolean })?.idleGuard).toBe(false)
  })

  it("onResult updates only wellness.drill_results, filtered by the student's user_id, when the row already exists", async () => {
    wellnessRow = { drill_results: [result({ drillId: 'other', kind: 'n-back', score: 10, at: '2026-09-01T00:00:00.000Z' })] }
    render(<DerotRunnerPage />)
    const button = await screen.findByText('Simulate result for d1')
    fireEvent.click(button)

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(['drill_results'])
    const nextResults = payload.drill_results as DrillResult[]
    expect(nextResults).toHaveLength(2)
    expect(nextResults[1]).toEqual({ drillId: 'd1', kind: 'trace', correct: true, timeMs: 500, score: 88, at: '2026-09-06T12:00:00.000Z', lane: 'arcade' })
    expect(eqAfterUpdateSpy).toHaveBeenCalledWith('user_id', 'student')
    expect(insertSpy).not.toHaveBeenCalled()

    expect(await screen.findByText('Score: 88')).toBeTruthy()
  })

  it('creates the wellness row when the update affects no rows instead of losing the result', async () => {
    updateAffectsRow = false
    render(<DerotRunnerPage />)
    const button = await screen.findByText('Simulate result for d1')
    fireEvent.click(button)

    await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1))
    expect(insertSpy).toHaveBeenCalledWith({
      user_id: 'student',
      drill_results: [{ drillId: 'd1', kind: 'trace', correct: true, timeMs: 500, score: 88, at: '2026-09-06T12:00:00.000Z', lane: 'arcade' }],
    })
    expect(await screen.findByText('Score: 88')).toBeTruthy()
  })

  it('surfaces a visible, retryable error when the update misses and the fallback insert also fails', async () => {
    updateAffectsRow = false
    insertShouldFail = true
    render(<DerotRunnerPage />)
    const button = await screen.findByText('Simulate result for d1')
    fireEvent.click(button)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('could not be saved')
    expect(screen.queryByText('Score: 88')).toBeNull()

    insertShouldFail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    expect(await screen.findByText('Score: 88')).toBeTruthy()
  })

  it("refreshes the session's de-rot streak and last date after a successful save", async () => {
    mocks.learnerState = learnerState({ streak: { exerciseDays: 2, derotDays: 0, lastExerciseDate: '2026-09-05', lastDerotDate: null } })
    render(<DerotRunnerPage />)
    const button = await screen.findByText('Simulate result for d1')
    fireEvent.click(button)

    await waitFor(() => expect(mocks.setLearnerState).toHaveBeenCalledTimes(1))
    const next = mocks.setLearnerState.mock.calls[0][0] as LearnerState
    expect(next.streak).toEqual({ exerciseDays: 2, derotDays: 1, lastExerciseDate: '2026-09-05', lastDerotDate: '2026-09-06' })
  })

  it('does not touch the session when there is no learner state loaded yet', async () => {
    mocks.learnerState = null
    render(<DerotRunnerPage />)
    const button = await screen.findByText('Simulate result for d1')
    fireEvent.click(button)
    expect(await screen.findByText('Score: 88')).toBeTruthy()
    expect(mocks.setLearnerState).not.toHaveBeenCalled()
  })

  it('shows a designed empty state when the kind has no drill items', async () => {
    drillsRows = []
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('No items yet')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Simulate result/ })).toBeNull()
  })

  it('rejects a kind that is not one of the six drills', () => {
    mocks.params.mockReturnValue({ kind: 'made-up' })
    render(<DerotRunnerPage />)
    expect(screen.getByText('This drill could not open')).toBeTruthy()
  })

  it('honors an explicit ?item= deep link even when other items would otherwise be preferred', async () => {
    drillsRows = [drillRow({ id: 'a' }), drillRow({ id: 'b' })]
    mocks.searchParams.mockReturnValue(new URLSearchParams('item=b'))
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for b')).toBeTruthy())
  })
})
