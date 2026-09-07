'use client'

/**
 * The dock sub-object's writer path (spec Step 4, I2): local/optimistic
 * state and `localStorage` update in the same frame; the actual network
 * write is debounced by 400ms so a burst of changes (arrow-key corner
 * moves, repeated collapse toggles) coalesces into one `select`+`update`
 * round trip instead of one per change.
 *
 * This intentionally does not go through `useOptimistic`
 * (`src/lib/query/optimistic.ts`): that helper's `mutate` triggers both the
 * optimistic cache write and the network call together, and delaying that
 * whole call to debounce the network write would delay the cache write too
 * -- exactly the "same frame" guarantee Step 4 asks for. Instead the cache
 * write happens directly and immediately on every call; only the
 * network write is debounced.
 *
 * N2 (fix round 2): `change` is invoked exactly ONCE per `mutate()` call,
 * synchronously, against the cache's current value -- never stored as a
 * closure to be replayed later. What the debounce accumulates is the
 * already-*resolved* partial patch (concrete fields, e.g. `{ collapsed:
 * true }`), merged across a burst of calls. A relative change
 * (`(current) => ({ collapsed: !current.dock.collapsed })`) is therefore
 * safe to call rapidly: two clicks inside one debounce window resolve
 * against the cache's value *at each click* (true, then false again), and
 * the merge sends exactly the final value -- never a closure re-run 400ms
 * later against a separately re-read server row, which is what let two
 * quick clicks send the opposite of what the screen (and the cache) had
 * already settled on, and the following `invalidateQueries` snap the dock
 * to that stale-relative-to-cache state under the learner's cursor.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { qk } from '@/lib/query/keys'
import { writeCachedDockPrefs } from '@/lib/wellness/dock'
import type { WellnessDockPrefs, WellnessPrefs } from '@/lib/contracts'
import type { WellnessRow } from '@/lib/learner/compile'

const DEBOUNCE_MS = 400

export type DockChange = (current: WellnessPrefs) => Partial<WellnessDockPrefs>

/** Applies an already-resolved partial patch to whatever the server holds
 *  right now -- never a `change` function replayed against it. */
async function persistDockPatch(userId: string, patch: Partial<WellnessDockPrefs>): Promise<void> {
  const client = createClient()
  const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const current = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
  const fullPatch = prefsPatch({ ...current, dock: { ...current.dock, ...patch } })
  const { data: updated } = await client.from('wellness').update({ prefs: fullPatch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: fullPatch })
}

export function useDockPrefsMutation(userId: string | null): { mutate: (change: DockChange) => void } {
  const queryClient = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPatchRef = useRef<Partial<WellnessDockPrefs> | null>(null)

  // Depends on `userId` directly (never a ref written during render, which
  // `react-hooks/refs` now flags): if `userId` changes, the effect below
  // tears down the *old* `flush` (running it, so any pending change for the
  // previous id still lands) before the new one is set up.
  const flush = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    const latest = pendingPatchRef.current
    pendingPatchRef.current = null
    if (!latest || !userId) return
    const key = qk.wellness(userId)
    void persistDockPatch(userId, latest)
      .catch(() => { /* Best-effort; the optimistic cache already reflects the change locally. */ })
      .finally(() => { void queryClient.invalidateQueries({ queryKey: key }) })
  }, [queryClient, userId])

  // N4 (fix round 2): flush a pending debounced write on unmount, so a
  // change made within 400ms of a route change or a tab close still reaches
  // the server -- `localStorage` (and the optimistic cache while this tree is
  // alive) already have it, but without this the server value stays stale
  // and a later reload silently reverts the change.
  useEffect(() => () => flush(), [flush])

  const mutate = useCallback((change: DockChange) => {
    const key = qk.wellness(userId ?? '')
    let resolved: Partial<WellnessDockPrefs> | null = null

    // Immediate: resolve `change` exactly once, against the current cache,
    // and apply it -- the optimistic cache (every `useWellness()` reader
    // sees this on its very next render) and its `localStorage` mirror,
    // same frame.
    queryClient.setQueryData<WellnessRow>(key, (previousRow) => {
      const current = resolveWellnessPrefs(previousRow?.prefs)
      resolved = change(current)
      const nextDock = { ...current.dock, ...resolved }
      writeCachedDockPrefs(nextDock, userId)
      const patch = prefsPatch({ ...current, dock: nextDock })
      return { ...(previousRow ?? {}), prefs: patch }
    })

    if (!userId || !resolved) return
    // `resolved` is assigned synchronously inside the `setQueryData` updater
    // above (which TanStack Query calls immediately, not asynchronously), but
    // TypeScript cannot see that through the closure and treats the read
    // here as still possibly `null` -- the runtime guard just above already
    // rules that out.
    const resolvedPatch = resolved as Partial<WellnessDockPrefs>

    // Debounced: the network write. Merges each call's already-resolved
    // patch (last value per field wins) rather than replaying a closure.
    pendingPatchRef.current = { ...(pendingPatchRef.current ?? {}), ...resolvedPatch }
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, DEBOUNCE_MS)
  }, [queryClient, userId, flush])

  return { mutate }
}
