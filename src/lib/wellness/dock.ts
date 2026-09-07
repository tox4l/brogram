/**
 * Pure layout math for the wellness dock (T2.4, spec section 6). Kept out of
 * JSX so the five-placement decision, the collapse rule and the float pill's
 * keyboard corner navigation are each one small, unit-tested function rather
 * than logic buried inside `ShellLayout`/`Dock`.
 */

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
