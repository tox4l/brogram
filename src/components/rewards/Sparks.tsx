'use client'

import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import type { MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { cn } from '@/lib/utils'

export interface SparksProps {
  /** Bumped by the caller (an item id, a streak count) to replay the burst;
   *  the same trigger never re-plays. */
  trigger: string | number
  count?: number
  motionPref?: MotionPreference
  className?: string
}

const DEFAULT_COUNT = 5

/**
 * A short, transform-and-opacity-only spark burst -- shared by
 * `StreakFlame` (ignite/milestone: "flame scale plus sparks", spec 7.6) and
 * the level-up XP bar (fix round 1, C3: "sparks along the bar"), so both
 * moments spend the same small, cheap flourish rather than two bespoke
 * implementations. Purely decorative -- every caller already renders its
 * own text and plays its own sound; this never carries information on its
 * own (R7.5).
 */
export function Sparks({ trigger, count = DEFAULT_COUNT, motionPref, className }: SparksProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const el = containerRef.current
    if (!el || reducedMotion) return
    const dots = el.querySelectorAll<HTMLElement>('[data-spark]')
    if (dots.length === 0) return
    gsap.set(dots, { opacity: 0, scale: 0.4 })
    gsap.to(dots, {
      opacity: 1,
      scale: 1,
      duration: 0.25,
      stagger: 0.04,
      ease: 'back.out(2)',
      onComplete: () => {
        gsap.to(dots, { opacity: 0, duration: 0.3, delay: 0.15 })
      },
    })
  }, [trigger, reducedMotion])

  if (reducedMotion) return null

  return (
    <div ref={containerRef} className={cn('pointer-events-none flex items-center gap-1', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} data-spark className="size-1 rounded-full bg-celebration" />
      ))}
    </div>
  )
}
