'use client'

import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import type { RefObject } from 'react'
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
 */
export function useFlipIndicator(container: RefObject<HTMLElement | null>, activeKey: string, reduced: boolean): void {
  useGSAP(
    () => {
      const root = container.current
      if (!root) return

      const indicator = root.querySelector<HTMLElement>('[data-flip-indicator]')
      const target = root.querySelector<HTMLElement>(`[data-flip-key="${activeKey}"]`)
      if (!indicator || !target) return

      const rect = { x: target.offsetLeft, y: target.offsetTop, width: target.offsetWidth, height: target.offsetHeight }

      if (reduced) {
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
