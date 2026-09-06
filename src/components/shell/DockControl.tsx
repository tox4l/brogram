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
 * The header's re-open glyph for the wellness dock (T0.7 seam). Renders
 * nothing while the dock has a placement; the moment `dock.placement` is
 * `'hidden'`, this becomes the only way back -- hidden is never a dead end.
 *
 * `ShellLayout`/`WellnessSlot` do not read `dock.placement` yet (T2.4 wires
 * that up), so this control has no visible effect on layout until then --
 * but it already writes through the same optimistic cache path `SoundToggle`
 * uses, so nothing here needs to change once T2.4 lands.
 */
export function DockControl() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)

  const mutation = useMutation(useOptimistic<WellnessRow, DockPlacement>({
    key: qk.wellness(userId ?? ''),
    apply: (previousRow, placement) => {
      const current = resolveWellnessPrefs(previousRow?.prefs)
      const patch = prefsPatch({ ...current, dock: { ...current.dock, placement } })
      return { ...(previousRow ?? {}), prefs: patch }
    },
    mutate: async (placement) => {
      if (!userId) return
      await persistDockPlacement(userId, placement)
    },
  }))

  if (prefs.dock.placement !== 'hidden') return null

  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Show wellness dock" onClick={() => mutation.mutate('right')}>
      <PanelRightOpen aria-hidden="true" />
    </Button>
  )
}
