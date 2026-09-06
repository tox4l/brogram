import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attempt, Clo, DrillResult, LearnerState } from '@/lib/contracts'
import ReportsPage from './page'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  fetchReportData: vi.fn(),
  downloadReportPdf: vi.fn(),
}))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('./data', () => ({ fetchReportData: mocks.fetchReportData }))
// DownloadReportButton imports `downloadReportPdf` from its own relative './pdf'; mocking the
// module by its resolved path intercepts that import even though this test never names it.
vi.mock('@/components/report/pdf', () => ({ downloadReportPdf: mocks.downloadReportPdf }))

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
  { drillId: 'd1', kind: 'trace', correct: true, timeMs: 1000, score: 70, at: '2026-09-01T00:00:00.000Z' },
  { drillId: 'd2', kind: 'trace', correct: true, timeMs: 1000, score: 90, at: '2026-09-02T00:00:00.000Z' },
]

function session(state: LearnerState | null = learnerState()) {
  return { user: { id: 'learner-1' }, profile: { id: 'learner-1', account_status: 'active', restricted_until: null }, learnerState: state, setLearnerState: vi.fn() }
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
    render(<ReportsPage />)
    expect(screen.getByText('Choose a course to see your report.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Choose a course' }).getAttribute('href')).toBe('/onboarding')
    expect(mocks.fetchReportData).not.toHaveBeenCalled()
  })

  it('loads clos, attempts, and drill results for the current course and passes them through to the report', async () => {
    render(<ReportsPage />)
    const preview = await screen.findByTestId('report-preview')
    expect(mocks.fetchReportData).toHaveBeenCalledWith({}, 'learner-1', 'INFS1101')
    // Attempts: one 45-minute attempt on one day.
    expect(within(preview).getByText('45m total · 1 active day')).toBeTruthy()
    // Drill results: two 'trace' runs, best 90 / mean 80.
    expect(within(preview).getByText('best 90 · mean 80 · 2 runs')).toBeTruthy()
  })

  it('shows the Planner fallback focus sentence, since no focus line is persisted anywhere yet', async () => {
    render(<ReportsPage />)
    const preview = await screen.findByTestId('report-preview')
    expect(within(preview).getByText('Your next exercises are still being prepared.')).toBeTruthy()
  })

  it('renders the report even with zero attempts and zero drill results', async () => {
    mocks.fetchReportData.mockResolvedValue({ clos, attempts: [], drillResults: [] })
    render(<ReportsPage />)
    const preview = await screen.findByTestId('report-preview')
    expect(within(preview).getByText('No attempts logged yet. Time spent appears after the first exercise.')).toBeTruthy()
    expect(within(preview).getAllByText('Not attempted').length).toBeGreaterThan(0)
  })

  it('wires the download button to the unscaled report container and a dated file name', async () => {
    render(<ReportsPage />)
    const downloadSource = await screen.findByTestId('report-download-source')

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(mocks.downloadReportPdf).toHaveBeenCalledTimes(1))

    const [root, fileName] = mocks.downloadReportPdf.mock.calls[0]
    expect(root).toBe(downloadSource)
    expect(fileName).toBe('brogram-report-2026-09-06.pdf')
  })
})
