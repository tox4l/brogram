'use client'

/**
 * The dock's own thin wrapper around the shared `wellness.prefs` writer
 * (`useWellnessPrefsMutation`, `src/app/(app)/account/prefsMutation.ts`).
 *
 * Fix round 1, C1 (Opus review of T2.3, `b509b0e`): this file used to keep
 * its own, entirely independent debounce timer and read-modify-write against
 * the exact same `wellness.prefs` JSONB blob the Account page's sound/
 * motion/goal controls also write to. Because the wellness dock widget
 * (`Dock.tsx`) is mounted in the persistent shell on every route --
 * `/account` included, alongside this page's own dock-placement pill -- two
 * independent, uncoordinated writers were live on the same blob at once: a
 * dock change could silently drop an unflushed sound/motion/goal change, and
 * this hook's unconditional `.finally()` invalidate (even on failure) could
 * trigger a refetch that landed the server's stale value back over a newer
 * optimistic write, visibly flipping a toggle back under the learner's
 * finger -- exactly what brief Step 4 forbids.
 *
 * There is now exactly one writer for `wellness.prefs` for every control
 * except `DockControl.tsx` (`src/components/shell/DockControl.tsx` still
 * keeps its own independent writer -- open: F1 fix-round follow-up). This
 * hook only
 * shapes the dock-specific `DockChange` into the general `PrefsChange` shape
 * `useWellnessPrefsMutation` expects and delegates entirely to it -- one
 * shared, module-level debounce/pending-patch/failure-count store (see that
 * file's doc comment), one `cancelQueries` before every optimistic write, one
 * guarded `invalidateQueries` after a settle with nothing newer queued
 * anywhere. `writeCachedDockPrefs`'s `localStorage` mirror moved to
 * `prefsMutation.ts`'s `applyToCache`, which mirrors any resolved `dock` key
 * regardless of which control produced it.
 *
 * The public exports (`DockChange`, `useDockPrefsMutation`) keep their exact
 * shape, so `DockControl.tsx`, `WellnessSlot.tsx` and `Dock.tsx` (all outside
 * this task's ownership) need no changes.
 */

import { useCallback } from 'react'
import { useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'
import type { WellnessDockPrefs, WellnessPrefs } from '@/lib/contracts'

export type DockChange = (current: WellnessPrefs) => Partial<WellnessDockPrefs>

export function useDockPrefsMutation(userId: string | null): { mutate: (change: DockChange) => void } {
  const { mutate: mutatePrefs } = useWellnessPrefsMutation(userId)

  const mutate = useCallback((change: DockChange) => {
    // Always spread the current dock first: `prefsMutation`'s cache/mirror
    // logic assumes a resolved `dock` patch is a complete `WellnessDockPrefs`,
    // never a partial one.
    mutatePrefs((current) => ({ dock: { ...current.dock, ...change(current) } }))
  }, [mutatePrefs])

  return { mutate }
}
