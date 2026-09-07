'use client'

import { useEffect } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { hydrateSoundFromPrefs, setEnabled as setSoundEnabled } from '@/lib/sound/manager'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'

/**
 * One icon button in the shell header — not buried in settings, mirrored on
 * the Account page. Default **on**: nothing can play before the first
 * gesture anyway, so defaulting on costs nothing (T0.5 step 5).
 *
 * X3 fix (Wave 2 review): this used to keep its own `useOptimistic` mutation
 * against `wellness.prefs` -- a second, independent writer on the exact same
 * JSONB blob the wellness dock (`Dock.tsx`) and the Account page's own
 * controls also wrote to, none of which could see any of the others'
 * in-flight or queued changes, which is what let one control's write revert
 * another's under the learner's finger. Every field now goes through the one
 * shared writer (`useWellnessPrefsMutation`, `src/app/(app)/account/prefsMutation.ts`):
 * one module-level debounce/pending-patch queue regardless of which control,
 * in which component, changed last. The cache is still applied the same
 * frame this click handler runs -- only the network write-through is
 * debounced (400ms).
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
  const mutation = useWellnessPrefsMutation(userId)

  useEffect(() => {
    hydrateSoundFromPrefs(prefs)
    // Only the three keys the manager actually reads should re-trigger this —
    // not every field on `prefs` (dock/theme/etc change far more often).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.sound.enabled, prefs.sound.interface, prefs.sound.volume])

  function toggle() {
    const next = !prefs.sound.enabled
    // Immediate: the header mute must silence an already-playing cue on this
    // exact click (I1), not once the shared writer's debounce fires.
    setSoundEnabled(next)
    mutation.mutate((current) => ({ sound: { ...current.sound, enabled: next } }))
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
