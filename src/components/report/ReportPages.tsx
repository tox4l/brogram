import type { Attempt, Clo, DrillResult, LearnerState } from '@/lib/contracts'
import { ReportPage } from './ReportPage'
import { deriveDrillScores, deriveFocusLine, deriveMasteryRows, deriveMistakeTrend, derivePatternsPassed, deriveTimeSpent } from './derive'
import { DrillScores } from './sections/DrillScores'
import { FocusLine } from './sections/FocusLine'
import { MasteryPerClo } from './sections/MasteryPerClo'
import { MistakeTrend } from './sections/MistakeTrend'
import { PatternsPassed } from './sections/PatternsPassed'
import { TimeSpent } from './sections/TimeSpent'

export interface ReportPagesProps {
  state: LearnerState
  clos: Clo[]
  attempts: Attempt[]
  drillResults: DrillResult[]
  focus: string
  generatedAt: string
  displayName: string
  /** I5, fix round 1 (Opus review of T2.3's `b509b0e`, not this file's own
   *  ownership -- edited only because `derive.ts`'s `deriveTimeSpent` signature
   *  changed underneath it): true when `attempts` is the report query's
   *  1000-row cap rather than the learner's complete history. Optional so
   *  every other, unrelated caller of this component keeps compiling. */
  attemptsTruncated?: boolean
}

/**
 * The whole progress report: three A4 pages, print-first. Every number on
 * the page is computed by derive.ts from these props; this component only
 * lays sections out. pdf.ts turns the rendered `[data-report-page]`
 * children into a PDF, one page per container, in DOM order.
 */
export function ReportPages({ state, clos, attempts, drillResults, focus, generatedAt, displayName, attemptsTruncated = false }: ReportPagesProps) {
  const focusLine = deriveFocusLine(focus, displayName, generatedAt)
  const masteryRows = deriveMasteryRows(state, clos)
  const patterns = derivePatternsPassed(state, clos)
  const mistakes = deriveMistakeTrend(state, attempts, generatedAt)
  const time = deriveTimeSpent(attempts, undefined, attemptsTruncated)
  const drills = deriveDrillScores(drillResults)

  return (
    <div data-report-root className="flex flex-col items-center gap-8">
      <ReportPage>
        <FocusLine data={focusLine} />
        <MasteryPerClo rows={masteryRows} />
      </ReportPage>
      <ReportPage>
        <PatternsPassed data={patterns} />
        <MistakeTrend data={mistakes} />
      </ReportPage>
      <ReportPage>
        <TimeSpent data={time} />
        <DrillScores groups={drills} />
      </ReportPage>
    </div>
  )
}
