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
 * network write is debounced, coalescing to the latest change.
 */

import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { qk } from '@/lib/query/keys'
import { writeCachedDockPrefs } from '@/lib/wellness/dock'
import type { WellnessDockPrefs, WellnessPrefs } from '@/lib/contracts'
import type { WellnessRow } from '@/lib/learner/compile'

const DEBOUNCE_MS = 400

export type DockChange = (current: WellnessPrefs) => Partial<WellnessDockPrefs>

async function persistDockChange(userId: string, change: DockChange): Promise<void> {
  const client = createClient()
  const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const current = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
  const patch = prefsPatch({ ...current, dock: { ...current.dock, ...change(current) } })
  const { data: updated } = await client.from('wellness').update({ prefs: patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: patch })
}

export function useDockPrefsMutation(userId: string | null): { mutate: (change: DockChange) => void } {
  const queryClient = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<DockChange | null>(null)

  const mutate = useCallback((change: DockChange) => {
    const key = qk.wellness(userId ?? '')

    // Immediate: the optimistic cache (every `useWellness()` reader sees this
    // on its very next render) and its `localStorage` mirror, same frame.
    queryClient.setQueryData<WellnessRow>(key, (previousRow) => {
      const current = resolveWellnessPrefs(previousRow?.prefs)
      const nextDock = { ...current.dock, ...change(current) }
      writeCachedDockPrefs(nextDock)
      const patch = prefsPatch({ ...current, dock: nextDock })
      return { ...(previousRow ?? {}), prefs: patch }
    })

    if (!userId) return

    // Debounced: the network write, coalesced to whatever the latest change was.
    pendingRef.current = change
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const latest = pendingRef.current
      pendingRef.current = null
      timerRef.current = null
      if (!latest) return
      void persistDockChange(userId, latest)
        .catch(() => { /* Best-effort; the optimistic cache already reflects the change locally. */ })
        .finally(() => { void queryClient.invalidateQueries({ queryKey: key }) })
    }, DEBOUNCE_MS)
  }, [queryClient, userId])

  return { mutate }
}
