import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrillItem, DrillResult, LearnerState } from '@/lib/contracts'
import DerotArcadeRunnerPage from './page'

// A full six-item run waits out six real 650ms pauses (~4s); give this file's
// tests headroom beyond the 5s default rather than tune each one individually.
vi.setConfig({ testTimeout: 15000 })

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

const mocks = vi.hoisted(() => ({
  params: vi.fn(),
  searchParams: vi.fn(),
  lockdown: vi.fn(),
  setLearnerState: vi.fn(),
  learnerState: null as LearnerState | null,
  play: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useParams: () => mocks.params(), useSearchParams: () => mocks.searchParams() }))
vi.mock('@/store/session', () => ({
  useSession: (selector: (session: { user: { id: string }; learnerState: LearnerState | null; setLearnerState: typeof mocks.setLearnerState }) => unknown) =>
    selector({ user: { id: 'student' }, learnerState: mocks.learnerState, setLearnerState: mocks.setLearnerState }),
}))
vi.mock('@/hooks/useLockdown', () => ({ useLockdown: (...args: unknown[]) => mocks.lockdown(...args) }))
vi.mock('@/lib/sound/manager', () => ({ play: mocks.play, withInterfaceSounds: (run: () => void) => run() }))
vi.mock('@/components/derot', () => ({
  DrillRunner: ({ item, onResult }: { item: DrillItem; onResult: (result: DrillResult) => void }) => (
    <div>
      <p>Item: {item.id}</p>
      <button onClick={() => onResult({ drillId: item.id, kind: item.kind, correct: true, timeMs: 500, score: 90, at: '2026-09-06T12:00:00.000Z', lane: item.lane })}>
        Correct for {item.id}
      </button>
      <button onClick={() => onResult({ drillId: item.id, kind: item.kind, correct: false, timeMs: 500, score: 0, at: '2026-09-06T12:00:00.000Z', lane: item.lane })}>
        Miss for {item.id}
      </button>
    </div>
  ),
}))

