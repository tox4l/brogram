'use client'

import { useRef, type KeyboardEvent } from 'react'
import type { DrillLane } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import { useFlipIndicator } from '@/components/motion/useFlipIndicator'

export interface LaneSwitchProps {
  lane: DrillLane
  onChange: (lane: DrillLane) => void
  /** R7.9: the 200ms slide becomes an instant snap, never removed entirely. */
  reduced?: boolean
}

const LANES: { value: DrillLane; label: string }[] = [
  { value: 'arcade', label: 'Arcade' },
  { value: 'play', label: 'Playground' },
]

/**
 * The two-lane switch on the de-rot hub (spec 10.8): a sliding indicator
 * under the active tab, 200ms move curve, instant under reduced motion. Real
 * `<button>` elements with a roving tabindex (WAI-ARIA tabs pattern) so the
 * whole thing is keyboard-operable: Tab reaches the active lane, ArrowLeft /
 * ArrowRight move focus and switch lanes together (automatic activation),
 * and a click on either tab works exactly the same way.
 */
export function LaneSwitch({ lane, onChange, reduced = false }: LaneSwitchProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // W4 spec section 5.4 / plan T4.8: the sliding indicator moves through the
  // shared useFlipIndicator hook (T4.2), not a hand-rolled translateX --
  // `data-flip-indicator` on the pill, `data-flip-key={lane.value}` on each
  // tab below.
  useFlipIndicator(containerRef, lane, reduced)

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % LANES.length : (index - 1 + LANES.length) % LANES.length
    const next = LANES[nextIndex]
    onChange(next.value)
    // Focus follows selection so the roving tabindex stays consistent with what's on screen.
    requestAnimationFrame(() => {
      const node = document.querySelector<HTMLButtonElement>(`[data-lane-tab="${next.value}"]`)
      node?.focus()
    })
  }

  return (
    <div ref={containerRef} role="tablist" aria-label="De-rot lane" className="relative inline-flex rounded-full border border-rule bg-muted p-1">
      <div aria-hidden="true" data-flip-indicator className="absolute inset-y-1 left-1 rounded-full bg-background shadow-sm" />
      {LANES.map((entry, index) => (
        <button
          key={entry.value}
          type="button"
          role="tab"
          data-lane-tab={entry.value}
          data-flip-key={entry.value}
          aria-selected={lane === entry.value}
          tabIndex={lane === entry.value ? 0 : -1}
          onClick={() => onChange(entry.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={cn(
            'relative z-10 min-w-24 rounded-full px-4 py-2 text-small font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            lane === entry.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}
