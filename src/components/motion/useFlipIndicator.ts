'use client'

import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { useRef, type RefObject } from 'react'
import { DUR } from '@/lib/motion/tokens'

/**
 * One shared FLIP for every indicator that moves between two positions
 * instead of remounting (W4 §5.4) -- the dock lane indicator, a tab
 * underline. **Not** the code guide band (§7.2 explains why: the guide
 * intentionally sets `transition: none` under reduced motion instead of
 * jumping, because losing the band's position deletes the teaching, not
 * the motion -- a different law than "reposition instantly"; ruling W4.20
 * keeps the guide band on plain CSS because a transition retargets
 * mid-flight where a tween would restart from zero).
 *
 * Contract: inside `container`, one element carries `data-flip-indicator`
 * (the thing that moves) and each candidate position carries
 * `data-flip-key={key}` (`activeKey` selects which one). Discovering both
 * from a plain `container` ref -- rather than taking two more ref props --
 * is what lets the signature stay `(container, activeKey, reduced)`.
 *
 * `Flip.getState` → reposition → `Flip.from`: the indicator's rect is
 * captured *before* it snaps to the new target's position (a plain
 * `gsap.set` of `x`/`y`/`width`/`height`, never `left`/`top`/`width`/`height`
 * as CSS properties -- R7.8's animated-properties ban), then `Flip.from`
 * animates the visual difference. `scale: true` animates `scaleX`/`scaleY`
 * instead of tweening `width`/`height` directly -- exactly that same ban.
 *
 * Ruling W4.16: under reduced motion this never calls `Flip.from` --  it
 * positions with one `gsap.set` in the same shape, so the indicator still
 * lands in the right place, just without the animated move.
 *
 * Two more preconditions, both load-bearing:
 *
 * - **First mount never animates.** The `useGSAP` callback also runs on
 *   initial mount (there is no separate "first run" concept), and on mount
 *   there is no previous position for the indicator to move FROM -- only
 *   its untransformed layout origin. Flipping from that origin reads as
 *   unrequested entrance motion on a shell element (spec 5.4 scopes this
 *   hook to indicators moving BETWEEN two already-chosen positions). A
 *   `first` ref, written inside the effect (writing a ref in an effect is
 *   fine -- the react-hooks `refs` rule bans reading one during render, not
 *   writing one in an effect), forces the first run down the same
 *   `gsap.set`-only branch as `reduced`.
 * - **The geometry is a delta, not an absolute coordinate.** `gsap.set(el,
 *   { x, y })` writes a transform relative to the indicator's OWN static
 *   flow position, while `target.offsetLeft/offsetTop` is an absolute
 *   coordinate in the shared `offsetParent`'s frame. The two agree only
 *   when the indicator's own `offsetLeft/offsetTop` happen to be zero.
 *   Subtracting the indicator's own offset (`target.offsetLeft -
 *   indicator.offsetLeft`) gives the correct delta regardless of the
 *   indicator's resting position, and stays correct across repeated calls
 *   because `offsetLeft/offsetTop` ignore any transform already applied.
 *   This still requires `indicator.offsetParent === target.offsetParent`;
 *   in development a mismatch is a `console.warn`, not a silent wrong
 *   answer.
 */
export function useFlipIndicator(container: RefObject<HTMLElement | null>, activeKey: string, reduced: boolean): void {
  const first = useRef(true)

  useGSAP(
    () => {
      const root = container.current
      if (!root) return

      const indicator = root.querySelector<HTMLElement>('[data-flip-indicator]')
      const target = root.querySelector<HTMLElement>(`[data-flip-key="${activeKey}"]`)
      if (!indicator || !target) return

      if (process.env.NODE_ENV !== 'production' && indicator.offsetParent !== target.offsetParent) {
        console.warn('useFlipIndicator: the indicator and its target do not share an offsetParent, so the computed x/y will be wrong')
      }

      const rect = {
        x: target.offsetLeft - indicator.offsetLeft,
        y: target.offsetTop - indicator.offsetTop,
        width: target.offsetWidth,
        height: target.offsetHeight,
      }

      if (reduced || first.current) {
        first.current = false
        gsap.set(indicator, rect)
        return
      }

      gsap.killTweensOf(indicator)
      const state = Flip.getState(indicator)
      gsap.set(indicator, rect)
      Flip.from(state, { duration: DUR.guide / 1000, ease: 'move', scale: true, absolute: true })
    },
    { scope: container, dependencies: [activeKey, reduced] },
  )
}
