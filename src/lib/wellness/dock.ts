'use client'

/**
 * Pure layout math for the wellness dock (T2.4, spec section 6), plus a
 * couple of small client-only I/O helpers (session/local storage) that keep
 * the same "one small function" discipline rather than being buried inline
 * in `ShellLayout`/`Dock`/`WellnessSlot`.
 */

import { useSyncExternalStore } from 'react'
import type { DockCorner, DockPlacement, WellnessDockPrefs } from '@/lib/contracts'

export type DockOrientation = 'vertical' | 'horizontal' | 'pill' | 'none'

/** How `ShellLayout` arranges its grid for a given placement (R6.1: a real
 *  layout decision, not a class swap). `left`/`right` change the grid
 *  template; `top` switches to a stacked rows layout; `float`/`hidden` take
 *  the dock out of the grid entirely (rendered in a portal, or not at all). */
export type ShellGridTemplate = 'left-rail' | 'right-rail' | 'top-strip' | 'portal'

const ORIENTATION_BY_PLACEMENT: Record<DockPlacement, DockOrientation> = {
  left: 'vertical',
  right: 'vertical',
  top: 'horizontal',
  float: 'pill',
  hidden: 'none',
}

export function orientationFor(placement: DockPlacement): DockOrientation {
  return ORIENTATION_BY_PLACEMENT[placement]
}

const GRID_BY_PLACEMENT: Record<DockPlacement, ShellGridTemplate> = {
  left: 'left-rail',
  right: 'right-rail',
  top: 'top-strip',
  float: 'portal',
  hidden: 'portal',
}

export function gridTemplateFor(placement: DockPlacement): ShellGridTemplate {
  return GRID_BY_PLACEMENT[placement]
}

/** The two learner-facing screens where `compactOnExercise` applies (R6.3). */
const FOCUS_ROUTE_PREFIXES = ['/exercise', '/lesson']

export function isFocusRoute(pathname: string): boolean {
  return FOCUS_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * Whether the dock renders collapsed right now. The learner's stored
 * `collapsed` choice always collapses it; on `/exercise/[id]` and
 * `/lesson/[cloId]`, `compactOnExercise` (default on) forces collapse there
 * too -- but only collapse, never placement (R6.3).
 */
export function effectiveCollapsed(dock: WellnessDockPrefs, pathname: string): boolean {
  if (dock.collapsed) return true
  return dock.compactOnExercise && isFocusRoute(pathname)
}

const CORNER_COLUMN: Record<DockCorner, 0 | 1> = { tl: 0, bl: 0, tr: 1, br: 1 }
const CORNER_ROW: Record<DockCorner, 0 | 1> = { tl: 0, tr: 0, bl: 1, br: 1 }

function cornerFrom(column: 0 | 1, row: 0 | 1): DockCorner {
  if (column === 0) return row === 0 ? 'tl' : 'bl'
  return row === 0 ? 'tr' : 'br'
}

/**
 * Arrow-key corner navigation for the floating pill (R6.2: moving it is
 * pointer-optional). Any key other than the four arrows returns the same
 * corner unchanged, so a caller can pass every keydown through safely.
 */
export function nextCorner(corner: DockCorner, key: string): DockCorner {
  const column = CORNER_COLUMN[corner]
  const row = CORNER_ROW[corner]
  switch (key) {
    case 'ArrowLeft': return cornerFrom(0, row)
    case 'ArrowRight': return cornerFrom(1, row)
    case 'ArrowUp': return cornerFrom(column, 0)
    case 'ArrowDown': return cornerFrom(column, 1)
    default: return corner
  }
}

// ---------------------------------------------------------------------------
// Hidden is never a dead end: the header's re-open glyph (`DockControl`)
// restores the placement the learner actually had, not a hardcoded default.
// `WellnessDockPrefs` is frozen (contracts C4) and carries no "last
// placement" field, so this rides in sessionStorage rather than the
// persisted row -- the same choice `timers.ts`'s `isAttemptActive` makes for
// a signal that only needs to survive the tab, not the account.
// ---------------------------------------------------------------------------

const LAST_PLACEMENT_KEY = 'brogram:dock:last-placement'
const RESTORABLE_PLACEMENTS: DockPlacement[] = ['left', 'right', 'top', 'float']

/** Call whenever the learner sets a non-hidden placement, so hiding the dock later has something real to restore. */
export function rememberDockPlacement(placement: DockPlacement): void {
  if (placement === 'hidden') return
  try { sessionStorage.setItem(LAST_PLACEMENT_KEY, placement) } catch { /* Best-effort; 'right' remains a sane fallback. */ }
}

/** What the header's re-open glyph should restore. Defaults to 'right' when nothing was ever remembered this session. */
export function recallDockPlacement(): DockPlacement {
  try {
    const stored = sessionStorage.getItem(LAST_PLACEMENT_KEY)
    if (stored && (RESTORABLE_PLACEMENTS as string[]).includes(stored)) return stored as DockPlacement
  } catch { /* Best-effort; 'right' remains a sane fallback. */ }
  return 'right'
}

// ---------------------------------------------------------------------------
// Step 4's two-tier persistence (I2): local state and `localStorage` update in
// the same frame; the server write is a separate, debounced tier (the actual
// debounce lives with the mutation, `useDockPrefsMutation`, since it needs
// the query client). This is the *local* tier: `ShellLayout`/`WellnessSlot`
// read it as the initial value so the grid and the dock's own placement do
// not flash to the default `right` on every load while `useWellness()` is
// still in flight -- the server value wins the instant it resolves (`read`
// below is only ever consulted before that, by the callers' own priority
// order, never after).
// ---------------------------------------------------------------------------

const DOCK_CACHE_KEY = 'brogram:wellness:dock-cache'
const ALL_PLACEMENTS: DockPlacement[] = ['left', 'right', 'top', 'float', 'hidden']
const ALL_CORNERS: DockCorner[] = ['tl', 'tr', 'bl', 'br']

function isDockPrefsShape(value: unknown): value is WellnessDockPrefs {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.placement === 'string' && (ALL_PLACEMENTS as string[]).includes(candidate.placement) &&
    typeof candidate.collapsed === 'boolean' &&
    typeof candidate.compactOnExercise === 'boolean' &&
    typeof candidate.corner === 'string' && (ALL_CORNERS as string[]).includes(candidate.corner)
  )
}

