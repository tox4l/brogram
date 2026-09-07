/**
 * The itemised integrity receipt (R9.4): the learner's own arithmetic,
 * rendered with the real weights, so every number a learner sees is one the
 * escalation trigger could also have produced from the same rows.
 *
 * Two sources, never blended in one row set:
 *  - `'server'` -- `my_integrity_breakdown()` (migration 0008), the actual
 *    7-day, per-type counts and weights computed inside Postgres, in the same
 *    security-definer function whose numbers `apply_integrity_escalation()`
 *    already acted on.
 *  - `'local'` -- production is still on schema 0005, where that function
 *    does not exist yet (`integrity_events` grants `insert` only -- there is
 *    no privileged client read to fall back to). The only honest fallback is
 *    whatever this browser has itself recorded through
 *    `src/lib/integrity/localLog.ts`, which is why `fetchIntegrityBreakdown`
 *    takes it as a parameter rather than trying to reconstruct it here.
 *
 * The missing-RPC detection mirrors `isMissingRpcError` in
 * `src/app/(app)/derot/arcade/submit.ts` (T2.9a's fallback for the same
 * schema gap, a different RPC) -- not imported from there, since that file
 * belongs to a different task and the two were never a shared module, but
 * the same Postgres/PostgREST error shapes apply to any function schema 0005
 * has not caught up to yet.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntegrityEventType } from '@/lib/contracts'
import { INTEGRITY_THRESHOLDS, INTEGRITY_WEIGHTS } from '@/lib/contracts'

export interface IntegrityBreakdownRow {
  type: IntegrityEventType
  events: number
  weight: number
  points: number
}

export interface IntegrityBreakdown {
  rows: IntegrityBreakdownRow[]
  total: number
  source: 'server' | 'local'
}

interface PostgrestLikeError {
  code?: string | null
  message?: string | null
}

/** True only for the shape of error Postgres/PostgREST returns when a
 *  function does not exist in the current schema. Any other error (RLS
 *  denial, a bad payload, a network failure) must surface as a real failure,
 *  never a silently fabricated "zero events" receipt. */
export function isMissingRpcError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42883' || error.code === 'PGRST202' || error.code === 'PGRST204') return true
  const message = (error.message ?? '').toLowerCase()
  return (
    message.includes('could not find the function') ||
    message.includes('function public.my_integrity_breakdown') ||
    message.includes('schema cache') ||
    (message.includes('does not exist') && message.includes('function'))
  )
}

interface BreakdownRpcRow {
  event_type: string
  events: number
  weight: number
  points: number
}

function isIntegrityEventType(value: string): value is IntegrityEventType {
  return Object.prototype.hasOwnProperty.call(INTEGRITY_WEIGHTS, value)
}

function totalOf(rows: IntegrityBreakdownRow[]): number {
  return rows.reduce((sum, row) => sum + row.points, 0)
}

function fromRpcRows(rows: BreakdownRpcRow[]): IntegrityBreakdown {
  const parsed: IntegrityBreakdownRow[] = rows
    .filter((row) => isIntegrityEventType(row.event_type))
    .map((row) => ({ type: row.event_type as IntegrityEventType, events: row.events, weight: row.weight, points: row.points }))
  return { rows: parsed, total: totalOf(parsed), source: 'server' }
}

/** Builds the same shape from raw local events -- grouped, weighed and
 *  ordered the same way `my_integrity_breakdown()`'s SQL is (`order by
 *  points desc, type asc`), so the two sources are visually interchangeable
 *  to whichever one a given render used. */
export function breakdownFromEvents(events: { type: IntegrityEventType }[]): IntegrityBreakdown {
  const counts = new Map<IntegrityEventType, number>()
  for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1)

  const rows: IntegrityBreakdownRow[] = [...counts.entries()]
    .map(([type, count]) => ({ type, events: count, weight: INTEGRITY_WEIGHTS[type], points: count * INTEGRITY_WEIGHTS[type] }))
    .sort((a, b) => b.points - a.points || a.type.localeCompare(b.type))

  return { rows, total: totalOf(rows), source: 'local' }
}

export type RestrictedCause = 'score' | 'paste'

/**
 * Derives which of `apply_integrity_escalation()`'s two `or`-joined
 * conditions caused a restriction (`0003_integrity.sql`:
 * `s >= 20 or paste_in_exercise >= 5`), from the aggregate breakdown alone --
 * no schema change, no raw rows.
 *
 * `total >= restrictAt` already proves the score condition on its own,
 * regardless of anything else -- this is the boundary the fix round names
 * explicitly: a total of exactly 20 with five pastes still reads as the
 * score rule, since the score alone already crosses the line. Below that
 * total, a `paste-blocked` row at or above `instantRestrictPasteCount` is
 * the *only* other condition the trigger checks, so it is provably the sole
 * cause of a restriction the score could not have caused by itself.
 *
 * Only sound on the **server** source: `my_integrity_breakdown()`'s total is
 * the real 7-day figure the trigger used. On the **local** fallback the
 * total is a lower bound (this device's own record, possibly missing events
 * from another device or from before the log existed) and `StoredEvent`
 * carries no `exercise_id`, so "five pastes in *one* exercise" -- the
 * trigger's actual rule -- is not derivable from it either; callers must not
 * call this for a local breakdown (see `guard.restricted.local`, which
 * asserts no numeric cause at all).
 */
export function restrictedCause(breakdown: IntegrityBreakdown): RestrictedCause {
  if (breakdown.total >= INTEGRITY_THRESHOLDS.restrictAt) return 'score'
  const pasteEvents = breakdown.rows.find((row) => row.type === 'paste-blocked')?.events ?? 0
  return pasteEvents >= INTEGRITY_THRESHOLDS.instantRestrictPasteCount ? 'paste' : 'score'
}

/**
 * Tries `my_integrity_breakdown()` first. Falls back to `localEvents` only
 * when the RPC itself is confirmed missing; any other error is rethrown so a
 * real failure (RLS, network, an expired session) never gets silently
 * replaced by a fabricated zero-event receipt.
 */
export async function fetchIntegrityBreakdown(
  client: SupabaseClient,
  localEvents: { type: IntegrityEventType }[],
): Promise<IntegrityBreakdown> {
  const { data, error } = await client.rpc('my_integrity_breakdown')
  if (!error) return fromRpcRows((data ?? []) as BreakdownRpcRow[])
  if (!isMissingRpcError(error as PostgrestLikeError)) throw error
  return breakdownFromEvents(localEvents)
}
