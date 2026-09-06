import type { SupabaseClient } from '@supabase/supabase-js'
import type { Attempt, Clo, DrillResult } from '@/lib/contracts'

export interface ReportData {
  clos: Clo[]
  attempts: Attempt[]
  drillResults: DrillResult[]
}

/** Attempts are fetched a page at a time so a long history never truncates silently. */
const ATTEMPTS_PAGE_SIZE = 1000

function mapClo(row: Record<string, unknown>): Clo {
  return {
    id: String(row.id),
    course: String(row.course),
    ordinal: Number(row.ordinal),
    outcome: String(row.outcome),
    topics: (row.topics as string[] | null) ?? [],
    prerequisites: (row.prerequisites as string[] | null) ?? [],
    patterns: (row.patterns as string[] | null) ?? [],
    assessableInCode: row.assessable_in_code === true,
  }
}

function mapAttempt(row: Record<string, unknown>, userId: string): Attempt {
  return {
    id: String(row.id),
    userId,
    exerciseId: String(row.exercise_id),
    code: String(row.code ?? ''),
    results: (row.results as Attempt['results'] | null) ?? [],
    passed: row.passed === true,
    durationMs: Number(row.duration_ms ?? 0),
    hintCount: Number(row.hint_count ?? 0),
    createdAt: String(row.created_at),
  }
}

/** Every attempt for `userId`, oldest first, paged so no history is dropped. */
async function fetchAllAttempts(client: SupabaseClient, userId: string): Promise<Attempt[]> {
  const attempts: Attempt[] = []
  for (let offset = 0; ; offset += ATTEMPTS_PAGE_SIZE) {
    const page = await client
      .from('attempts')
      .select('id,exercise_id,code,results,passed,duration_ms,hint_count,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .range(offset, offset + ATTEMPTS_PAGE_SIZE - 1)
    if (page.error) throw new Error('Unable to load your attempt history.', { cause: page.error })
    const rows = (page.data as Record<string, unknown>[] | null) ?? []
    attempts.push(...rows.map((row) => mapAttempt(row, userId)))
    if (rows.length < ATTEMPTS_PAGE_SIZE) break
  }
  return attempts
}

/**
 * Everything the report needs for one course: the course's non-draft CLOs in
 * ordinal order, the student's full attempt history, and their saved de-rot
 * drill results. Never touches `exercises` — the report needs no bodies.
 */
export async function fetchReportData(client: SupabaseClient, userId: string, courseCode: string): Promise<ReportData> {
  const [clos, wellness, attempts] = await Promise.all([
    client
      .from('clos')
      .select('id,course,ordinal,outcome,topics,prerequisites,patterns,assessable_in_code')
      .eq('course', courseCode)
      .eq('draft', false)
      .order('ordinal'),
    client.from('wellness').select('drill_results').eq('user_id', userId).maybeSingle(),
    fetchAllAttempts(client, userId),
  ])
  if (clos.error) throw new Error('Unable to load your course outcomes.', { cause: clos.error })
  if (wellness.error) throw new Error('Unable to load your de-rot scores.', { cause: wellness.error })

  return {
    clos: ((clos.data as Record<string, unknown>[] | null) ?? []).map(mapClo),
    attempts,
    drillResults: (wellness.data?.drill_results as DrillResult[] | null) ?? [],
  }
}
