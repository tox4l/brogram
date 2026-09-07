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
 * its own small hook rather than a call to that one, mirroring
 * `useDockPrefsMutation`'s shape (`src/components/wellness/useDockPrefs.ts`,
 * T2.4) generalized from the `dock` sub-object to all of `WellnessPrefs`.
 *
 * `change` resolves to a concrete, already-applied `Partial<WellnessPrefs>`
 * exactly once per `mutate()` call (never replayed as a closure later): the
 * debounce window accumulates those resolved partials with a one-level-deep
 * merge (`mergeOneLevel`), so two calls touching different fields of the
 * same nested object (e.g. `sound.enabled` then `sound.volume`) both survive
 * into the single network write instead of the second clobbering the first.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { qk } from '@/lib/query/keys'
import { line } from '@/lib/voice/lines'
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

/** One level deep: a nested object (e.g. `sound`) merges field by field;
 *  everything else (scalars, arrays) is a plain overwrite, latest wins. */
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
 *  read-fresh-then-write discipline `SoundToggle`/`DockControl` use). */
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

function applyToCache(client: QueryClient, userId: string, change: PrefsChange): Partial<WellnessPrefs> {
  const key = qk.wellness(userId)
  let resolved: Partial<WellnessPrefs> = {}
  client.setQueryData<WellnessRow>(key, (previousRow) => {
    const current = resolveWellnessPrefs(previousRow?.prefs)
    resolved = change(current)
    const patch = prefsPatch({ ...current, ...resolved })
    return { ...(previousRow ?? {}), prefs: patch }
  })
  return resolved
}

export interface WellnessPrefsMutation {
  mutate: (change: PrefsChange) => void
}

export function useWellnessPrefsMutation(userId: string | null): WellnessPrefsMutation {
  const queryClient = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Partial<WellnessPrefs> | null>(null)
  const consecutiveFailuresRef = useRef(0)

  const flush = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    const latest = pendingRef.current
    pendingRef.current = null
    if (!latest || !userId) return
    const key = qk.wellness(userId)
    void persistPrefsPatch(userId, latest)
      .then(() => {
        consecutiveFailuresRef.current = 0
        // Reconcile with the server only on success. Invalidating
        // unconditionally (a `finally`) would trigger a refetch that lands
        // the *server's* still-unwritten value right back into the cache on
        // a failed write -- a delayed revert wearing an "invalidate" name,
        // which is exactly what brief Step 4 forbids.
        void queryClient.invalidateQueries({ queryKey: key })
      })
      .catch(() => {
        consecutiveFailuresRef.current += 1
        // A toast, never a rollback (brief Step 4) -- the learner's choice
        // stands; this only says the server has not heard about it yet.
        if (consecutiveFailuresRef.current >= FAILURES_BEFORE_TOAST) {
          toast(line('error.save'))
          consecutiveFailuresRef.current = 0
        }
      })
  }, [queryClient, userId])

  // A change made within 400ms of a route change or a tab close should still
  // reach the server -- the cache already reflects it locally either way.
  useEffect(() => () => flush(), [flush])

  const mutate = useCallback((change: PrefsChange) => {
    if (!userId) { applyToCache(queryClient, '', change); return }
    const resolved = applyToCache(queryClient, userId, change)
    pendingRef.current = mergeOneLevel(pendingRef.current ?? {}, resolved)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, DEBOUNCE_MS)
  }, [queryClient, userId, flush])

  return { mutate }
}
