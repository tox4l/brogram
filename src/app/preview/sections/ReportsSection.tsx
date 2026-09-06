'use client'

import { useRef } from 'react'
import { DownloadReportButton, REPORT_PAGE_HEIGHT_PX, REPORT_PAGE_WIDTH_PX, ReportPages } from '@/components/report'
import {
  fixtureAttempts, fixtureDrillResults, fixtureLearnerState, fixtureReportClos, fixtureReportDisplayName, fixtureReportGeneratedAt,
} from '../fixtures'
import { Section } from './Section'

const SCALE = 0.62
const REPORT_TOTAL_HEIGHT = REPORT_PAGE_HEIGHT_PX * 3 + 64 // three ReportPage children, gap-8 between each

export function ReportsSection() {
  const containerRef = useRef<HTMLDivElement | null>(null)

  return (
    <Section id="reports" title="Reports" caption="The real three-page ReportPages with fixture Learner State, CLOs, attempts and drill results, scaled down to fit. Download PDF runs entirely in the browser against the unscaled report.">
      <DownloadReportButton containerRef={containerRef} fileName="preview-progress-report.pdf" />
      <div className="overflow-hidden rounded-xl border border-border bg-muted/20" style={{ width: REPORT_PAGE_WIDTH_PX * SCALE, height: REPORT_TOTAL_HEIGHT * SCALE }}>
        <div ref={containerRef} style={{ transform: `scale(${SCALE})`, transformOrigin: 'top left' }}>
          <ReportPages
            state={fixtureLearnerState}
            clos={fixtureReportClos}
            attempts={fixtureAttempts}
            drillResults={fixtureDrillResults}
            focus={fixtureLearnerState.focus}
            generatedAt={fixtureReportGeneratedAt}
            displayName={fixtureReportDisplayName}
          />
        </div>
      </div>
    </Section>
  )
}
