'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { DownloadReportButton, REPORT_PAGE_HEIGHT_PX, REPORT_PAGE_WIDTH_PX, ReportPages } from '@/components/report'
import { fetchReportData, type ReportData } from './data'

/**
 * The Planner never writes a `focus` line into Learner State today (only
 * `path` and `nextExerciseIds` are persisted after a plan refresh; see
 * `useExerciseLoop.queueNext`), and the dashboard has nowhere else that
 * stores one. Until that lands, every report shows the same sentence the
 * Planner itself falls back to when it has nothing to say yet.
 */
const FOCUS_FALLBACK = 'Your next exercises are still being prepared.'

type LoadState = { key: string; data: ReportData | null; failed: boolean }

function useReportData(userId: string | null, courseCode: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<LoadState | null>(null)
  const key = `${userId ?? ''}:${courseCode ?? ''}:${attempt}`
  const needed = Boolean(userId && courseCode)

  useEffect(() => {
    if (!needed || !userId || !courseCode) return
    let cancelled = false

    async function load() {
      try {
        const client = createClient()
        const data = await fetchReportData(client, userId!, courseCode!)
        if (!cancelled) setResult({ key, data, failed: false })
      } catch {
        if (!cancelled) setResult({ key, data: null, failed: true })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [userId, courseCode, key, needed])

  // A changed account or course must never render the previous student's numbers.
  const current = needed && result?.key === key ? result : null
  return {
    data: current?.data ?? null,
    failed: current?.failed ?? false,
    loading: needed && !current,
    retry: () => setAttempt((value) => value + 1),
  }
}

export default function ReportsPage() {
  const { user, learnerState } = useSession()
  const courseCode = learnerState?.currentCourse ?? null
  const report = useReportData(user?.id ?? null, courseCode)
  const [generatedAt] = useState(() => new Date().toISOString())

  const previewWrapperRef = useRef<HTMLDivElement>(null)
  // The download button screenshots this container, so it is never scaled: an
  // offscreen full-size copy, kept out of the viewport and out of the a11y tree.
  const downloadSourceRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [naturalHeight, setNaturalHeight] = useState(REPORT_PAGE_HEIGHT_PX)

  useLayoutEffect(() => {
    function measure() {
      const availableWidth = previewWrapperRef.current?.clientWidth ?? REPORT_PAGE_WIDTH_PX
      setScale(availableWidth > 0 ? Math.min(1, availableWidth / REPORT_PAGE_WIDTH_PX) : 1)
      const contentHeight = downloadSourceRef.current?.scrollHeight
      if (contentHeight) setNaturalHeight(contentHeight)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [report.data, learnerState])

  if (!courseCode) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-medium tracking-tight">Your progress report</h1>
        <div className="rounded-xl border border-dashed border-input p-6">
          <p className="text-sm font-medium">Choose a course to see your report.</p>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">Your progress report is built from a course&apos;s outcomes, mastery, and de-rot scores, so pick a course first.</p>
          <Link href="/onboarding" className="mt-3 inline-block rounded-sm text-sm font-medium text-emerald-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">Choose a course</Link>
        </div>
      </div>
    )
  }

  const displayName = learnerState?.profile.displayName.trim() || 'Your progress'
  const fileName = `brogram-report-${generatedAt.slice(0, 10)}.pdf`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Your progress report</h1>
          <p className="mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">Mastery per outcome, patterns passed, mistakes over time, time spent, and your de-rot scores. Rendered in your browser; nothing is generated on the server.</p>
        </div>
        {report.data && <DownloadReportButton containerRef={downloadSourceRef} fileName={fileName} />}
      </div>

      {report.loading && <p role="status" className="text-sm text-muted-foreground">Preparing your report.</p>}

      {report.failed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
          <p className="text-sm text-foreground">Your report could not load.</p>
          <Button variant="outline" onClick={report.retry}>Try again</Button>
        </div>
      )}

      {report.data && learnerState && (
        <>
          <div
            ref={previewWrapperRef}
            data-testid="report-preview"
            className="overflow-x-auto rounded-xl border border-border bg-muted/30 p-4"
          >
            <div style={{ width: REPORT_PAGE_WIDTH_PX * scale, height: naturalHeight * scale }}>
              <div style={{ width: REPORT_PAGE_WIDTH_PX, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <ReportPages
                  state={learnerState}
                  clos={report.data.clos}
                  attempts={report.data.attempts}
                  drillResults={report.data.drillResults}
                  focus={FOCUS_FALLBACK}
                  generatedAt={generatedAt}
                  displayName={displayName}
                />
              </div>
            </div>
          </div>

          <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: -100000, width: REPORT_PAGE_WIDTH_PX }}>
            <div ref={downloadSourceRef} data-testid="report-download-source">
              <ReportPages
                state={learnerState}
                clos={report.data.clos}
                attempts={report.data.attempts}
                drillResults={report.data.drillResults}
                focus={FOCUS_FALLBACK}
                generatedAt={generatedAt}
                displayName={displayName}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
