import type { SupabaseClient } from '@supabase/supabase-js'
import { closFor } from '@/lib/curriculum'
import type { WellnessRow } from '@/lib/learner/compile'
import type { Attempt, Clo, CourseCode, DrillResult } from '@/lib/contracts'

export interface ReportData {
  clos: Clo[]
  attempts: Attempt[]
  drillResults: DrillResult[]
  /** I5, fix round 1 (Opus review): true when `attempts.length` hit the cap
   *  exactly, the honest (if imperfect) signal that more history likely
   *  exists beyond what this narrow query fetched -- threaded through to the
   *  Time spent section so a lifetime-looking total can say it might not be. */
  attemptsTruncated: boolean
}

/**
 * The whole point of this task's Step 1 (spec 5.6): v1 pulled every attempt
 * ever made, `code` and `results` included, in as many 1000-row pages as it
 * took. The report only ever renders `passed`/`durationMs`/`hintCount`/
 * `exerciseId`/`createdAt` (mastery, mistake trend, time spent) -- it never
 * needed either of those columns. This is now a single capped query, most
 * recent first, so a prolific learner's cap lands on their newest activity
 * rather than their oldest.
 */
const REPORT_ATTEMPTS_CAP = 1000

/**
 * X4 fix: every field the report needs is already in the static curriculum
 * bundle (`closFor`, `@/lib/curriculum`) -- CLOs are no longer read from
 * Postgres here. `Clo.draft` is optional on the frozen contract, so the
 * draft marker still has to be baked into the outcome text itself (the same
 * " (draft)" suffix `MasteryPerClo` renders with no separate draft branch)
 * rather than carried as its own field through to that component.
 */
function markDraft(c: Clo): Clo {
  return c.draft === true ? { ...c, outcome: `${c.outcome} (draft)` } : c
}

/**
 * `code` and `results` are never selected for the report (see
 * `REPORT_ATTEMPTS_CAP`'s comment above), so both are backfilled with their
 * empty value here rather than left undefined -- the mapped row still
 * satisfies the frozen `Attempt` shape `ReportPages` expects, and nothing
 * downstream of this file reads either field.
 */
function mapReportAttempt(row: Record<string, unknown>, userId: string): Attempt {
  return {
    id: String(row.id),
    userId,
    exerciseId: String(row.exercise_id),
    code: '',
    results: [],
    passed: row.passed === true,
    durationMs: Number(row.duration_ms ?? 0),
    hintCount: Number(row.hint_count ?? 0),
    createdAt: String(row.created_at),
  }
}

/** One narrow, capped query -- never `code`, never `results` (spec 5.6). */
async function fetchReportAttempts(client: SupabaseClient, userId: string): Promise<Attempt[]> {
  const { data, error } = await client
    .from('attempts')
    .select('id,exercise_id,passed,duration_ms,hint_count,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(REPORT_ATTEMPTS_CAP)
  if (error) throw new Error('Unable to load your attempt history.', { cause: error })
  const rows = (data as Record<string, unknown>[] | null) ?? []
  return rows.map((row) => mapReportAttempt(row, userId))
}

/**
 * Fix round (F6, Opus review of `1a13de0`): `drill_results` lives on the same
 * `wellness` row `(app)/layout.tsx` already reads server-side and seeds into
 * `qk.wellness` (`staleTime`/`gcTime` `Infinity` — it is never refetched on
 * navigation), and `ReportsPage` already holds that row for `motionPref`
 * before the Report tab ever opens. Re-reading it from Postgres here made
 * `/reports` two round trips against the spec's budget of one. This is the
 * same seeded-cache-first pattern `course/[code]/page.tsx:136` uses: the
 * caller passes the row it already has (`getQueryData`, or straight
 * `useWellness().data`) and this only falls back to a network read when the
 * caller genuinely does not have one yet.
 */
async function fetchWellnessDrillResults(client: SupabaseClient, userId: string): Promise<DrillResult[]> {
  const { data, error } = await client.from('wellness').select('drill_results').eq('user_id', userId).maybeSingle()
  if (error) throw new Error('Unable to load your de-rot scores.', { cause: error })
  return (data?.drill_results as DrillResult[] | null) ?? []
}

/**
 * Everything the report needs for one course: every one of the course's CLOs
 * (draft ones marked, not hidden) in ordinal order, the student's most recent
 * attempts (capped, narrow columns), and their saved de-rot drill results.
 * CLOs come from the static bundle (X4) — never touches `exercises` or
 * `clos`, so a fork ships a new syllabus by editing `seed/` and rebuilding
 * with no separate Postgres table to keep in sync.
 *
 * `seededWellness` (F6, fix round): when the caller already holds the
 * `wellness` row (it does, from the moment the layout seeds `qk.wellness`),
 * pass it here and the `drill_results` Postgres leg is skipped entirely —
 * `undefined` (the row genuinely has not been fetched yet by anyone) is the
 * only value that falls back to a network read; a row that exists but has no
 * drill results yet is a defined object with a null/absent field, not
 * `undefined`, so it still counts as "already have it".
 */
export async function fetchReportData(
  client: SupabaseClient,
  userId: string,
  courseCode: string,
  seededWellness?: WellnessRow,
): Promise<ReportData> {
  const [drillResults, attempts] = await Promise.all([
    seededWellness !== undefined
      ? Promise.resolve(seededWellness.drill_results ?? [])
      : fetchWellnessDrillResults(client, userId),
    fetchReportAttempts(client, userId),
  ])

  return {
    clos: closFor(courseCode as CourseCode).map(markDraft),
    attempts,
    drillResults,
    attemptsTruncated: attempts.length === REPORT_ATTEMPTS_CAP,
  }
}
