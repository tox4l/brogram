'use client'

import type { MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { cn } from '@/lib/utils'

export interface ChainPipsProps {
  /** 0-3: the current chain, filling one pip per pattern angle passed. */
  count: number
  motionPref?: MotionPreference
  className?: string
}

/**
 * The 3-pip chain indicator (spec 7.6: "one pip fills on the 3-pip
 * indicator, 180ms enter curve"). A CSS transition -- interruptible and
 * high-frequency, exactly the case spec 7.8 reserves for CSS rather than
 * GSAP/Motion -- so a chain that fills and resets in quick succession
 * (a miss, then a fresh angle) retargets mid-flight instead of restarting
 * from zero the way a keyframe animation would.
 */
export function ChainPips({ count, motionPref, className }: ChainPipsProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const clamped = Math.max(0, Math.min(3, count))

  return (
    <span className={cn('inline-flex items-center gap-1', className)} role="img" aria-label={`${clamped} of 3 in a row`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn('size-2 rounded-full border', i < clamped ? 'border-celebration bg-celebration' : 'border-border bg-transparent')}
          style={reducedMotion ? undefined : { transition: 'background-color 180ms var(--ease-enter), border-color 180ms var(--ease-enter)' }}
        />
      ))}
    </span>
  )
}
