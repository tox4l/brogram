/**
 * A learner's own, best-effort record of the guard events `useLockdown` has
 * actually logged on this browser. It exists for exactly one reason:
 * `my_integrity_breakdown()` (migration 0008) has not reached production yet
 * -- production is still on schema 0005 -- so there is no privileged way for
 * the browser to read back its own `integrity_events` rows (that table grants
 * `insert` only; see `supabase/migrations/0001_init.sql`). Until the RPC
 * ships, this is the only "events the learner already has" available to
 * build an itemised receipt from at all.
 *
 * This is honestly a lower bound, never the real 7-day figure the escalation
 * trigger used to decide the account's status: it knows nothing from another
 * device, another tab that was closed before this file shipped, or any event
 * older than what `localStorage` still holds. `src/lib/integrity/breakdown.ts`
 * labels a breakdown built from this source `'local'` for exactly that reason
 * -- callers must not present it as equivalent to the server's own count.
 */
import type { IntegrityEventType } from '@/lib/contracts'
import { INTEGRITY_THRESHOLDS } from '@/lib/contracts'

const STORAGE_KEY = 'brogram:integrity-log'
/** Comfortably above anything the 7-day window could hold in practice; keeps
 *  the stored payload bounded regardless. */
const MAX_STORED_EVENTS = 500
const WINDOW_MS = INTEGRITY_THRESHOLDS.windowDays * 24 * 60 * 60 * 1000

interface StoredEvent {
  type: IntegrityEventType
  at: number
}

function isStoredEvent(value: unknown): value is StoredEvent {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as StoredEvent).type === 'string' &&
    typeof (value as StoredEvent).at === 'number'
  )
}

function readAll(): StoredEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isStoredEvent) : []
  } catch {
    // Private browsing, a full quota, or storage disabled entirely -- the
    // local log is a best-effort fallback, never a hard dependency.
    return []
  }
}

function writeAll(events: StoredEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_STORED_EVENTS)))
  } catch {
    // Same rationale as readAll: losing this write costs the fallback some
    // fidelity, never correctness of anything else in the app.
  }
}

/** Records one guard event this browser has genuinely seen. Called only for
 *  events `useLockdown` is already about to insert (after its own 1-second
 *  per-type coalescing), so this mirrors the real insert cadence exactly. */
export function recordLocalIntegrityEvent(type: IntegrityEventType, now: number = Date.now()): void {
  if (typeof window === 'undefined') return
  writeAll([...readAll(), { type, at: now }])
}

/** Events from the last `windowDays` only, mirroring the server's own window
 *  (`integrity_score()`/`my_integrity_breakdown()` both use the same seven
 *  days) -- callers never see a stale event counted as if it were current. */
export function readLocalIntegrityEvents(now: number = Date.now()): { type: IntegrityEventType }[] {
  if (typeof window === 'undefined') return []
  return readAll()
    .filter((event) => now - event.at <= WINDOW_MS)
    .map((event) => ({ type: event.type }))
}

/** Test-only: wipes the local log outright. */
export function clearLocalIntegrityLog(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* see writeAll */ }
}
