'use client'

import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import type { MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { cn } from '@/lib/utils'

export interface GoalRingProps {
  /** Wins so far today (spec 7.4: a passed exercise, a completed
   *  walkthrough, or a completed de-rot run). */
  wins: number
  /** `wellness.prefs.dailyGoal`, 1-10. */
  goal: number
  motionPref?: MotionPreference
  className?: string
}

const RADIUS = 18
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * The daily-goal ring (spec 7.4/7.6): fills as wins land, sweeps to
 * complete when the goal is met. `strokeDashoffset`, never `width`/`height`,
 * so the animated property stays on the R7.9-safe list.
 */
export function GoalRing({ wins, goal, motionPref, className }: GoalRingProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const circleRef = useRef<SVGCircleElement>(null)
  const safeGoal = goal > 0 ? goal : 1
  const pct = Math.min(1, Math.max(0, wins) / safeGoal)
  const targetOffset = CIRCUMFERENCE * (1 - pct)

  useGSAP(() => {
    const el = circleRef.current
    if (!el) return
    // Fix round 1, I2 (the same fault as XpCounter): kill whatever tween a
    // previous `wins` change started before beginning the next one, so two
    // wins landing close together cannot leave the ring fighting itself.
    gsap.killTweensOf(el)
    if (reducedMotion) {
      gsap.set(el, { strokeDashoffset: targetOffset })
      return
    }
    gsap.to(el, { strokeDashoffset: targetOffset, duration: 0.7, ease: 'power2.out' })
  }, [targetOffset, reducedMotion])

  return (
    <span
      className={cn('relative inline-flex size-12 items-center justify-center', className)}
      role="progressbar"
      aria-label="Daily goal"
      aria-valuenow={Math.max(0, wins)}
      aria-valuemin={0}
      aria-valuemax={goal}
    >
      <svg width="48" height="48" viewBox="0 0 40 40" aria-hidden="true" className="-rotate-90">
        <circle cx="20" cy="20" r={RADIUS} strokeWidth="4" className="fill-none stroke-muted" />
        <circle
          ref={circleRef}
          cx="20" cy="20" r={RADIUS} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          className="fill-none stroke-celebration"
        />
      </svg>
      <span className="absolute tabular text-micro text-foreground">{Math.max(0, wins)}/{goal}</span>
    </span>
  )
}
