'use client'

import { useMutation } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { useSyncExternalStore } from 'react'
import type { DockCorner, WellnessPrefs } from '@/lib/contracts'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { useOptimistic } from '@/lib/query/optimistic'
import { qk } from '@/lib/query/keys'
import { effectiveCollapsed, orientationFor } from '@/lib/wellness/dock'
import type { WellnessRow } from '@/lib/learner/compile'
import { Dock } from '@/components/wellness/Dock'

/** Mirrors `SoundToggle`/`DockControl`'s persist path: read the freshest row,
 *  patch only the non-default keys, plain update with an insert fallback. */
async function persistDockChange(userId: string, change: (current: WellnessPrefs) => Partial<WellnessPrefs['dock']>): Promise<void> {
  const client = createClient()
  const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const current = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
  const patch = prefsPatch({ ...current, dock: { ...current.dock, ...change(current) } })
  const { data: updated } = await client.from('wellness').update({ prefs: patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: patch })
}

// `createPortal(..., document.body)` cannot run during SSR (there is no
// `document`); the standard fix is a "mounted" flag, but flipping it via a
// plain `useState` + `useEffect(() => setMounted(true), [])` calls setState
// synchronously inside an effect, which the project bans (standing
// constraint, `react-hooks/set-state-in-effect`). `useSyncExternalStore`
// gets the same "false on the server, true once client-hydrated" result
// through React's own hydration-mismatch machinery instead of a manual
// effect, the same trick `useSecondTick`/`useReducedMotion` already use.
function subscribeNever(): () => void { return () => {} }
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false)
}

function useDockMutation(userId: string | null) {
  return useMutation(useOptimistic<WellnessRow, (current: WellnessPrefs) => Partial<WellnessPrefs['dock']>>({
    key: qk.wellness(userId ?? ''),
    apply: (previousRow, change) => {
      const current = resolveWellnessPrefs(previousRow?.prefs)
      const patch = prefsPatch({ ...current, dock: { ...current.dock, ...change(current) } })
      return { ...(previousRow ?? {}), prefs: patch }
    },
    mutate: async (change) => {
      if (!userId) return
      await persistDockChange(userId, change)
    },
  }))
}

/**
 * Placement-driven wellness dock slot (T2.4, spec 6.1). Reads `wellness.prefs.dock`
 * (same cached query `ShellLayout` reads for the grid, `SoundToggle` and
 * `DockControl` read for their own toggles -- one cache, several readers) and
 * decides: nothing for `hidden` (the header's `DockControl` is the only way
 * back), a portal-rendered floating pill for `float`, or the placement-driven
 * `<Dock>` otherwise. `effectiveCollapsed` folds in `compactOnExercise` on the
 * exercise and lesson routes without ever touching the learner's placement.
 */
export function WellnessSlot() {
  const pathname = usePathname()
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const { placement, corner } = prefs.dock
  const collapsed = effectiveCollapsed(prefs.dock, pathname)
  const orientation = orientationFor(placement)

  const dockMutation = useDockMutation(userId)
  const toggleCollapse = () => dockMutation.mutate((current) => ({ collapsed: !current.dock.collapsed }))
  const changeCorner = (nextCornerValue: DockCorner) => dockMutation.mutate(() => ({ corner: nextCornerValue }))

  const mounted = useMounted()

  if (placement === 'hidden') return null

  if (orientation === 'pill') {
    if (!mounted) return null
    return createPortal(
      <Dock orientation="pill" collapsed={collapsed} onToggleCollapse={toggleCollapse} corner={corner} onCornerChange={changeCorner} />,
      document.body,
    )
  }

  return <Dock orientation={orientation === 'none' ? 'vertical' : orientation} collapsed={collapsed} onToggleCollapse={toggleCollapse} corner={corner} onCornerChange={changeCorner} />
}
