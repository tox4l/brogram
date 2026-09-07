'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'

/**
 * The only place `canvas-confetti` is imported anywhere in this tree (brief
 * step 6): a plain dynamic `import()` inside an effect, never a static
 * `import` at the top of a module, so the ~6KB library never rides any
 * route's initial chunk regardless of which page happens to mount
 * `<Celebration />`.
 *
 * Renders nothing -- this is a pure side-effect component. `trigger`
 * identifies one specific celebration (its queue id), or `null` for "nothing
 * pending". A re-render with the same `trigger` never fires twice.
 *
 * Fix round 1, C1: this component is now mounted **unconditionally** for
 * the celebration layer's whole lifetime (`Celebration.tsx` used to render
 * it only inside `{current?.confetti && <ConfettiBurst .../>}`, which
 * unmounted and remounted it every time the queue's front item changed --
 * resetting the `firedRef` guard below and letting an item preempted and
 * later restored to the front burst a second time). Kept mounted, the same
 * "same trigger never fires twice" guard is correct for the component's
 * entire lifetime instead of one card's.
 */
export interface ConfettiBurstProps {
  trigger: string | null
  motionPref?: MotionPreference
  /** The element the burst should appear to originate from. Defaults to
   *  upper-centre of the viewport when omitted or not yet mounted. */
  originRef?: RefObject<HTMLElement | null>
}

export function ConfettiBurst({ trigger, motionPref, originRef }: ConfettiBurstProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const firedRef = useRef<string | null>(null)

  useEffect(() => {
    if (trigger === null) return
    // R7.9 / brief step 5: under reduced motion, confetti does not fire at
    // all -- not "fires but is invisible". `disableForReducedMotion` below
    // is defense in depth for a direct OS-level check the library does on
    // its own; this component's own gate is what the tests assert against.
    if (reducedMotion) return
    if (firedRef.current === trigger) return
    firedRef.current = trigger
    let cancelled = false

    void import('canvas-confetti').then(({ default: confetti }) => {
      if (cancelled) return
      const rect = originRef?.current?.getBoundingClientRect()
      const origin = rect
        ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: rect.top / window.innerHeight }
        : { x: 0.5, y: 0.35 }
      confetti({
        particleCount: 60,
        spread: 55,
        origin,
        disableForReducedMotion: true,
      })
    })

    return () => {
      cancelled = true
    }
  }, [trigger, reducedMotion, originRef])

  return null
}
