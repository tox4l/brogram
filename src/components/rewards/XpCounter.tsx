'use client'

import { useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { cn } from '@/lib/utils'
import type { MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { play } from '@/lib/sound/manager'

export interface XpCounterProps {
  /** The settled XP total to display. */
  value: number
  motionPref?: MotionPreference
  /** Screen-reader label for the live region (default "XP"). */
  label?: string
  className?: string
}

const TWEEN_DURATION_S = 0.6

/**
 * The GSAP odometer (spec 7.6/7.8, T2.5 supplies the numbers this reads):
 * tween a plain proxy object, snap to whole numbers, write the formatted
 * result straight into the DOM via a ref -- never into React state. Writing
 * through React state would re-render on every animation frame and would
 * also race React's own reconciliation against the same text node GSAP is
 * mutating (whichever wrote last during a frame would win); a ref sidesteps
 * both. The screen-reader-only sibling below is ordinary React-rendered
 * text, always the current settled `value` -- the value is announced the
 * instant it changes, not once the tween finishes (R7.9: feedback reduces,
 * it never vanishes, and text must never depend on motion completing).
 *
 * Fix round 1, I2: the proxy now lives in a `useRef`, killed with
 * `gsap.killTweensOf` before a new tween starts. `useGSAP`'s default
 * (`revertOnUpdate: false`) re-runs this callback on every `value` change
 * but does not stop whatever tween the previous run started; without the
 * kill, two passes landing inside ~600ms (an optimistic local grade
 * followed by the server reconciliation is exactly this) left two tweens
 * writing the same text node every frame, and the counter visibly ran
 * backwards -- on the one component whose entire job is "nothing jitters".
 *
 * Fix round 1, I3: `xp.settle` (interface tier, off by default, costs
 * nothing muted) plays once the value is actually settled -- in the
 * tween's `onComplete`, or immediately under reduced motion so feedback
 * reduces rather than vanishes. Never per frame.
 *
 * Always through `useGSAP()` (never a bare `useEffect` + `gsap.to`) so a
 * route change mid-tween can never leave a timeline running against an
 * unmounted node.
 */
export function XpCounter({ value, motionPref, label = 'XP', className }: XpCounterProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const glyphRef = useRef<HTMLSpanElement>(null)
  const prevValueRef = useRef(value)
  const proxyRef = useRef({ v: value })
  const [initialText] = useState(() => Math.round(value).toLocaleString())

  useGSAP(() => {
    const el = glyphRef.current
    const from = prevValueRef.current
    const to = value
    prevValueRef.current = to
    if (!el || from === to) return

    gsap.killTweensOf(proxyRef.current)

    if (reducedMotion) {
      // Brief step 5: the counter SETS instead of tweening -- one frame, no timeline.
      el.textContent = Math.round(to).toLocaleString()
      play('xp.settle')
      return
    }

    proxyRef.current.v = from
    gsap.to(proxyRef.current, {
      v: to,
      duration: TWEEN_DURATION_S,
      ease: 'power1.out',
      snap: { v: 1 },
      onUpdate: () => {
        el.textContent = Math.round(proxyRef.current.v).toLocaleString()
      },
      onComplete: () => play('xp.settle'),
    })
  }, [value, reducedMotion])

  return (
    <span className={cn('tabular', className)}>
      <span ref={glyphRef} aria-hidden="true">{initialText}</span>
      <span className="sr-only" aria-live="polite">{Math.round(value).toLocaleString()} {label}</span>
    </span>
  )
}