let drillsRows: Record<string, unknown>[]
let wellnessRow: { drill_results: DrillResult[] } | null
let rpcError: { code?: string; message?: string } | null
let rpcData: DrillResult[]
let updateAffectsRow: boolean
let insertShouldFail: boolean
const rpcSpy = vi.fn()
const updateSpy = vi.fn()
const insertSpy = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => {
      rpcSpy(...args)
      return Promise.resolve(rpcError ? { data: null, error: rpcError } : { data: rpcData, error: null })
    },
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
              eq: (col: string, value: string) => ({
                select: () => ({ maybeSingle: () => Promise.resolve(updateAffectsRow ? { data: { user_id: value }, error: null } : { data: null, error: null }) }),
              }),
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
function sixDrillRows(kind = 'trace') {
  return ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((id) => drillRow({ id, kind }))
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

/**
 * Answers the currently-shown item and waits out the post-answer pause
 * (ADVANCE_DELAY_MS in page.tsx). Real timers stay real -- only `Date` is
 * faked -- so `waitFor`'s own internal polling keeps working; this just
 * waits a little longer than the page's own 600ms pause.
 */
async function answerCurrent(correct = true) {
  const itemLabel = await screen.findByText(/^Item: /)
  const id = itemLabel.textContent!.replace('Item: ', '')
  fireEvent.click(screen.getByRole('button', { name: `${correct ? 'Correct' : 'Miss'} for ${id}` }))
  await new Promise((resolve) => setTimeout(resolve, 650))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-06T12:00:00.000Z'))
  mocks.params.mockReturnValue({ kind: 'trace' })
  mocks.searchParams.mockReturnValue(new URLSearchParams())
  mocks.lockdown.mockReturnValue({ overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', loggingError: null })
  mocks.learnerState = learnerState()
  drillsRows = sixDrillRows()
  wellnessRow = { drill_results: [] }
  rpcError = null
  rpcData = []
  updateAffectsRow = true
  insertShouldFail = false
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Arcade runner', () => {
  it('picks a never-played item over one already played', async () => {
    wellnessRow = { drill_results: [result({ drillId: 'd1', at: '2026-09-01T08:00:00.000Z' })] }
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d2')).toBeTruthy())
  })

  it('mounts lockdown with a null exercise id, gated until an item loads', async () => {
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    const lastCall = mocks.lockdown.mock.calls.at(-1)
    expect(lastCall?.[0]).toBeNull()
    expect((lastCall?.[1] as { enabled?: boolean })?.enabled).toBe(true)
  })

  it('turns the idle guard off for hold-focus, on for every other kind', async () => {
    mocks.params.mockReturnValue({ kind: 'hold-focus' })
    drillsRows = sixDrillRows('hold-focus')
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    expect((mocks.lockdown.mock.calls.at(-1)?.[1] as { idleGuard?: boolean })?.idleGuard).toBe(false)
  })

  it('a run is six items -- a miss on item 1 shows item 2 next instead of the summary', async () => {
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    await answerCurrent(false)
    await waitFor(() => expect(screen.getByText('Item: d2')).toBeTruthy())
    expect(screen.queryByText(/run complete/)).toBeNull()
  })

  it('completing all six items shows the run summary, and appends exactly ONE DrillResult through the RPC', async () => {
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)

    await waitFor(() => expect(screen.getByText(/run complete/)).toBeTruthy())
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    const [, payload] = rpcSpy.mock.calls[0] as [string, { result: DrillResult }]
    expect(payload.result.kind).toBe('trace')
    expect(payload.result.lane).toBe('arcade')
    expect(payload.result.score).toBeGreaterThanOrEqual(0)
    expect(payload.result.score).toBeLessThanOrEqual(100)
    expect(payload.result.drillId).toBe('d1') // the first item played
    expect(updateSpy).not.toHaveBeenCalled() // the RPC exists -- the fallback path never runs
  })

  it('every DrillResult.score lands in [0, 100] even for a run of all misses', async () => {
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(false)
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(1))
    const [, payload] = rpcSpy.mock.calls[0] as [string, { result: DrillResult }]
    expect(payload.result.score).toBe(0)
  })

  it('the combo-weighted raw total survives into the run summary alongside the normalised score', async () => {
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getByText(/raw points/)).toBeTruthy())
  })

  it('falls back to the direct read-modify-write when the RPC is missing (pre-0009 schema)', async () => {
    rpcError = { code: '42883', message: 'function public.append_drill_result(jsonb) does not exist' }
    wellnessRow = { drill_results: [result({ drillId: 'other', kind: 'n-back', score: 10, at: '2026-09-01T00:00:00.000Z' })] }
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    const payload = updateSpy.mock.calls[0][0] as { drill_results: DrillResult[] }
    expect(payload.drill_results).toHaveLength(2) // the one pre-existing row plus exactly one new run row
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('creates the wellness row in the fallback when the update affects no rows', async () => {
    rpcError = { code: 'PGRST202' }
    updateAffectsRow = false
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1))
  })

  it('surfaces a visible, retryable save error without blocking the summary from showing', async () => {
    rpcError = { code: '42501', message: 'permission denied' }
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)

    await waitFor(() => expect(screen.getByText(/run complete/)).toBeTruthy())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('could not be saved')

    rpcError = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(2))
  })

  it("refreshes the session's de-rot streak and last date after a successful save", async () => {
    mocks.learnerState = learnerState({ streak: { exerciseDays: 2, derotDays: 0, lastExerciseDate: '2026-09-05', lastDerotDate: null } })
    rpcData = [result({ drillId: 'd1', at: '2026-09-06T12:00:00.000Z' })]
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)

    await waitFor(() => expect(mocks.setLearnerState).toHaveBeenCalledTimes(1))
    const next = mocks.setLearnerState.mock.calls[0][0] as LearnerState
    expect(next.streak.derotDays).toBe(1)
    expect(next.streak.lastDerotDate).toBe('2026-09-06')
  })

  it('shows a designed empty state when the kind has no drill items', async () => {
    drillsRows = []
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('No items yet')).toBeTruthy())
  })

  it('rejects a kind that is not one of the twelve drills', () => {
    mocks.params.mockReturnValue({ kind: 'made-up' })
    render(<DerotArcadeRunnerPage />)
    expect(screen.getByText('This drill could not open')).toBeTruthy()
  })

  it('honors an explicit ?item= deep link for the first item of the run', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('item=d3'))
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d3')).toBeTruthy())
  })

  it('running it again after a completed run starts a fresh six-item run', async () => {
    render(<DerotArcadeRunnerPage />)
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getByText(/run complete/)).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))
    await waitFor(() => expect(screen.getByText(/^Item: /)).toBeTruthy())
    expect(screen.queryByText(/run complete/)).toBeNull()
  })
})
