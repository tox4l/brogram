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
 * older than what `localStorage` still holds. It also over-counts in one
 * direction: `recordLocalIntegrityEvent` fires the moment an event is
 * *queued* for insert (`useLockdown.ts`'s own 1-second coalescing already
 * applied), not once the write is confirmed, so a batch that later fails the
 * network still counts here even though it never reached the trigger.
 * `src/lib/integrity/breakdown.ts` labels a breakdown built from this source
 * `'local'` for exactly these reasons -- callers must not present it as
 * equivalent to the server's own count.
 *
 * Namespacing (fix round 1, C1): keyed by `userId`, matching every other
 * per-learner localStorage store in this repo (`queueKey(userId, lessonId)`
 * in `src/components/lesson/progressSync.ts`, `queueKey(userId)` in
 * `src/lib/onboarding/completionQueue.ts`, `dockCacheKey(userId)` in
 * `src/lib/wellness/dock.ts`). Without this, a shared machine -- a normal
 * case for a university product -- lets learner B's Account screen render
 * learner A's PrintScreen/paste history as B's own arithmetic, on the one
 * surface whose entire purpose is that the numbers are the learner's own.
 */
import type { IntegrityEventType } from '@/lib/contracts'
import { INTEGRITY_THRESHOLDS, INTEGRITY_WEIGHTS } from '@/lib/contracts'

const STORAGE_PREFIX = 'brogram:integrity-log'
/** Comfortably above anything the 7-day window could hold in practice; keeps
 *  the stored payload bounded regardless. */
const MAX_STORED_EVENTS = 500
const WINDOW_MS = INTEGRITY_THRESHOLDS.windowDays * 24 * 60 * 60 * 1000

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`
}

interface StoredEvent {
  type: IntegrityEventType
  at: number
}

/** Also rejects a `type` this build does not know how to weigh (fix round 1,
 *  I5): without this, a row surviving from a future or hand-edited build
 *  reaches `breakdownFromEvents`'s `count * INTEGRITY_WEIGHTS[type]` as
 *  `undefined`, producing "Total NaN." on the one screen where that reads
 *  worst. The RPC path already guards the equivalent case
 *  (`isIntegrityEventType` in `breakdown.ts`); this mirrors it. */
function isStoredEvent(value: unknown): value is StoredEvent {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as StoredEvent
  return (
    typeof candidate.type === 'string' &&
    Object.prototype.hasOwnProperty.call(INTEGRITY_WEIGHTS, candidate.type) &&
    typeof candidate.at === 'number'
  )
}

function readAll(userId: string): StoredEvent[] {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isStoredEvent) : []
  } catch {
    // Private browsing, a full quota, or storage disabled entirely -- the
    // local log is a best-effort fallback, never a hard dependency.
    return []
  }
}

function writeAll(userId: string, events: StoredEvent[]): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(events.slice(-MAX_STORED_EVENTS)))
  } catch {
    // Same rationale as readAll: losing this write costs the fallback some
    // fidelity, never correctness of anything else in the app.
  }
}

/** Records one guard event this browser has genuinely seen for `userId`.
 *  Called only for events `useLockdown` is already about to queue for
 *  insert (after its own 1-second per-type coalescing), so this mirrors the
 *  queue cadence exactly -- see the module doc above for the one way that
 *  can still over-count relative to what the server actually received. */
export function recordLocalIntegrityEvent(userId: string, type: IntegrityEventType, now: number = Date.now()): void {
  if (typeof window === 'undefined') return
  writeAll(userId, [...readAll(userId), { type, at: now }])
}

/** Events from the last `windowDays` only, mirroring the server's own window
 *  (`integrity_score()`/`my_integrity_breakdown()` both use the same seven
 *  days) -- callers never see a stale event counted as if it were current. */
export function readLocalIntegrityEvents(userId: string, now: number = Date.now()): { type: IntegrityEventType }[] {
  if (typeof window === 'undefined') return []
  return readAll(userId)
    .filter((event) => now - event.at <= WINDOW_MS)
    .map((event) => ({ type: event.type }))
}

/** Clears one user's stored log outright (not test-only: also used to drop a
 *  previous user's data off a shared browser -- see `syncLocalIntegrityLogUser`). */
export function clearLocalIntegrityLog(userId: string): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(storageKey(userId)) } catch { /* see writeAll */ }
}

let lastSeenUserId: string | undefined

/**
 * Best-effort hygiene on top of the per-user keying above: the moment a
 * *different* signed-in user is seen on this browser, the previous user's
 * key is removed outright, so a shared machine does not accumulate one
 * `localStorage` entry per historical learner forever. This mirrors
 * `resetQueryClientForUser` in `src/lib/query/client.ts` (same no-op-on-
 * first-user, no-op-on-repeat-user shape) -- not imported from there, since
 * that file is owned by a different task and this is a one-way pattern
 * match, not a shared dependency.
 *
 * Namespacing alone (not this function) is what stops one learner's receipt
 * from reading another's events -- B's read only ever touches B's own key.
 * This only prevents A's now-orphaned key from lingering indefinitely; it is
 * an in-memory tracker, so it does nothing across a full page reload (the
 * shape every sign-out/sign-in in this app actually takes -- see
 * `src/lib/supabase/server.ts`'s note that `/auth/signout` is a full
 * document navigation), which is fine, since the per-user key already made
 * that transition safe on its own.
 */
export function syncLocalIntegrityLogUser(userId: string | null): void {
  if (typeof window === 'undefined' || !userId) return
  if (lastSeenUserId !== undefined && lastSeenUserId !== userId) {
    try { localStorage.removeItem(storageKey(lastSeenUserId)) } catch { /* best-effort */ }
  }
  lastSeenUserId = userId
}

/** Test-only: wipes every stored integrity log regardless of user, and forgets the tracked user. */
export function clearAllLocalIntegrityLogsForTests(): void {
  lastSeenUserId = undefined
  if (typeof window === 'undefined') return
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key)
    }
  } catch { /* best-effort */ }
}
