'use client'

import { useRef, type RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import type { MotionPreference } from '@/lib/contracts'
import type { FlameState } from '@/lib/rewards/streaks'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { Sparks } from './Sparks'
import { cn } from '@/lib/utils'

export interface StreakFlameProps {
  state: FlameState
  /** The streak length in days, shown next to the glyph. */
  days: number
  motionPref?: MotionPreference
  /** False when a parent (the celebration layer) already owns the single
   *  sr-only announcement for this moment (fix round 1, I6: one live region
   *  per celebration, not three). Standalone uses (a persistent dashboard
   *  flame) keep the default `true`. */
  announce?: boolean
  className?: string
}

const FILLED_STATES = new Set<FlameState>(['lit', 'at-risk', 'ignite', 'milestone'])
const SPARK_STATES = new Set<FlameState>(['ignite', 'milestone'])

/**
 * Hand-drawn inline SVG (brief: no emoji, on-brand CSS/SVG art). Fix round
 * 1, M5: a single closed path reads as a teardrop at 20px because it has no
 * interior structure. Two changes fix that: a second, smaller inner-core
 * path (a flame is read from its core as much as its outline) and a pulled-in
 * left shoulder so the silhouette is asymmetric rather than a symmetric drop.
 */
function FlameGlyph({ filled, glyphRef }: { filled: boolean; glyphRef: RefObject<SVGSVGElement | null> }) {
  return (
    <svg ref={glyphRef} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12.5 2c1.4 2.8-2.2 4.4-2.6 7.6-.3 2.1.6 3.6 2.1 3.6a2.6 2.6 0 0 0 2.6-2.9c1.6 1.3 2.4 3.3 2.4 5.2a5.5 5.5 0 0 1-6 5.5A5.6 5.6 0 0 1 6 15.4c0-2.2 1-3.6 2.2-5 1.1-1.3 2.3-2.6 2.6-5A9 9 0 0 1 12.5 2Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {filled && (
        <path
          d="M12.6 12.2c.5.6.7 1.4.4 2.2a1.7 1.7 0 0 1-3.1-.4c-.2-.9.2-1.6.8-2.2.5.3.9.2 1.9.4Z"
          fill="var(--celebration-foreground)"
          opacity="0.55"
        />
      )}
    </svg>
  )
}

function announcement(state: FlameState, days: number): string {
  switch (state) {
    case 'ignite': return `Day ${days}. Same time tomorrow.`
    case 'milestone': return `${days} days. That is not luck.`
    case 'reset': return 'Streak reset. Fresh start today.'
    case 'at-risk': return `Day ${days}. Not counted yet today.`
    case 'lit': return `Day ${days} streak.`
    default: return 'No streak yet.'
  }
}

/**
 * The flame glyph and its per-state motion (spec 7.4's table, restated):
 * cold is still and outlined; lit flickers slowly via opacity only (no
 * transform, per spec); at-risk pulses once, dimmed; ignite and milestone
 * scale up briefly plus a spark burst (milestone bigger, spec 7.6: "flame
 * scale plus sparks"); reset dims once to an ember and holds, no loop.
 * Every state that carries copy also renders it -- nothing here is
 * conveyed by motion alone.
 */
export function StreakFlame({ state, days, motionPref, announce = true, className }: StreakFlameProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const glyphRef = useRef<SVGSVGElement>(null)
  const filled = FILLED_STATES.has(state)

  useGSAP(() => {
    const el = glyphRef.current
    if (!el) return
    gsap.killTweensOf(el)

    if (reducedMotion) {
      // R7.9: every looping/idle animation stops and holds a static state.
      gsap.set(el, { opacity: 1, scale: 1 })
      return
    }

    switch (state) {
      case 'lit':
        gsap.fromTo(el, { opacity: 1 }, { opacity: 0.75, duration: 1.5, ease: 'sine.inOut', yoyo: true, repeat: -1 })
        break
      case 'at-risk':
        gsap.fromTo(el, { opacity: 1 }, { opacity: 0.5, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: 1 })
        break
      case 'ignite':
        gsap.fromTo(el, { scale: 1 }, { scale: 1.18, duration: 0.3, ease: 'back.out(2)', yoyo: true, repeat: 1 })
        break
      case 'milestone':
        gsap.fromTo(el, { scale: 1 }, { scale: 1.28, duration: 0.35, ease: 'back.out(2)', yoyo: true, repeat: 1 })
        break
      case 'reset':
        gsap.fromTo(el, { opacity: 1 }, { opacity: 0.35, duration: 0.6, ease: 'power1.out' })
        break
      default:
        gsap.set(el, { opacity: 1, scale: 1 })
    }
  }, [state, reducedMotion])

  return (
    <span className={cn('inline-flex items-center gap-1.5', filled ? 'text-celebration' : 'text-muted-foreground', className)}>
      <FlameGlyph filled={filled} glyphRef={glyphRef} />
      <span className="tabular text-sm font-medium text-foreground">{days}</span>
      {SPARK_STATES.has(state) && <Sparks trigger={`${state}-${days}`} motionPref={motionPref} />}
      {announce && <span className="sr-only" aria-live="polite">{announcement(state, days)}</span>}
    </span>
  )
}
