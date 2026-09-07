'use client'

import { useMutation } from '@tanstack/react-query'
import { PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { useOptimistic } from '@/lib/query/optimistic'
import { qk } from '@/lib/query/keys'
import { recallDockPlacement, writeCachedDockPrefs } from '@/lib/wellness/dock'
import { clearReminderBadge, useReminderBadge } from '@/lib/wellness/reminderBadge'
import type { DockPlacement } from '@/lib/contracts'
import type { WellnessRow } from '@/lib/learner/compile'

/** Mirrors `SoundToggle`'s persist path (T0.5 I9): read the freshest row,
 *  patch only the non-default keys, plain update with an insert fallback. */
async function persistDockPlacement(userId: string, placement: DockPlacement): Promise<void> {
  const client = createClient()
  const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const current = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
  const patch = prefsPatch({ ...current, dock: { ...current.dock, placement } })
  const { data: updated } = await client
    .from('wellness')
    .update({ prefs: patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: patch })
}

/**
 * The header's re-open glyph for the wellness dock (T0.7 seam, wired up by
 * T2.4). Renders nothing while the dock has a placement; the moment
 * `dock.placement` is `'hidden'`, this becomes the only way back -- hidden
 * is never a dead end. Restores whichever placement the learner actually had
 * before hiding it (`recallDockPlacement`, `src/lib/wellness/dock.ts`), not
 * a hardcoded default -- `right` only when nothing was ever remembered this
 * session (e.g. the row already had `dock.placement: 'hidden'` on load).
 *
 * Also the badge's other home (C3): a reminder can still fire while the dock
 * is hidden (the reminder engine mounts headlessly, `WellnessSlot`), so this
 * glyph shows the same shared indicator the collapsed dock would, and
 * clicking it (reopening the dock) acknowledges it.
 */
export function DockControl() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const badge = useReminderBadge()

  const mutation = useMutation(useOptimistic<WellnessRow, DockPlacement>({
    key: qk.wellness(userId ?? ''),
    apply: (previousRow, placement) => {
      const current = resolveWellnessPrefs(previousRow?.prefs)
      const nextDock = { ...current.dock, placement }
      // N3 (fix round 2): this writer bypasses `useDockPrefsMutation`
      // (it needs `recallDockPlacement`'s own placement resolution, and never
      // debounces -- restoring the dock is a one-shot, deliberate action), so
      // it has to mirror the local tier itself. Without this, the mirror kept
      // saying `hidden` after the learner un-hid the dock, and a load where
      // the query has not resolved yet would paint no dock and then reflow
      // one in -- the exact flash the tier exists to prevent, pointed the
      // other way.
      writeCachedDockPrefs(nextDock, userId)
      const patch = prefsPatch({ ...current, dock: nextDock })
      return { ...(previousRow ?? {}), prefs: patch }
    },
    mutate: async (placement) => {
      if (!userId) return
      await persistDockPlacement(userId, placement)
    },
  }))

  if (prefs.dock.placement !== 'hidden') return null

  function handleClick() {
    clearReminderBadge()
    mutation.mutate(recallDockPlacement())
  }

  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Show wellness dock" onClick={handleClick} className="relative">
      <PanelRightOpen aria-hidden="true" />
      {badge && <span data-testid="dock-badge" role="status" className="absolute top-1 right-1 inline-flex size-2 rounded-full bg-emerald-300"><span className="sr-only">A reminder is waiting.</span></span>}
    </Button>
  )
}
