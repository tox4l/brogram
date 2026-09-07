'use client'

import { useRef, type RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import type { MotionPreference } from '@/lib/contracts'
import type { FlameState } from '@/lib/rewards/streaks'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { cn } from '@/lib/utils'

export interface StreakFlameProps {
  state: FlameState
  /** The streak length in days, shown next to the glyph. */
  days: number
  motionPref?: MotionPreference
  className?: string
}

const FILLED_STATES = new Set<FlameState>(['lit', 'at-risk', 'ignite', 'milestone'])

/** Hand-drawn inline SVG (brief: no emoji, on-brand CSS/SVG art), a single
 *  teardrop flame path reused filled or outline-only. */
function FlameGlyph({ filled, glyphRef }: { filled: boolean; glyphRef: RefObject<SVGSVGElement | null> }) {
  return (
    <svg ref={glyphRef} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2c1 3-3 4-3 8a3 3 0 1 0 6 0c1.5 1 2 3 2 4.5A5.5 5.5 0 0 1 6 20a5.5 5.5 0 0 1-1-10.5C7 7 9 5 12 2Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
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
 * scale up briefly (milestone bigger); reset dims once to an ember and
 * holds, no loop. Every state that carries copy also renders it (an
 * sr-only announcement plus the visible day count) -- nothing here is
 * conveyed by motion alone.
 */
export function StreakFlame({ state, days, motionPref, className }: StreakFlameProps) {
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
      <span className="sr-only" aria-live="polite">{announcement(state, days)}</span>
    </span>
  )
}
