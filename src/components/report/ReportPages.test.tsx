import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attempt, Clo, DrillResult, LearnerState } from '@/lib/contracts'
import { downloadReportPdf } from './pdf'
import { REPORT_PAGE_HEIGHT_PX, REPORT_PAGE_WIDTH_PX } from './ReportPage'
import { ReportPages } from './ReportPages'

const mocks = vi.hoisted(() => {
  const pdfInstance = {
    addPage: vi.fn(),
    addImage: vi.fn(),
    save: vi.fn(),
  }
  const jsPDFCtor = vi.fn(function jsPDF() {
    return pdfInstance
  })
  let canvasCallCount = 0
  const html2canvas = vi.fn(async (el: HTMLElement, options?: Record<string, unknown>) => {
    void el
    void options
    return { toDataURL: () => `data:image/png;fake-${canvasCallCount++}` }
  })
  return {
    pdfInstance,
    jsPDFCtor,
    html2canvas,
    resetCanvasCounter: () => {
      canvasCallCount = 0
    },
  }
})

vi.mock('jspdf', () => ({ jsPDF: mocks.jsPDFCtor }))
vi.mock('html2canvas-pro', () => ({ default: mocks.html2canvas }))

beforeEach(() => {
  mocks.jsPDFCtor.mockClear()
  mocks.pdfInstance.addPage.mockClear()
  mocks.pdfInstance.addImage.mockClear()
  mocks.pdfInstance.save.mockClear()
  mocks.html2canvas.mockClear()
  mocks.resetCanvasCounter()
})

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

  it('screenshots every report page in order and assembles them into one PDF', async () => {
    const { container } = render(
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
    const pages = Array.from(container.querySelectorAll<HTMLElement>('[data-report-page]'))
    expect(pages).toHaveLength(3)

    await downloadReportPdf(container, 'x.pdf')

    // html2canvas-pro: once per page, in DOM order, at scale 2.
    expect(mocks.html2canvas).toHaveBeenCalledTimes(3)
    mocks.html2canvas.mock.calls.forEach(([el, options], i) => {
      expect(el).toBe(pages[i])
      expect(options).toMatchObject({ scale: 2 })
    })

    // jsPDF: constructed once, in px units, at the A4-ratio page size.
    expect(mocks.jsPDFCtor).toHaveBeenCalledTimes(1)
    expect(mocks.jsPDFCtor).toHaveBeenCalledWith(
      expect.objectContaining({ unit: 'px', format: [REPORT_PAGE_WIDTH_PX, REPORT_PAGE_HEIGHT_PX] })
    )

    // addImage once per page, fed the canvas from that same page's html2canvas call, in order.
    expect(mocks.pdfInstance.addImage.mock.calls.map(call => call[0])).toEqual([
      'data:image/png;fake-0',
      'data:image/png;fake-1',
      'data:image/png;fake-2',
    ])

    // One addPage per page after the first, and exactly one save with the given file name.
    expect(mocks.pdfInstance.addPage).toHaveBeenCalledTimes(pages.length - 1)
    expect(mocks.pdfInstance.save).toHaveBeenCalledTimes(1)
    expect(mocks.pdfInstance.save).toHaveBeenCalledWith('x.pdf')
  })
})
