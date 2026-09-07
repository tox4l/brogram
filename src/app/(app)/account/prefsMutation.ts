'use client'

/**
 * "Every control is optimistic" (brief Step 4): local/cache state updates in
 * the same frame a control is touched -- zero network wait, ever -- with a
 * 400ms debounced write-through to `wellness.prefs`, and a toast only after
 * repeated failure. Crucially, **this never rolls back an applied value**:
 * `src/lib/query/optimistic.ts`'s shared `useOptimistic` restores the prior
 * snapshot on a failed mutation, which is exactly right for a write whose
 * failure the learner should see reflected (a submit, a save button) but
 * wrong for "never revert a toggle under the learner's finger" -- so this is
 * its own hook rather than a call to that one.
 *
 * Fix round 1, C1 (Opus review of `b509b0e`): this is now **the single
 * writer** for `wellness.prefs`. `src/components/wellness/useDockPrefs.ts`
 * used to keep its own, entirely independent debounce timer and
 * read-modify-write against the exact same JSONB blob; the wellness dock
 * widget (`Dock.tsx`, mounted in the persistent shell on every route,
 * `/account` included) and this page's own sound/motion/goal controls could
 * therefore both be mid-flight at once. Two consequences, both real:
 *
 *  1. A per-hook-instance `pendingRef`/`timerRef` (a `useRef`) cannot see a
 *     *different* component instance's queued change, so "only invalidate
 *     when nothing newer is queued" was a guard against the wrong scope --
 *     instance A's own queue could be empty while instance B still had an
 *     unflushed write, and A's success-invalidate would refetch and land
 *     B's not-yet-written change right back to the server's stale value.
 *  2. Neither writer called `cancelQueries` before its own optimistic write,
 *     so an in-flight refetch from an *earlier* settle could resolve after a
 *     *newer* `setQueryData` and silently overwrite it -- TanStack Query
 *     does not discard a fetch result just because a manual write happened
 *     mid-flight.
 *
 * The fix is a module-level (not per-hook-instance) pending-patch/timer/
 * failure-count store, keyed per user id -- the same "shared state outside
 * any one component's lifetime" idiom `src/lib/wellness/dock.ts`'s
 * `dockPrefsCache` map and `src/lib/sound/manager.ts` already use in this
 * tree. Every caller of `useWellnessPrefsMutation` (this page, directly) and
 * `useDockPrefsMutation` (this page's dock controls *and* the persistent
 * dock widget, both of which now delegate here -- see `useDockPrefs.ts`)
 * shares the exact same queue, so the "nothing newer queued" check is
 * correct regardless of which control, in which component, queued last.
 *
 * `change` resolves to a concrete, already-applied `Partial<WellnessPrefs>`
 * exactly once per `mutate()` call (never replayed as a closure later): the
 * debounce window accumulates those resolved partials with a one-level-deep
 * merge (`mergeOneLevel`), so two calls touching different fields of the
 * same nested object (e.g. `sound.enabled` then `sound.volume`, or a dock
 * field alongside a sound field) all survive into the single network write
 * instead of the later one clobbering the earlier.
 */

import { useCallback, useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { qk } from '@/lib/query/keys'
import { line } from '@/lib/voice/lines'
import { writeCachedDockPrefs } from '@/lib/wellness/dock'
import type { WellnessPrefs } from '@/lib/contracts'
import type { WellnessRow } from '@/lib/learner/compile'

const DEBOUNCE_MS = 400
/** One toast after this many *consecutive* failed write-throughs -- not on
 *  the first, since a single blip is not worth interrupting the learner for. */
const FAILURES_BEFORE_TOAST = 2

export type PrefsChange = (current: WellnessPrefs) => Partial<WellnessPrefs>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One level deep: a nested object (e.g. `sound`, `dock`) merges field by
 *  field; everything else (scalars, arrays) is a plain overwrite, latest wins. */
function mergeOneLevel(base: Partial<WellnessPrefs>, patch: Partial<WellnessPrefs>): Partial<WellnessPrefs> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key]
    result[key] = isPlainObject(existing) && isPlainObject(value) ? { ...existing, ...value } : value
  }
  return result as Partial<WellnessPrefs>
}

/** Applies an already-resolved partial patch to whatever the server holds
 *  right now -- never a `change` function replayed against it (the same
 *  read-fresh-then-write discipline this hook has always used). */
async function persistPrefsPatch(userId: string, resolvedPatch: Partial<WellnessPrefs>): Promise<void> {
  const client = createClient()
  const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const current = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
  const patch = prefsPatch({ ...current, ...resolvedPatch })
  const { data: updated } = await client
    .from('wellness')
    .update({ prefs: patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: patch })
}

