import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Attempt, Clo, DrillResult, LearnerState } from '@/lib/contracts'
import { downloadReportPdf } from './pdf'
import { ReportPages } from './ReportPages'

vi.mock('jspdf', () => ({ jsPDF: vi.fn() }))
vi.mock('html2canvas-pro', () => ({ default: vi.fn() }))

function makeState(): LearnerState {
  return {
    userId: 'u1',
    profile: {
      displayName: 'Ada Lovelace',
      learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive',
      verbosity: 'short',
      motivation: { why: 'grades', beyondCourses: false, depth: 'pass', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'INFS1101',
    path: [],
    nextExerciseIds: [],
    mastery: {
      'INFS1101-1': {
        userId: 'u1',
        cloId: 'INFS1101-1',
        score: 62,
        chain: 1,
        patternsPassed: ['accumulate'],
        closed: false,
        lastAttemptAt: null,
      },
    },
    recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0,
    integrityScore: 0,
    accountStatus: 'active',
    version: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

const clos: Clo[] = [
  {
    id: 'INFS1101-1',
    course: 'INFS1101',
    ordinal: 1,
    outcome: 'Write a loop that accumulates a total',
    topics: [],
    prerequisites: [],
    patterns: ['accumulate'],
    assessableInCode: true,
  },
]

const attempts: Attempt[] = []

const drillResults: DrillResult[] = [
  { drillId: 'd1', kind: 'trace', correct: true, timeMs: 1000, score: 70, at: '2026-09-01T00:00:00.000Z' },
  { drillId: 'd2', kind: 'trace', correct: true, timeMs: 1000, score: 90, at: '2026-09-02T00:00:00.000Z' },
]

describe('ReportPages', () => {
  it('renders three A4 pages with the focus line, a CLO row, and the drill summary', () => {
    render(
      <ReportPages
        state={makeState()}
        clos={clos}
        attempts={attempts}
        drillResults={drillResults}
        focus="Keep drilling accumulator loops."
        generatedAt="2026-09-05T00:00:00.000Z"
        displayName="Ada Lovelace"
      />
    )

    const pages = document.querySelectorAll('[data-report-page]')
    expect(pages).toHaveLength(3)

    expect(screen.getByText('Keep drilling accumulator loops.')).toBeTruthy()
    expect(screen.getByText('Write a loop that accumulates a total')).toBeTruthy()
    expect(screen.getByText('best 90 · mean 80 · 2 runs')).toBeTruthy()
  })
})

describe('downloadReportPdf', () => {
  it('throws a clear error when no [data-report-page] element exists inside the given root', async () => {
    const root = document.createElement('div')
    await expect(downloadReportPdf(root, 'report.pdf')).rejects.toThrow('[data-report-page]')
  })
})
