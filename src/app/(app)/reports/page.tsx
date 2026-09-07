'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { LearnerState } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { useAchievements, useWellness } from '@/lib/query/hooks'
import { qk } from '@/lib/query/keys'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { DownloadReportButton, REPORT_PAGE_HEIGHT_PX, REPORT_PAGE_WIDTH_PX, ReportPages } from '@/components/report'
import { TrophyShelf } from '@/components/rewards/TrophyShelf'
import { fetchReportData, type ReportData } from './data'
import { useFreshlyUnlocked } from './lib'

/**
 * `focus` is not part of the frozen LearnerState contract; it rides along as an extra
 * jsonb key written by onboarding and by useExerciseLoop's plan-refresh on CLO close (see
 * both call sites). This sentence is the same fallback the Planner itself uses when it
 * has nothing to say yet, shown until a focus line has been persisted.
 */
const FOCUS_FALLBACK = 'Next exercises are still being prepared.'

type ReportsTab = 'trophies' | 'report'

/**
 * The Report tab's own narrow, capped query (spec 5.6 / brief step 1),
 * distinct from the shared `qk.attempts` the dashboard uses: this route reads
 * `qk.reportAttempts`, a key nothing else ever seeds or invalidates, so it is
 * never pre-warmed by the layout -- the query only exists once this
 * component mounts, which only happens once the Report tab panel opens
 * (`TabsContent`'s default `keepMounted={false}` unmounts the inactive
 * panel entirely, not just hides it). `courseCode` rides along in the key:
 * attempts themselves are not course-scoped, but the bundle this key also
 * covers (clos) is, so a course switch while this tab is open must not keep
 * serving the previous course's numbers.
 */
function useReportData(userId: string | null, courseCode: string | null) {
  const needed = Boolean(userId && courseCode)
  const query = useQuery<ReportData>({
    queryKey: [...qk.reportAttempts(userId ?? ''), courseCode ?? ''],
    queryFn: () => fetchReportData(createClient(), userId as string, courseCode as string),
    enabled: needed,
    // I4, fix round 1 (Opus review of b509b0e): `TabsContent`'s default
    // `keepMounted={false}` genuinely unmounts the inactive panel (the same
    // fact Step 1's "does not fire until opened" guarantee relies on), so
    // this query -- and its component -- is destroyed and recreated on every
    // Trophies <-> Report toggle. With no staleTime that recreation refetches
    // the whole bundle (clos, wellness, up to 1000 attempts) every single
    // time, for data that cannot have changed mid-session.
    staleTime: 60_000,
    gcTime: 300_000,
  })
  return {
    data: query.data ?? null,
    failed: needed && query.isError,
    loading: needed && query.isPending,
    retry: () => void query.refetch(),
  }
}

function ReportTab({ userId, courseCode, learnerState }: { userId: string | null; courseCode: string; learnerState: LearnerState }) {
  const report = useReportData(userId, courseCode)
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

  const displayName = learnerState.profile.displayName.trim() || 'Progress'
  const fileName = `brogram-report-${generatedAt.slice(0, 10)}.pdf`
  const focus = (learnerState as LearnerState & { focus?: string }).focus || FOCUS_FALLBACK

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">Mastery per outcome, patterns passed, mistakes over time, time spent, and de-rot scores. Rendered in the browser; nothing is generated on the server.</p>
        {report.data && <DownloadReportButton containerRef={downloadSourceRef} fileName={fileName} />}
      </div>

      {report.loading && <p role="status" className="text-sm text-muted-foreground">Preparing the report.</p>}

      {report.failed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
          <p className="text-sm text-foreground">The report could not load.</p>
          <Button variant="outline" onClick={report.retry}>Try again</Button>
        </div>
      )}

      {report.data && (
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
                  focus={focus}
                  generatedAt={generatedAt}
                  displayName={displayName}
                  attemptsTruncated={report.data.attemptsTruncated}
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
                focus={focus}
                generatedAt={generatedAt}
                displayName={displayName}
                attemptsTruncated={report.data.attemptsTruncated}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * "Progress" (spec 10.10): two tabs. Trophies -- every achievement, unlocked
 * or not, no mystery boxes -- costs zero extra round trips (`useAchievements`
 * is seeded server-side by the layout, `staleTime: Infinity`), so it is the
 * default tab. Report is the document: mastery, angles, mistakes, time,
 * de-rot scores, the Planner's focus line, and the PDF export, fetched only
 * once that tab is actually opened.
 */
export default function ReportsPage() {
  const { user, learnerState } = useSession()
  const courseCode = learnerState?.currentCourse ?? null
  const [tab, setTab] = useState<ReportsTab>('trophies')

  const wellnessQuery = useWellness()
  const motionPref = resolveWellnessPrefs(wellnessQuery.data?.prefs).motion

  const achievementsQuery = useAchievements()
  const unlockedIds = (achievementsQuery.data ?? []).map((row) => row.achievementId)
  const unlockedThisSession = useFreshlyUnlocked(unlockedIds, !achievementsQuery.isPending)

  if (!courseCode) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-medium tracking-tight">Progress</h1>
        <div className="rounded-xl border border-dashed border-input p-6">
          <p className="text-sm font-medium">Choose a course to see progress.</p>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">A progress report is built from a course&apos;s outcomes, mastery, and de-rot scores, so pick a course first.</p>
          <Link href="/onboarding" className="mt-3 inline-block rounded-sm text-sm font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring">Choose a course</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-medium tracking-tight">Progress</h1>
      <Tabs value={tab} onValueChange={(value) => setTab(value as ReportsTab)}>
        <TabsList aria-label="Progress views">
          <TabsTrigger value="trophies">Trophies</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>
        <TabsContent value="trophies" className="pt-5">
          <TrophyShelf motionPref={motionPref} unlockedThisSession={unlockedThisSession} />
        </TabsContent>
        <TabsContent value="report" className="pt-5">
          {learnerState && <ReportTab userId={user?.id ?? null} courseCode={courseCode} learnerState={learnerState} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
