'use client'

import { motion } from 'motion/react'
import { X } from 'lucide-react'
import type { Achievement, AchievementTier, MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TIER_COLOR: Record<AchievementTier, string> = {
  bronze: 'text-warning',
  silver: 'text-muted-foreground',
  gold: 'text-celebration',
}

export interface TrophyGlyphProps {
  tier?: AchievementTier
  /** Outline-only, muted -- the locked silhouette used on the shelf. */
  locked?: boolean
  className?: string
}

/** Hand-drawn inline SVG trophy (brief: no emoji; achievement art is CSS or
 *  inline SVG). Shared by the unlock card and the shelf's locked/unlocked
 *  tiles so both draw the same shape. */
export function TrophyGlyph({ tier, locked = false, className }: TrophyGlyphProps) {
  const colorClass = locked ? 'text-muted-foreground' : tier ? TIER_COLOR[tier] : 'text-celebration'
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', colorClass, className)}>
      <path
        d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4Z"
        fill={locked ? 'none' : 'currentColor'}
        stroke="currentColor"
        strokeWidth={locked ? 1.4 : 0}
        opacity={locked ? 0.6 : 0.9}
      />
      <path d="M5 5H3a2 2 0 0 0 2 4M19 5h2a2 2 0 0 1-2 4" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M10 13.5v2.5H8.5a1 1 0 0 0 0 2h7a1 1 0 0 0 0-2H14v-2.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export interface TrophyCardProps {
  /** null for the collapsed "N new trophies" card. */
  achievement: Achievement | null
  collapsedCount?: number
  motionPref?: MotionPreference
  onDismiss: () => void
  /** The collapsed card's one action: open the trophy shelf. Optional so a
   *  call site with nowhere to send the learner can omit it -- the card
   *  still dismisses cleanly either way. */
  onOpenShelf?: () => void
}

/**
 * One achievement unlock, or the collapsed "N new trophies" card (brief step
 * 1: a queue longer than two collapses into this). Motion owns the
 * mount/unmount (spec 7.8: "trophy cards" are explicitly Motion's, not
 * GSAP's). Always dismissable via the visible close button; `Celebration.tsx`
 * additionally wires Escape at the layer level.
 */
export function TrophyCard({ achievement, collapsedCount, motionPref, onDismiss, onOpenShelf }: TrophyCardProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const isCollapsed = Boolean(collapsedCount && collapsedCount > 0)
  const title = isCollapsed ? `${collapsedCount} new trophies` : achievement?.name ?? 'Trophy unlocked'
  const line = isCollapsed ? 'Go see them.' : achievement?.line ?? ''

  const entrance = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, scale: 0.95, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.97 },
        transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
      }

  return (
    <motion.div
      {...entrance}
      role="status"
      className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-md)]"
    >
      <TrophyGlyph tier={achievement?.tier} locked={false} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{line}</p>
        {isCollapsed && (
          <button
            type="button"
            onClick={onOpenShelf}
            className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Open the shelf
          </button>
        )}
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} className="shrink-0">
        <X aria-hidden="true" />
      </Button>
    </motion.div>
  )
}
