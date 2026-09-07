/**
 * The timing-law tokens (`src/lib/motion/tokens.ts`, T0.5), converted once
 * into the shapes this folder's Motion components need, so every card in
 * `src/components/rewards` reads the same values instead of each re-typing
 * the enter curve as its own literal (fix round 1/2, I7's minor half).
 *
 * `EASE.enter` is stored as the CSS `cubic-bezier(...)` string every plain
 * CSS transition in the tree reads; Motion's `ease` prop wants the same
 * four numbers as a plain tuple, so they are parsed out of the one source
 * of truth here rather than re-typed as a second literal in every file that
 * needs them.
 */
import { DUR, EASE } from '@/lib/motion/tokens'

export { DUR, EASE }

export const ENTER_S = DUR.celebration / 1000
export const EXIT_S = DUR.base / 1000

export function bezierTuple(css: string): [number, number, number, number] {
  const match = /cubic-bezier\(([^)]+)\)/.exec(css)
  const parts = (match?.[1] ?? '0,0,1,1').split(',').map((n) => Number.parseFloat(n.trim()))
  return [parts[0], parts[1], parts[2], parts[3]]
}

/**
 * The enter curve as a Motion-ready tuple. Fix round 2, I7 regression: exit
 * transitions never set an `ease` here -- "Never `ease-in` on UI" (spec line
 * 1039) is a hard ban, and duration alone (`EXIT_S` < `ENTER_S`) already
 * satisfies "exit is always faster than enter." Motion's own default ease
 * on the way out is not `ease-in`, so leaving `ease` unset on every exit is
 * the fix, not a replacement curve.
 */
export const ENTER_EASE = bezierTuple(EASE.enter)
