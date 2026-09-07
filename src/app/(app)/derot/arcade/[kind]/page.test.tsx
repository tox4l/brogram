import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { Attempt, DrillItem, DrillResult, LearnerState, LessonProgress } from '@/lib/contracts'
import { LINE_BANK } from '@/lib/voice/lines'
import { clearQueryClient, getQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
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
  setLearnerState: vi.fn(),
  learnerState: null as LearnerState | null,
  play: vi.fn(),
  recordGoalDay: vi.fn(),
  recordAchievements: vi.fn(),
  hasPendingPrefsWrite: vi.fn(() => false),
}))
vi.mock('next/navigation', () => ({ useParams: () => mocks.params(), useSearchParams: () => mocks.searchParams() }))
vi.mock('@/store/session', () => ({
  useSession: (selector: (session: { user: { id: string }; learnerState: LearnerState | null; setLearnerState: typeof mocks.setLearnerState }) => unknown) =>
    selector({ user: { id: 'student' }, learnerState: mocks.learnerState, setLearnerState: mocks.setLearnerState }),
}))
vi.mock('@/lib/sound/manager', () => ({ play: mocks.play, withInterfaceSounds: (run: () => void) => run() }))
// X2/X7/X1: the two reward writers are unit-tested against real
// implementations in their own lane (record.test.ts) -- this file only
// proves the de-rot runner *calls* them, with a context built from the run
// it just saved, so real supabase table shapes for `user_achievements` / the
// prefs write never need mocking here.
//
// Fix round 3 (W2FIX-F3): `@/lib/query/client` is now the REAL module, not a
// bare-object mock -- the page mounts a genuine `useQuery` observer
// (`useKeepAttemptsResident`) to keep `qk.attempts` resident past its
// five-minute `gcTime`, which needs a real `QueryClient`/`QueryClientProvider`
// underneath it to prove anything. `getQueryClient()`'s cache is seeded and
// read directly (`setQueryData`/`getQueryData`) and `invalidateQueries` is
// spied on, rather than mocking the module away.
vi.mock('@/lib/rewards/record', () => ({ recordGoalDay: mocks.recordGoalDay, recordAchievements: mocks.recordAchievements }))
// F3-2: the wellness dock's own writer is unit-tested against the real
// implementation in prefsMutation.test.ts -- this file only proves the
// runner consults the guard before invalidating.
vi.mock('@/app/(app)/account/prefsMutation', () => ({ hasPendingPrefsWrite: mocks.hasPendingPrefsWrite }))
vi.mock('@/components/derot', () => ({
  DrillRunner: ({ item, onResult, paused }: { item: DrillItem; onResult: (result: DrillResult) => void; paused?: boolean }) => (
    <div>
      <p>Item: {item.id}</p>
      <p>Paused: {String(Boolean(paused))}</p>
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
let wellnessRow: { drill_results: DrillResult[]; prefs?: Record<string, unknown> } | null
let rpcError: { code?: string; message?: string } | null
let rpcData: DrillResult[]
let updateAffectsRow: boolean
let insertShouldFail: boolean
const rpcSpy = vi.fn()
const updateSpy = vi.fn()
const insertSpy = vi.fn()
const integrityInsertSpy = vi.fn()

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
      // fix round 1, I11: de-rot must never touch integrity_events at all. If the
      // page still mounted lockdown, this branch would be hit on a blur/idle
      // event; its own spy lets the test assert zero calls instead of just
      // "the table was never queried at page-load time".
      if (table === 'integrity_events') {
        return { insert: (payload: Record<string, unknown>) => { integrityInsertSpy(payload); return Promise.resolve({ error: null }) } }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

/**
 * Fix round 3 (W2FIX-F3): wraps the page in a real `QueryClientProvider`
 * bound to the same singleton `getQueryClient()` the page's own imports
 * resolve to -- so `useKeepAttemptsResident`'s observer, and every
 * `setQueryData`/`getQueryData`/`invalidateQueries` call a test makes
 * directly against `getQueryClient()`, all operate on one shared cache,
 * exactly like production's `QueryProvider` wrapping the whole (app) shell.
 */
function renderPage() {
  return render(
    <QueryClientProvider client={getQueryClient()}>
      <DerotArcadeRunnerPage />
    </QueryClientProvider>,
  )
}

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

let invalidateSpy: MockInstance

beforeEach(() => {
  vi.clearAllMocks()
  // Fix round 3 (W2FIX-F3): a fresh, unmocked `QueryClient` per test, since
  // `getQueryClient()` is now the real module-level browser singleton.
  clearQueryClient()
  invalidateSpy = vi.spyOn(getQueryClient(), 'invalidateQueries')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-06T12:00:00.000Z'))
  mocks.params.mockReturnValue({ kind: 'trace' })
  mocks.searchParams.mockReturnValue(new URLSearchParams())
  mocks.learnerState = learnerState()
  drillsRows = sixDrillRows()
  wellnessRow = { drill_results: [] }
  rpcError = null
  rpcData = []
  updateAffectsRow = true
  insertShouldFail = false
  mocks.hasPendingPrefsWrite.mockReturnValue(false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  clearQueryClient()
})

describe('Arcade runner', () => {
  it('picks a never-played item over one already played', async () => {
    wellnessRow = { drill_results: [result({ drillId: 'd1', at: '2026-09-01T08:00:00.000Z' })] }
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d2')).toBeTruthy())
  })

  it('mounts no lockdown at all: a blur never touches integrity_events (fix round 1, I11)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())

    fireEvent(window, new Event('blur'))
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    fireEvent(document, new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    fireEvent(document, new Event('visibilitychange'))

    expect(screen.queryByTestId('lockdown-overlay')).toBeNull()
    expect(integrityInsertSpy).not.toHaveBeenCalled()
  })

  it('pauses the item (and its clock) while the tab is hidden, resuming when it comes back (fix round 1, I3)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Paused: false')).toBeTruthy())

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(screen.getByText('Paused: true')).toBeTruthy())

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(screen.getByText('Paused: false')).toBeTruthy())
  })

  it('a run is six items -- a miss on item 1 shows item 2 next instead of the summary', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    await answerCurrent(false)
    await waitFor(() => expect(screen.getByText('Item: d2')).toBeTruthy())
    expect(screen.queryAllByText(/run complete/i).length).toBe(0)
  })

  it('a pool of three items shortens the run to three instead of repeating an item (fix round 2, N3)', async () => {
    drillsRows = ['d1', 'd2', 'd3'].map((id) => drillRow({ id }))
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())

    const seenIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const label = await screen.findByText(/^Item: /)
      seenIds.push(label.textContent!.replace('Item: ', ''))
      await answerCurrent(true)
    }
    // All three distinct items were shown, in some order, with no repeat.
    expect(new Set(seenIds).size).toBe(3)

    // The run ends at three -- it does not wait for a fourth (repeated) item.
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    const [, payload] = rpcSpy.mock.calls[0] as [string, { result: DrillResult }]
    expect(payload.result.score).toBeGreaterThanOrEqual(0)
    expect(payload.result.score).toBeLessThanOrEqual(100)
  })

  it('the item counter never reads past RUN_SIZE, even during the post-answer pause after the sixth item (fix round 1, I1)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 5; i++) await answerCurrent(true)
    // Answer the sixth item but check the counter DURING the pause, before run-complete shows.
    const itemLabel = await screen.findByText(/^Item: /)
    const id = itemLabel.textContent!.replace('Item: ', '')
    fireEvent.click(screen.getByRole('button', { name: `Correct for ${id}` }))
    expect(screen.getByText('Item 6 of 6')).toBeTruthy()
    expect(screen.queryByText('Item 7 of 6')).toBeNull()
  })

  it('completing all six items shows the run summary, and appends exactly ONE DrillResult through the RPC', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)

    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    const [, payload] = rpcSpy.mock.calls[0] as [string, { result: DrillResult }]
    expect(payload.result.kind).toBe('trace')
    expect(payload.result.lane).toBe('arcade')
    expect(payload.result.score).toBeGreaterThanOrEqual(0)
    expect(payload.result.score).toBeLessThanOrEqual(100)
    expect(payload.result.drillId).toBe('d1') // the first item played
    expect(updateSpy).not.toHaveBeenCalled() // the RPC exists -- the fallback path never runs
  })

  it('every DrillResult.score lands in [0, 100] even for a run of all misses, and shows "First run logged" rather than a false "New best" (fix round 1, C2)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(false)
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(1))
    const [, payload] = rpcSpy.mock.calls[0] as [string, { result: DrillResult }]
    expect(payload.result.score).toBe(0)

    expect(screen.getByText('First run logged')).toBeTruthy()
    expect(screen.queryByText('New best')).toBeNull()
  })

  it('only shows "New best" when this run genuinely beats a real previous best (fix round 1, C2)', async () => {
    // drillId 'd7' (not one of the six items in the bank) so pickDrillItem's
    // never-played preference does not skip over d1 for this history row.
    wellnessRow = { drill_results: [result({ drillId: 'd7', kind: 'trace', score: 10, at: '2026-09-01T00:00:00.000Z' })] }
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    expect(screen.getByText('New best')).toBeTruthy()
    expect(screen.queryByText('First run logged')).toBeNull()
  })

  it('the combo-weighted raw total survives into the run summary alongside the normalised score', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getByText(/combo points/)).toBeTruthy())
  })

  it('shows a hit/miss chip per item, in the order they were played (fix round 2, item 5)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (const correct of [true, true, false, true, false, true]) await answerCurrent(correct)
    await waitFor(() => expect(screen.getByText('Where it went')).toBeTruthy())
    expect(screen.getByLabelText('Item 1: correct')).toBeTruthy()
    expect(screen.getByLabelText('Item 3: missed')).toBeTruthy()
    expect(screen.getByLabelText('Item 5: missed')).toBeTruthy()
    expect(screen.getByLabelText('Item 6: correct')).toBeTruthy()
  })

  it('running it again does not re-serve the same six items (fix round 1, I5)', async () => {
    // Eight items in the bank: run 1 plays exactly six of them, leaving two
    // genuinely never-played items for run 2 to prefer -- the shape that
    // actually distinguishes "the session knows all six were played" from
    // "the session only knows the first one was" (I5's bug).
    drillsRows = [...sixDrillRows(), drillRow({ id: 'd7' }), drillRow({ id: 'd8' })]
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    const firstRunIds: string[] = []
    for (let i = 0; i < 6; i++) {
      const label = await screen.findByText(/^Item: /)
      firstRunIds.push(label.textContent!.replace('Item: ', ''))
      await answerCurrent(true)
    }
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    expect(firstRunIds).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'])

    fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))
    await waitFor(() => expect(screen.getByText(/^Item: /)).toBeTruthy())
    const secondRunFirstId = (await screen.findByText(/^Item: /)).textContent!.replace('Item: ', '')
    // A bug that only remembers the aggregate row's first item (d1) as played
    // would treat d2-d6 as never-played too, and re-serve one of them ahead
    // of the genuinely-unplayed d7/d8. The fix must reach the truly fresh pool.
    expect(['d7', 'd8']).toContain(secondRunFirstId)
  })

  it('falls back to the direct read-modify-write when the RPC is missing (pre-0009 schema)', async () => {
    rpcError = { code: '42883', message: 'function public.append_drill_result(jsonb) does not exist' }
    wellnessRow = { drill_results: [result({ drillId: 'other', kind: 'n-back', score: 10, at: '2026-09-01T00:00:00.000Z' })] }
    renderPage()
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
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1))
  })

  it('surfaces a visible, retryable save error (from the voice bank) without blocking the summary from showing', async () => {
    rpcError = { code: '42501', message: 'permission denied' }
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)

    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    const alert = await screen.findByRole('alert')
    // TI-3: a non-empty check survives replacing line('error.save') with the
    // raw thrown error itself (`String(err)`) -- pinning against the bank's
    // own three variants is the only assertion a mutation like that trips.
    // The message text is the alert's own <p> only -- the alert region also
    // wraps the "Retry save" button, so a whole-region textContent check
    // would never equal one bare variant string.
    expect(LINE_BANK['error.save'].variants).toContain(alert.querySelector('p')!.textContent)

    rpcError = null
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(2))
  })

  it("refreshes the session's de-rot streak and last date after a successful save", async () => {
    mocks.learnerState = learnerState({ streak: { exerciseDays: 2, derotDays: 0, lastExerciseDate: '2026-09-05', lastDerotDate: null } })
    rpcData = [result({ drillId: 'd1', at: '2026-09-06T12:00:00.000Z' })]
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)

    await waitFor(() => expect(mocks.setLearnerState).toHaveBeenCalledTimes(1))
    const next = mocks.setLearnerState.mock.calls[0][0] as LearnerState
    expect(next.streak.derotDays).toBe(1)
    expect(next.streak.lastDerotDate).toBe('2026-09-06')
  })

  it('invalidates the shared wellness cache once a save succeeds, and not when it fails (X2)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['wellness', 'student'] }))
  })

  it('does not invalidate the wellness cache while a dock prefs write is queued (F3-2)', async () => {
    mocks.hasPendingPrefsWrite.mockReturnValue(true)
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    expect(mocks.hasPendingPrefsWrite).toHaveBeenCalledWith('student')
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('does not invalidate the wellness cache, or record a goal day / achievements, when the save fails (X2)', async () => {
    rpcError = { code: '42501', message: 'permission denied' }
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(mocks.recordGoalDay).not.toHaveBeenCalled()
    expect(mocks.recordAchievements).not.toHaveBeenCalled()
  })

  it("calls recordGoalDay with a context whose drillResults carry the run just saved (X7)", async () => {
    // The server's own returned array is what the ctx is built from -- give the
    // RPC mock a realistic response (the appended run) rather than the default `[]`.
    rpcData = [result({ drillId: 'd1', kind: 'trace', lane: 'arcade', at: '2026-09-06T12:00:00.000Z' })]
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(mocks.recordGoalDay).toHaveBeenCalledTimes(1))
    const [, calledUserId, ctx] = mocks.recordGoalDay.mock.calls[0] as [unknown, string, { drillResults: DrillResult[] }]
    expect(calledUserId).toBe('student')
    expect(ctx.drillResults.some((r) => r.kind === 'trace' && r.lane === 'arcade')).toBe(true)
  })

  it("builds the ctx with the REAL lessonProgress and attempts off the query cache, not empty arrays (F3-1)", async () => {
    // F3-1: without this, a mixed day (a walkthrough completed earlier today
    // plus this de-rot run) would undercount `winsToday` and silently drop
    // today's goal day -- reproducing X7 one layer down. Seeded directly on
    // the real cache (keyed, not positional) rather than a mocked
    // `getQueryData` -- qk.achievements is left unseeded so `held` still
    // resolves to `[]`.
    const todayLessonProgress: LessonProgress = { lessonId: 'l1', userId: 'student', cloId: 'l1', status: 'completed', blockIndex: 5, checksPassed: 1, checksFailed: 0, lessonVersion: 1, startedAt: '2026-09-06T08:50:00.000Z', completedAt: '2026-09-06T09:00:00.000Z', updatedAt: '2026-09-06T09:00:00.000Z' }
    const todayAttempt: Attempt = { id: 'a1', userId: 'student', exerciseId: 'e1', code: '', results: [], passed: true, durationMs: 0, hintCount: 0, createdAt: '2026-09-06T08:00:00.000Z' }
    getQueryClient().setQueryData(qk.lessonProgress('student'), [todayLessonProgress])
    getQueryClient().setQueryData(qk.attempts('student'), [todayAttempt])
    rpcData = [result({ drillId: 'd1', kind: 'trace', lane: 'arcade', at: '2026-09-06T12:00:00.000Z' })]
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(mocks.recordGoalDay).toHaveBeenCalledTimes(1))
    const [, , ctx] = mocks.recordGoalDay.mock.calls[0] as [unknown, string, { lessonProgress: unknown[]; attempts: unknown[] }]
    expect(ctx.lessonProgress).toEqual([todayLessonProgress])
    expect(ctx.attempts).toEqual([todayAttempt])
  })

  it('F3 fix round 3: an attempts row seeded before any observer survives an idle five minutes on this screen, so recordGoalDay still sees it in context', async () => {
    // Reproduces the exact hazard the finding named: nothing under
    // src/app/(app)/derot mounted an observer on qk.attempts, so TanStack's
    // default five-minute gcTime silently dropped a row `QuerySeed` had
    // already put in the cache before this screen's own observer attached.
    // `shouldAdvanceTime` keeps real wall-clock time ticking underneath the
    // faked one (mirrors lesson.test.tsx's own R1 test) so `answerCurrent`'s
    // real setTimeout waits and testing-library's polling both keep working;
    // only the explicit `advanceTimersByTimeAsync` call jumps the five minutes.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.setSystemTime(new Date('2026-09-06T12:00:00.000Z'))
      const seededAttempt: Attempt = { id: 'a1', userId: 'student', exerciseId: 'e1', code: '', results: [], passed: true, durationMs: 0, hintCount: 0, createdAt: '2026-09-06T08:00:00.000Z' }
      // Seeded before render -- no observer exists on this key yet, exactly
      // like `QuerySeed`'s server-side hydration landing before any client
      // component mounts.
      getQueryClient().setQueryData(qk.attempts('student'), [seededAttempt])
      rpcData = [result({ drillId: 'd1', kind: 'trace', lane: 'arcade', at: '2026-09-06T12:00:00.000Z' })]
      renderPage()
      await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())

      // No other observer anywhere in this test subscribes to qk.attempts --
      // only this page's own `useKeepAttemptsResident` observer can be
      // keeping the row alive past this mark.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1_000)

      for (let i = 0; i < 6; i++) await answerCurrent(true)
      await waitFor(() => expect(mocks.recordGoalDay).toHaveBeenCalledTimes(1))
      const [, , ctx] = mocks.recordGoalDay.mock.calls[0] as [unknown, string, { attempts: unknown[] }]
      expect(ctx.attempts).toEqual([seededAttempt])
    } finally {
      vi.useRealTimers()
    }
  })

  it("calls recordAchievements with a context whose drillResults carry the run just saved (X1)", async () => {
    rpcData = [result({ drillId: 'd1', kind: 'trace', lane: 'arcade', at: '2026-09-06T12:00:00.000Z' })]
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(mocks.recordAchievements).toHaveBeenCalledTimes(1))
    const [, calledUserId, ctx, held] = mocks.recordAchievements.mock.calls[0] as [unknown, string, { drillResults: DrillResult[] }, readonly string[]]
    expect(calledUserId).toBe('student')
    expect(ctx.drillResults.some((r) => r.kind === 'trace' && r.lane === 'arcade')).toBe(true)
    expect(held).toEqual([])
  })

  it('plays drill.hit at run end on top of the per-item hits, and best only when this run genuinely beats a real previous best (X8)', async () => {
    wellnessRow = { drill_results: [result({ drillId: 'd7', kind: 'trace', score: 10, at: '2026-09-01T00:00:00.000Z' })] }
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    const hitCalls = mocks.play.mock.calls.filter(([kind]) => kind === 'drill.hit').length
    expect(hitCalls).toBe(7) // six per-item hits (onItemResult) plus one run-end hit (finishRun)
    expect(mocks.play.mock.calls.some(([kind]) => kind === 'best')).toBe(true)
  })

  it('never plays best on a first run of a kind, even with a perfect run', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d1')).toBeTruthy())
    for (let i = 0; i < 6; i++) await answerCurrent(true)
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    expect(mocks.play.mock.calls.some(([kind]) => kind === 'best')).toBe(false)
  })

  it('shows a designed empty state when the kind has no drill items', async () => {
    drillsRows = []
    renderPage()
    await waitFor(() => expect(screen.getByText('No items yet')).toBeTruthy())
  })

  it('rejects a kind that is not one of the twelve drills', () => {
    mocks.params.mockReturnValue({ kind: 'made-up' })
    renderPage()
    expect(screen.getByText('This drill could not open')).toBeTruthy()
  })

  it('honors an explicit ?item= deep link for the first item of the run', async () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('item=d3'))
    renderPage()
    await waitFor(() => expect(screen.getByText('Item: d3')).toBeTruthy())
  })
})
