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
  /** `row`: an inline flex row (a progress-adjacent flourish, e.g. beside
   *  the XP bar). `burst`: absolutely positioned around a centre point, for
   *  layering directly over a hero glyph (fix round 2, Defect C -- an
   *  in-flow row of dots next to text read as a loading ellipsis, not a
   *  burst). Default `row`. */
  layout?: 'row' | 'burst'
}

const DEFAULT_COUNT = 5

/** A rough ring of offsets around a centred hero glyph, in percent of the
 *  container -- enough spread at typical hero sizes (40-48px) to read as
 *  radiating sparks rather than a cluster. */
const BURST_OFFSETS: { top: string; left: string }[] = [
  { top: '0%', left: '50%' },
  { top: '30%', left: '95%' },
  { top: '80%', left: '80%' },
  { top: '80%', left: '20%' },
  { top: '30%', left: '5%' },
]

/**
 * A short, transform-and-opacity-only spark burst -- shared by
 * `StreakFlame` (ignite/milestone: "flame scale plus sparks", spec 7.6) and
 * the level-up XP bar (fix round 1, C3: "sparks along the bar"), so both
 * moments spend the same small, cheap flourish rather than two bespoke
 * implementations. Purely decorative -- every caller already renders its
 * own text and plays its own sound; this never carries information on its
 * own (R7.5).
 */
export function Sparks({ trigger, count = DEFAULT_COUNT, motionPref, className, layout = 'row' }: SparksProps) {
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

  if (layout === 'burst') {
    return (
      <div ref={containerRef} className={cn('pointer-events-none absolute inset-0', className)} aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => {
          const offset = BURST_OFFSETS[index % BURST_OFFSETS.length]
          return (
            <span
              key={index}
              data-spark
              className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-celebration"
              style={{ top: offset.top, left: offset.left }}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn('pointer-events-none flex items-center gap-1', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} data-spark className="size-1 rounded-full bg-celebration" />
      ))}
    </div>
  )
}
