'use client'

import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import type { MotionPreference } from '@/lib/contracts'
import { levelBand } from '@/lib/rewards/goal'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { cn } from '@/lib/utils'

export interface LevelBadgeProps {
  level: number
  /** Play the spring entrance once (the level-up moment). A persistent
   *  dashboard/header display omits this and just sits still. */
  animateEntrance?: boolean
  motionPref?: MotionPreference
  className?: string
}

/** Spec 7.6/7.8: "badge entrance on a spring (duration 0.5, bounce 0.2)". */
const ENTRANCE_DURATION_S = 0.5

/**
 * The level number plus its band label (spec 7.3: "the number is always
 * shown too" -- never the band alone). Reusable both as a persistent
 * display (dashboard, Account) and as the level-up celebration's centrepiece
 * (`animateEntrance`), so the two never drift into two different renderings
 * of the same fact.
 */
export function LevelBadge({ level, animateEntrance = false, motionPref, className }: LevelBadgeProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const el = ref.current
    if (!el || !animateEntrance) return
    if (reducedMotion) {
      // R7.9: springs collapse to a 150ms opacity cross-fade, never vanish outright.
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15 })
      return
    }
    // "Never enter from scale(0); start at 0.95" (spec 7.8).
    gsap.fromTo(el, { opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1, duration: ENTRANCE_DURATION_S, ease: 'back.out(1.7)' })
  }, [animateEntrance, reducedMotion])

  return (
    <div
      ref={ref}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-[var(--elevation-sm)]',
        className,
      )}
    >
      <span className="tabular text-sm font-semibold text-foreground">Level {level}</span>
      <span className="text-xs text-muted-foreground">{levelBand(level)}</span>
    </div>
  )
}
