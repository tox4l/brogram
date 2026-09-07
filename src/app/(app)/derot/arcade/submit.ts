/**
 * Submits a completed run's single DrillResult (R7.6b). Production is still
 * on schema 0005 -- migration 0009's `append_drill_result` (the capped,
 * server-side append) has not been applied there yet -- so this tries the
 * RPC first and falls back to the v1 direct read-modify-write only when the
 * RPC itself is missing (an "undefined function" style error), never on any
 * other failure. Once 0009 ships to production this fallback becomes dead
 * code that nothing calls; it is not removed pre-emptively because the
 * client must keep working against whichever schema is actually live.
 */
import type { DrillResult } from '@/lib/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'

const DRILL_RESULTS_CAP = 300

interface PostgrestLikeError {
  code?: string | null
  message?: string | null
}

/**
 * True only for the shape of error Postgres/PostgREST returns when a
 * function does not exist in the current schema -- Postgres' own
 * `undefined_function` (42883), and PostgREST's schema-cache misses
 * (PGRST202/PGRST204), plus the message text both surfaces use. Any other
 * error (RLS denial, a bad payload, a network failure) must NOT trigger the
 * fallback -- it should surface as a real save error instead.
 */
export function isMissingRpcError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42883' || error.code === 'PGRST202' || error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('could not find the function') ||
    message.includes('function public.append_drill_result') ||
    message.includes('schema cache') ||
    (message.includes('does not exist') && message.includes('function'))
  )
}

/** Oldest-first trim to the cap, mirroring append_drill_result's own trim so the guarantee holds on both paths. */
function capResults(results: DrillResult[]): DrillResult[] {
  return results.length > DRILL_RESULTS_CAP ? results.slice(results.length - DRILL_RESULTS_CAP) : results
}

/**
 * The v1 read-modify-write, kept only as the pre-0009 fallback. Identical in
 * shape to the original `derot/[kind]/page.tsx` logic: a fresh read right
 * before the write (wellness also carries prefs, water_log and
 * pomodoro_sessions written by the wellness rail), an update guarded by
 * `.select().maybeSingle()` so a zero-row update is never mistaken for
 * success, and a fallback insert when the wellness row is somehow missing.
 */
async function directAppendFallback(client: SupabaseClient, userId: string, result: DrillResult): Promise<DrillResult[]> {
  const { data, error: readError } = await client.from('wellness').select('drill_results').eq('user_id', userId).maybeSingle()
  if (readError) throw readError
  const current = ((data?.drill_results ?? []) as DrillResult[])
  const nextResults = capResults([...current, result])

  const { data: updated, error: writeError } = await client
    .from('wellness')
    .update({ drill_results: nextResults })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  if (writeError) throw writeError
  if (!updated) {
    const { error: insertError } = await client.from('wellness').insert({ user_id: userId, drill_results: nextResults })
    if (insertError) throw insertError
  }
  return nextResults
}

/**
 * Appends one run's DrillResult through `append_drill_result` when it
 * exists, falling back to the direct read-modify-write only when the RPC
 * itself is missing. Returns the resulting `drill_results` array either way
 * so the caller never has to know which path ran.
 */
export async function submitRunResult(client: SupabaseClient, userId: string, result: DrillResult): Promise<DrillResult[]> {
  const { data, error } = await client.rpc('append_drill_result', { result })
  if (!error) return capResults((data ?? []) as DrillResult[])
  if (!isMissingRpcError(error as PostgrestLikeError)) throw error
  return directAppendFallback(client, userId, result)
}
