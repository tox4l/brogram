'use client'

import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { hydrateSoundFromPrefs, setEnabled as setSoundEnabled } from '@/lib/sound/manager'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { useOptimistic } from '@/lib/query/optimistic'
import { qk } from '@/lib/query/keys'
import type { WellnessRow } from '@/lib/learner/compile'

/** Reads the freshest row itself (rather than trusting a possibly-stale
 *  closed-over query snapshot) so two quick toggles in a row each patch on
 *  top of what the previous one actually persisted. */
async function persistSoundEnabled(userId: string, enabled: boolean): Promise<void> {
  const client = createClient()
  const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const current = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
  const patch = prefsPatch({ ...current, sound: { ...current.sound, enabled } })
  // The row normally already exists (created on signup), so a plain update
  // is the common case; insert once as a fallback if it somehow does not.
  const { data: updated } = await client
    .from('wellness')
    .update({ prefs: patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: patch })
}

/**
 * One icon button in the shell header — not buried in settings, mirrored on
 * the Account page. Default **on**: nothing can play before the first
 * gesture anyway, so defaulting on costs nothing (T0.5 step 5).
 *
 * I9: this is a second writer on the `wellness.prefs` JSON blob — `Rail`
 * (T2.4) is the first and still writes a full resolved snapshot from its own
 * locally-held state, which can revert this toggle on its next unrelated
 * write until T2.4 moves to the same shared path. The mitigation here is to
 * make *this* write as small and cache-consistent as T0.4's machinery
 * allows: read/write through the shared TanStack Query cache (`useWellness`,
 * `qk.wellness`) instead of a bespoke fetch, apply the change optimistically
 * to that same cache via `useOptimistic` so any other `useWellness()`
 * consumer sees it immediately, persist only `prefsPatch(...)` — the
 * non-default keys, the same shape `resolveWellnessPrefs` reads back — never
 * the full resolved object, and invalidate the key on settle so a stale
 * write from elsewhere is reconciled from the server rather than trusted
 * forever.
 *
 * I8: hydration and every toggle go through `hydrateSoundFromPrefs`, the
 * sound manager's one entry point for "prefs are known now" — so
 * `sound.interface` can never be silently missed the way it was here before.
 */
export function SoundToggle() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)

  useEffect(() => {
    hydrateSoundFromPrefs(prefs)
    // Only the three keys the manager actually reads should re-trigger this —
    // not every field on `prefs` (dock/theme/etc change far more often).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.sound.enabled, prefs.sound.interface, prefs.sound.volume])

  const mutation = useMutation(useOptimistic<WellnessRow, boolean>({
    key: qk.wellness(userId ?? ''),
    apply: (previousRow, nextEnabled) => {
      const current = resolveWellnessPrefs(previousRow?.prefs)
      const patch = prefsPatch({ ...current, sound: { ...current.sound, enabled: nextEnabled } })
      return { ...(previousRow ?? {}), prefs: patch }
    },
    mutate: async (nextEnabled) => {
      if (!userId) return
      await persistSoundEnabled(userId, nextEnabled)
    },
  }))

  function toggle() {
    const next = !prefs.sound.enabled
    // Immediate: the header mute must silence an already-playing cue on this
    // exact click (I1), not once the optimistic cache round-trips a render.
    setSoundEnabled(next)
    mutation.mutate(next)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={prefs.sound.enabled}
      aria-label={prefs.sound.enabled ? 'Mute sound' : 'Unmute sound'}
      onClick={toggle}
    >
      {prefs.sound.enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
    </Button>
  )
}
