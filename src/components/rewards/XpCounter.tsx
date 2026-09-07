'use client'

import { useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { cn } from '@/lib/utils'
import type { MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'

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
 * Always through `useGSAP()` (never a bare `useEffect` + `gsap.to`) so a
 * route change mid-tween can never leave a timeline running against an
 * unmounted node.
 */
export function XpCounter({ value, motionPref, label = 'XP', className }: XpCounterProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const glyphRef = useRef<HTMLSpanElement>(null)
  const prevValueRef = useRef(value)
  const [initialText] = useState(() => Math.round(value).toLocaleString())

  useGSAP(() => {
    const el = glyphRef.current
    const from = prevValueRef.current
    const to = value
    prevValueRef.current = to
    if (!el || from === to) return

    if (reducedMotion) {
      // Brief step 5: the counter SETS instead of tweening -- one frame, no timeline.
      el.textContent = Math.round(to).toLocaleString()
      return
    }

    const proxy = { v: from }
    gsap.to(proxy, {
      v: to,
      duration: TWEEN_DURATION_S,
      ease: 'power1.out',
      snap: { v: 1 },
      onUpdate: () => {
        el.textContent = Math.round(proxy.v).toLocaleString()
      },
    })
  }, [value, reducedMotion])

  return (
    <span className={cn('tabular', className)}>
      <span ref={glyphRef} aria-hidden="true">{initialText}</span>
      <span className="sr-only" aria-live="polite">{Math.round(value).toLocaleString()} {label}</span>
    </span>
  )
}