function readDockPrefsFromStorage(): WellnessDockPrefs | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(DOCK_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isDockPrefsShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

// `useSyncExternalStore`'s `getSnapshot` must return a referentially stable
// value when nothing has changed (React calls it more than once per commit to
// check for tearing); re-parsing `localStorage` on every call would fail that
// and trigger React's "getSnapshot should be cached" warning. Cache it.
let dockPrefsCache: WellnessDockPrefs | null | undefined
const dockPrefsListeners = new Set<() => void>()

function getDockPrefsSnapshot(): WellnessDockPrefs | null {
  if (dockPrefsCache === undefined) dockPrefsCache = readDockPrefsFromStorage()
  return dockPrefsCache
}

function getDockPrefsServerSnapshot(): WellnessDockPrefs | null {
  return null
}

function subscribeDockPrefsCache(listener: () => void): () => void {
  dockPrefsListeners.add(listener)
  return () => dockPrefsListeners.delete(listener)
}

/** Mirrors the dock sub-object to `localStorage`, same frame as the optimistic
 *  cache update that should call this. */
export function writeCachedDockPrefs(dock: WellnessDockPrefs): void {
  dockPrefsCache = dock
  try { localStorage.setItem(DOCK_CACHE_KEY, JSON.stringify(dock)) } catch { /* Best-effort; the network write is still the source of truth. */ }
  for (const listener of dockPrefsListeners) listener()
}

/** The locally-cached dock prefs, or `null` before anything has ever been
 *  cached (including on the server, where this is always `null` -- there is
 *  no `localStorage` to read, so the caller's own default applies until the
 *  client mounts and, moments later, `useWellness()` resolves). */
export function useCachedDockPrefs(): WellnessDockPrefs | null {
  return useSyncExternalStore(subscribeDockPrefsCache, getDockPrefsSnapshot, getDockPrefsServerSnapshot)
}

/** Test-only: forgets whatever `useCachedDockPrefs` has memoized. */
export function resetDockPrefsCacheForTests(): void {
  dockPrefsCache = undefined
  try { localStorage.removeItem(DOCK_CACHE_KEY) } catch { /* jsdom always has localStorage */ }
}
