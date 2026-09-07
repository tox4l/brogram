'use client'

import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { useState, useSyncExternalStore } from 'react'
import { DEFAULT_WELLNESS, type DockCorner, type WellnessDockPrefs } from '@/lib/contracts'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { effectiveCollapsed, orientationFor, useCachedDockPrefs } from '@/lib/wellness/dock'
import { clearReminderBadge } from '@/lib/wellness/reminderBadge'
import { useDockPrefsMutation } from '@/components/wellness/useDockPrefs'
import { Dock } from '@/components/wellness/Dock'

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

/**
 * Placement-driven wellness dock slot (T2.4, spec 6.1). Reads `wellness.prefs.dock`
 * (same cached query `ShellLayout` reads for the grid, `SoundToggle` and
 * `DockControl` read for their own toggles -- one cache, several readers),
 * falling back to the `localStorage`-cached dock prefs (I2) before the query
 * has any data, and decides: a headless (invisible) `<Dock>` for `hidden`
 * (C3: the reminder engine keeps running even though nothing is on screen --
 * the header's `DockControl` is the only visible way back), a
 * portal-rendered floating pill for `float`, or the placement-driven
 * `<Dock>` otherwise.
 *
 * `effectiveCollapsed` folds in `compactOnExercise` on the exercise and
 * lesson routes without ever touching the learner's placement. When the
 * route is the *only* reason the dock is collapsed (the stored preference
 * itself is expanded), the expand control toggles a session-only override
 * instead of writing `dock.collapsed` (I1) -- otherwise clicking "expand" on
 * `/exercise` would collapse the dock everywhere else the next time
 * `effectiveCollapsed` is evaluated without the route's help.
 */
export function WellnessSlot() {
  const pathname = usePathname()
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const cachedDock = useCachedDockPrefs()
  const dock: WellnessDockPrefs = wellnessQuery.data
    ? resolveWellnessPrefs(wellnessQuery.data.prefs).dock
    : (cachedDock ?? DEFAULT_WELLNESS.dock)
  const { placement, corner } = dock
  const orientation = orientationFor(placement)

  // A session-only "expanded here" override (I1), reset whenever the route
  // changes -- adjusted during render (not in an effect: this project bans
  // synchronous `setState` inside `useEffect`), the pattern React's own docs
  // recommend for "reset state when a prop changes".
  const [sessionExpanded, setSessionExpanded] = useState(false)
  const [trackedPathname, setTrackedPathname] = useState(pathname)
  if (trackedPathname !== pathname) {
    setTrackedPathname(pathname)
    setSessionExpanded(false)
  }

  const routeForced = !dock.collapsed && effectiveCollapsed(dock, pathname)
  const collapsed = routeForced ? !sessionExpanded : dock.collapsed

  const dockPrefsMutation = useDockPrefsMutation(userId)
  const toggleCollapse = () => {
    if (collapsed) clearReminderBadge()
    if (routeForced) { setSessionExpanded((expanded) => !expanded); return }
    dockPrefsMutation.mutate((current) => ({ collapsed: !current.dock.collapsed }))
  }
  const changeCorner = (nextCornerValue: DockCorner) => dockPrefsMutation.mutate(() => ({ corner: nextCornerValue }))

  const mounted = useMounted()

  if (placement === 'hidden') {
    return <Dock orientation="headless" collapsed onToggleCollapse={() => {}} corner={corner} onCornerChange={() => {}} />
  }

  if (orientation === 'pill') {
    if (!mounted) return null
    return createPortal(
      <Dock orientation="pill" collapsed={collapsed} onToggleCollapse={toggleCollapse} corner={corner} onCornerChange={changeCorner} />,
      document.body,
    )
  }

  return <Dock orientation={orientation === 'none' ? 'vertical' : orientation} collapsed={collapsed} onToggleCollapse={toggleCollapse} corner={corner} onCornerChange={changeCorner} />
}
