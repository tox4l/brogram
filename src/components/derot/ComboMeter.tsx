'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ComboMeterProps {
  /** Current consecutive-correct streak, 0 after a miss or before the run starts. */
  streak: number
  /** The multiplier this streak earns (1, 1.2, 1.5, 2 -- see comboMultiplier). */
  multiplier: number
  /** R7.9: the pop becomes a plain colour change, no scale animation. */
  reduced?: boolean
}

const TIER_STYLES = ['bg-muted text-muted-foreground', 'bg-primary/15 text-primary', 'bg-primary/25 text-primary', 'bg-primary text-primary-foreground']

/** Remounts (via the caller's `key={streak}`) on every streak change so the pop restarts each step; under reduced motion it renders the settled state immediately. */
function PopBadge({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  const [settled, setSettled] = useState(reduced)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])
  return (
    <div
      style={{
        transform: reduced ? 'none' : settled ? 'scale(1)' : 'scale(1.3)',
        transition: reduced ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {children}
    </div>
  )
}

/** The combo meter shown during an Arcade run (spec 7.9 / 10.9): a "combo pop" on each multiplier step, a plain colour change under reduced motion. */
export function ComboMeter({ streak, multiplier, reduced = false }: ComboMeterProps) {
  const tier = Math.min(TIER_STYLES.length - 1, Math.max(0, streak))
  return (
    <div role="status" aria-label={`Combo ${streak}, ${multiplier} times multiplier`} className="inline-flex">
      <PopBadge key={streak} reduced={reduced}>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs font-medium', TIER_STYLES[tier])}>
          <span>{streak > 0 ? `${streak}x combo` : 'No combo'}</span>
          <span className="tabular-nums">{multiplier.toFixed(1)}×</span>
        </span>
      </PopBadge>
    </div>
  )
}
