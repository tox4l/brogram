'use client'

import { PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { useDockPrefsMutation } from '@/components/wellness/useDockPrefs'
import { recallDockPlacement } from '@/lib/wellness/dock'
import { clearReminderBadge, useReminderBadge } from '@/lib/wellness/reminderBadge'

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
 *
 * Fix round 2, F1: this used to keep its own independent `useOptimistic`
 * mutation directly on `wellness.prefs`, with its own read-modify-write and
 * its own `localStorage` mirror call -- a second, uncoordinated writer on the
 * exact blob `useWellnessPrefsMutation` (the shared queue every other prefs
 * control uses) also writes, which could revert a concurrent Account/Dock
 * change under the learner's finger and vice versa (X3). Routing through
 * `useDockPrefsMutation` -- the same delegation `Dock.tsx`'s own placement
 * control already uses -- puts this control on the one shared queue: the
 * optimistic cache write and the `localStorage` mirror still land the same
 * frame (`prefsMutation.ts`'s `applyToCache`/`mirrorDockCache`, generic over
 * any resolved `dock` key, replaces the local `writeCachedDockPrefs` call
 * this file used to make itself), and the network write is now the shared
 * 400ms debounce instead of a one-shot call -- a fast double-click
 * reopen/re-hide ships only the newest value, same as every other control.
 */
export function DockControl() {
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const badge = useReminderBadge()
  const dockPrefsMutation = useDockPrefsMutation(userId)

  if (prefs.dock.placement !== 'hidden') return null

  function handleClick() {
    clearReminderBadge()
    dockPrefsMutation.mutate(() => ({ placement: recallDockPlacement() }))
  }

  return (
    <Button type="button" variant="ghost" size="icon" aria-label="Show wellness dock" onClick={handleClick} className="relative">
      <PanelRightOpen aria-hidden="true" />
      {badge && <span data-testid="dock-badge" role="status" className="absolute top-1 right-1 inline-flex size-2 rounded-full bg-emerald-300"><span className="sr-only">A reminder is waiting.</span></span>}
    </Button>
  )
}
