'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { play, withInterfaceSounds } from '@/lib/sound/manager'

export interface CountdownRingProps {
  remainingMs: number
  /** 0..100, from useCountdown. */
  percentRemaining: number
  /** R7.9 / spec 10.9: the ring becomes a plain numeric countdown. */
  reduced?: boolean
  /** The rising tick is silent above 25% remaining, and only plays for the duration of a run -- off by default so a bare ring is never noisy on its own. */
  tickEnabled?: boolean
}

const RADIUS = 26
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const AMBER_THRESHOLD = 25
const RED_THRESHOLD = 10

type Band = 'normal' | 'amber' | 'red'

function bandFor(percentRemaining: number): Band {
  if (percentRemaining <= RED_THRESHOLD) return 'red'
  if (percentRemaining <= AMBER_THRESHOLD) return 'amber'
  return 'normal'
}

const BAND_STROKE: Record<Band, string> = {
  normal: 'stroke-primary',
  amber: 'stroke-amber-500',
  red: 'stroke-destructive',
}

const BAND_TEXT: Record<Band, string> = {
  normal: 'text-foreground',
  amber: 'text-amber-600',
  red: 'text-destructive',
}

/**
 * The countdown ring on an Arcade item (spec 7.9 step 1 / 10.9): amber in the
 * last 25% of the time limit, red in the last 10%, with a rising tick that
 * is silent above 25% remaining. The numeric seconds label is always shown
 * alongside the colour band -- a verdict is never colour alone -- and under
 * reduced motion the ring itself is replaced by that same number.
 */
export function CountdownRing({ remainingMs, percentRemaining, reduced = false, tickEnabled = false }: CountdownRingProps) {
  const seconds = Math.ceil(remainingMs / 1000)
  const band = bandFor(percentRemaining)
  const lastTickSecond = useRef<number | null>(null)

  useEffect(() => {
    if (!tickEnabled) return
    if (percentRemaining > AMBER_THRESHOLD) {
      lastTickSecond.current = null
      return
    }
    if (lastTickSecond.current === seconds) return
    lastTickSecond.current = seconds
    withInterfaceSounds(() => play('ui.tap'))
  }, [seconds, percentRemaining, tickEnabled])

  if (reduced) {
    return (
      <div role="timer" className={cn('font-mono text-2xl font-semibold tabular-nums', BAND_TEXT[band])}>
        {seconds}s
      </div>
    )
  }

  const offset = CIRCUMFERENCE * (1 - percentRemaining / 100)

  return (
    <div role="timer" className="relative inline-flex size-16 items-center justify-center">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={RADIUS} className="fill-none stroke-muted" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          className={cn('fill-none transition-[stroke-dashoffset] duration-100 ease-linear', BAND_STROKE[band])}
          strokeWidth="4"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className={cn('absolute font-mono text-sm font-semibold tabular-nums', BAND_TEXT[band])}>{seconds}s</span>
    </div>
  )
}
