import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { ACHIEVEMENTS, type Attempt, type Clo, type DrillResult, type LearnerState } from '@/lib/contracts'
import ReportsPage from './page'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  fetchReportData: vi.fn(),
  downloadReportPdf: vi.fn(),
}))

// `useWellness`/`useAchievements` (`src/lib/query/hooks.ts`) call `useSession`
// with a selector, unlike this page's own direct call -- the mock has to
// honour both call shapes or the selector form receives the whole session
// object where it expects a string.
vi.mock('@/store/session', () => ({
  useSession: (selector?: (session: ReturnType<typeof mocks.session>) => unknown) =>
    (selector ? selector(mocks.session()) : mocks.session()),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'user_achievements') return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      if (table === 'wellness') return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
      throw new Error(`Unexpected table in this test: ${table}`)
    },
  }),
}))
// DownloadReportButton imports `downloadReportPdf` from its own relative './pdf'; mocking the
// module by its resolved path intercepts that import even though this test never names it.
vi.mock('@/components/report/pdf', () => ({ downloadReportPdf: mocks.downloadReportPdf }))
vi.mock('./data', () => ({ fetchReportData: mocks.fetchReportData }))

function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'learner-1',
    profile: {
      displayName: 'Ada Lovelace', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: 'grades', beyondCourses: false, depth: 'pass', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'INFS1101',
    path: [],
    nextExerciseIds: [],
    mastery: {},
    recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const clos: Clo[] = [{
  id: 'INFS1101-1', course: 'INFS1101', ordinal: 1, outcome: 'Write a loop that accumulates a total',
  topics: [], prerequisites: [], patterns: ['accumulate'], assessableInCode: true,
}]

const attempts: Attempt[] = [{
  id: 'a1', userId: 'learner-1', exerciseId: 'ex-1', code: '', results: [],
  passed: true, durationMs: 2_700_000, hintCount: 0, createdAt: '2026-09-01T00:00:00.000Z',
}]

const drillResults: DrillResult[] = [
  { drillId: 'd1', kind: 'trace', correct: true, timeMs: 1000, score: 70, at: '2026-09-01T00:00:00.000Z', lane: 'arcade' },
  { drillId: 'd2', kind: 'trace', correct: true, timeMs: 1000, score: 90, at: '2026-09-02T00:00:00.000Z', lane: 'arcade' },
]

function session(state: LearnerState | null = learnerState()) {
  return { user: { id: 'learner-1' }, profile: { id: 'learner-1', account_status: 'active', restricted_until: null }, learnerState: state, setLearnerState: vi.fn() }
}

function wrapper() {
  const client = makeQueryClient()
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** `makeQueryClient()`'s default `retry: 1` would consume this suite's
 *  reject-then-resolve mock on an automatic retry before the "Try again"
 *  button is ever clicked -- retries are off here so the mock sequence
 *  matches the user-driven retry this test actually exercises. */
function wrapperNoRetry() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

async function openReportTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Report' }))
}

beforeEach(() => {
  // Only Date is faked (for a deterministic generatedAt / file name); setTimeout and friends
  // stay real so findBy*/waitFor keep working normally.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-06T12:00:00.000Z'))
  mocks.session.mockReturnValue(session())
  mocks.fetchReportData.mockReset().mockResolvedValue({ clos, attempts, drillResults })
  mocks.downloadReportPdf.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('reports page', () => {
  it('shows an empty state pointing to onboarding when no course is chosen', () => {
    mocks.session.mockReturnValue(session(learnerState({ currentCourse: null })))
    render(<ReportsPage />, { wrapper: wrapper() })
    expect(screen.getByText('Choose a course to see progress.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Choose a course' }).getAttribute('href')).toBe('/onboarding')
    expect(mocks.fetchReportData).not.toHaveBeenCalled()
  })

  it('defaults to the Trophies tab, never fetching the report until it is opened', async () => {
    render(<ReportsPage />, { wrapper: wrapper() })
    expect((await screen.findByRole('tab', { name: 'Trophies' })).getAttribute('aria-selected')).toBe('true')
    expect(mocks.fetchReportData).not.toHaveBeenCalled()
  })

  it('renders every achievement on the Trophies tab and every locked one states its own rule -- nothing is a mystery box', async () => {
    render(<ReportsPage />, { wrapper: wrapper() })
    for (const achievement of ACHIEVEMENTS) {
      expect(await screen.findByText(achievement.how)).toBeTruthy()
    }
    expect(mocks.fetchReportData).not.toHaveBeenCalled()
  })

  it('fetches the report only once the Report tab is opened', async () => {
    render(<ReportsPage />, { wrapper: wrapper() })
    expect(mocks.fetchReportData).not.toHaveBeenCalled()
    await openReportTab()
    await waitFor(() => expect(mocks.fetchReportData).toHaveBeenCalledWith(expect.anything(), 'learner-1', 'INFS1101'))
  })

  it('loads clos, attempts, and drill results for the current course and passes them through to the report', async () => {
    render(<ReportsPage />, { wrapper: wrapper() })
    await openReportTab()
    const preview = await screen.findByTestId('report-preview')
    expect(mocks.fetchReportData).toHaveBeenCalledWith(expect.anything(), 'learner-1', 'INFS1101')
    // Attempts: one 45-minute attempt on one day.
    expect(within(preview).getByText('45m total · 1 active day')).toBeTruthy()
    // Drill results: two 'trace' runs, best 90 / mean 80.
    expect(within(preview).getByText('best 90 · mean 80 · 2 runs')).toBeTruthy()
  })

  it('shows the Planner fallback focus sentence when no focus line is persisted', async () => {
    render(<ReportsPage />, { wrapper: wrapper() })
    await openReportTab()
    const preview = await screen.findByTestId('report-preview')
    expect(within(preview).getByText('Next exercises are still being prepared.')).toBeTruthy()
  })

  it('passes a persisted focus line through to the report instead of the fallback', async () => {
    // `focus` rides along as an extra jsonb key on LearnerState (not part of the frozen
    // contract), written by onboarding and by useExerciseLoop's plan-refresh.
    const withFocus = { ...learnerState(), focus: 'Work on loops next.' }
    mocks.session.mockReturnValue(session(withFocus))
    render(<ReportsPage />, { wrapper: wrapper() })
    await openReportTab()
    const preview = await screen.findByTestId('report-preview')
    expect(within(preview).getByText('Work on loops next.')).toBeTruthy()
    expect(within(preview).queryByText('Next exercises are still being prepared.')).toBeNull()
  })

  it('renders the report even with zero attempts and zero drill results', async () => {
    mocks.fetchReportData.mockResolvedValue({ clos, attempts: [], drillResults: [] })
    render(<ReportsPage />, { wrapper: wrapper() })
    await openReportTab()
    const preview = await screen.findByTestId('report-preview')
    expect(within(preview).getByText('No attempts logged yet. Time spent appears after the first exercise.')).toBeTruthy()
    expect(within(preview).getAllByText('Not attempted').length).toBeGreaterThan(0)
  })

  it('wires the download button to the unscaled report container and a dated file name', async () => {
    render(<ReportsPage />, { wrapper: wrapper() })
    await openReportTab()
    const downloadSource = await screen.findByTestId('report-download-source')

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(mocks.downloadReportPdf).toHaveBeenCalledTimes(1))

    const [root, fileName] = mocks.downloadReportPdf.mock.calls[0]
    expect(root).toBe(downloadSource)
    expect(fileName).toBe('brogram-report-2026-09-06.pdf')
  })

  it('shows a retry affordance when the report fails to load and refetches on click', async () => {
    mocks.fetchReportData.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ clos, attempts, drillResults })
    render(<ReportsPage />, { wrapper: wrapperNoRetry() })
    await openReportTab()
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByTestId('report-preview')
    expect(mocks.fetchReportData).toHaveBeenCalledTimes(2)
  })
})