interface WriterState {
  pending: Partial<WellnessPrefs> | null
  timer: ReturnType<typeof setTimeout> | null
  consecutiveFailures: number
}

/** Per-user, module-level -- see the file doc comment for why this cannot be
 *  a `useRef` scoped to whichever component happens to call the hook. */
const writers = new Map<string, WriterState>()

function writerFor(userId: string): WriterState {
  let state = writers.get(userId)
  if (!state) {
    state = { pending: null, timer: null, consecutiveFailures: 0 }
    writers.set(userId, state)
  }
  return state
}

function flush(userId: string, queryClient: QueryClient): void {
  const writer = writerFor(userId)
  if (writer.timer !== null) { clearTimeout(writer.timer); writer.timer = null }
  const latest = writer.pending
  writer.pending = null
  if (!latest) return
  const key = qk.wellness(userId)
  void persistPrefsPatch(userId, latest)
    .then(() => {
      writer.consecutiveFailures = 0
      // Reconcile with the server only on success, and only when nothing
      // newer has been queued in the meantime (by this control or any other
      // sharing this writer) -- otherwise the refetch this triggers could
      // land the server's still-incomplete snapshot over a change made
      // *after* this write started, a delayed revert wearing an
      // "invalidate" name, which is exactly what brief Step 4 forbids.
      if (writer.pending === null && writer.timer === null) void queryClient.invalidateQueries({ queryKey: key })
    })
    .catch(() => {
      writer.consecutiveFailures += 1
      // A toast, never a rollback (brief Step 4) -- the learner's choice
      // stands; this only says the server has not heard about it yet.
      if (writer.consecutiveFailures >= FAILURES_BEFORE_TOAST) {
        toast(line('error.save'))
        writer.consecutiveFailures = 0
      }
    })
}

/** Dock's own `localStorage` mirror (`src/lib/wellness/dock.ts`), read before
 *  `useWellness()` resolves for the very first paint's placement. Every
 *  caller that touches `dock` here always spreads the *current* dock object
 *  first (this page's own dock controls, and `useDockPrefsMutation`'s
 *  delegation), so `resolved.dock` is always a complete `WellnessDockPrefs`,
 *  never a partial one -- safe to mirror directly. */
function mirrorDockCache(resolved: Partial<WellnessPrefs>, userId: string | null): void {
  if (resolved.dock) writeCachedDockPrefs(resolved.dock, userId)
}

function applyToCache(client: QueryClient, userId: string, change: PrefsChange): Partial<WellnessPrefs> {
  const key = qk.wellness(userId)
  let resolved: Partial<WellnessPrefs> = {}
  client.setQueryData<WellnessRow>(key, (previousRow) => {
    const current = resolveWellnessPrefs(previousRow?.prefs)
    resolved = change(current)
    const patch = prefsPatch({ ...current, ...resolved })
    return { ...(previousRow ?? {}), prefs: patch }
  })
  mirrorDockCache(resolved, userId)
  return resolved
}

export interface WellnessPrefsMutation {
  mutate: (change: PrefsChange) => void
}

/** Test-only: forgets every user's pending patch/timer/failure count. Without
 *  this, the module-level `writers` map (necessary in production so every
 *  component instance shares one queue) would leak state across test cases. */
export function resetWellnessPrefsWriterForTests(): void {
  for (const writer of writers.values()) if (writer.timer !== null) clearTimeout(writer.timer)
  writers.clear()
}

export function useWellnessPrefsMutation(userId: string | null): WellnessPrefsMutation {
  const queryClient = useQueryClient()

  // A change made within 400ms of a route change or a tab close should still
  // reach the server -- the cache already reflects it locally either way.
  // Safe to call from every mounted instance sharing this writer: `flush` is
  // a no-op once the shared queue is already empty.
  useEffect(() => {
    if (!userId) return undefined
    return () => flush(userId, queryClient)
  }, [queryClient, userId])

  const mutate = useCallback((change: PrefsChange) => {
    if (!userId) { applyToCache(queryClient, '', change); return }
    const key = qk.wellness(userId)
    // Cancel before the optimistic write: an in-flight refetch left over
    // from an earlier write's settle must not be allowed to resolve after
    // this newer `setQueryData` and overwrite it. `cancelQueries` marks the
    // in-flight fetch as cancelled synchronously; the returned promise (just
    // tracking abort completion) is not needed before writing.
    void queryClient.cancelQueries({ queryKey: key })
    const resolved = applyToCache(queryClient, userId, change)
    const writer = writerFor(userId)
    writer.pending = mergeOneLevel(writer.pending ?? {}, resolved)
    if (writer.timer !== null) clearTimeout(writer.timer)
    writer.timer = setTimeout(() => flush(userId, queryClient), DEBOUNCE_MS)
  }, [queryClient, userId])

  return { mutate }
}
