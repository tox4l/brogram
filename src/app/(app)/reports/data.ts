import type { SupabaseClient } from '@supabase/supabase-js'
import type { Attempt, Clo, DrillResult } from '@/lib/contracts'

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
 * `Clo` carries no `draft` field (the frozen contract is not extended for this), so a
 * draft outcome's marker is baked into the outcome text itself: the same " (draft)"
 * suffix the report's mastery table then simply renders as part of the row.
 */
function mapClo(row: Record<string, unknown>): Clo {
  return {
    id: String(row.id),
    course: String(row.course),
    ordinal: Number(row.ordinal),
    outcome: row.draft === true ? `${String(row.outcome)} (draft)` : String(row.outcome),
    topics: (row.topics as string[] | null) ?? [],
    prerequisites: (row.prerequisites as string[] | null) ?? [],
    patterns: (row.patterns as string[] | null) ?? [],
    assessableInCode: row.assessable_in_code === true,
  }
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
 * Everything the report needs for one course: every one of the course's CLOs
 * (draft ones marked, not hidden) in ordinal order, the student's most recent
 * attempts (capped, narrow columns), and their saved de-rot drill results.
 * Never touches `exercises` — the report needs no bodies.
 */
export async function fetchReportData(client: SupabaseClient, userId: string, courseCode: string): Promise<ReportData> {
  const [clos, wellness, attempts] = await Promise.all([
    client
      .from('clos')
      .select('id,course,ordinal,outcome,topics,prerequisites,patterns,assessable_in_code,draft')
      .eq('course', courseCode)
      .order('ordinal'),
    client.from('wellness').select('drill_results').eq('user_id', userId).maybeSingle(),
    fetchReportAttempts(client, userId),
  ])
  if (clos.error) throw new Error('Unable to load your course outcomes.', { cause: clos.error })
  if (wellness.error) throw new Error('Unable to load your de-rot scores.', { cause: wellness.error })

  return {
    clos: ((clos.data as Record<string, unknown>[] | null) ?? []).map(mapClo),
    attempts,
    drillResults: (wellness.data?.drill_results as DrillResult[] | null) ?? [],
    attemptsTruncated: attempts.length === REPORT_ATTEMPTS_CAP,
  }
}
