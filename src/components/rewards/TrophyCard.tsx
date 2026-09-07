'use client'

import { motion } from 'motion/react'
import { X } from 'lucide-react'
import type { Achievement, AchievementTier, MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { line as bankLine } from '@/lib/voice/lines'
import { ENTER_EASE, ENTER_S, EXIT_S } from './motionTokens'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Fix round 2, I1: `src/lib/contracts.ts` is frozen (standing constraint 4)
 * and still holds `first-blood`'s original line -- "First one down. That
 * feeling is the whole product." -- the exact sentence the voice bank's own
 * fix round 1 removed as "the founder's word, not the bro's"
 * (`src/lib/voice/lines.ts:136-137`, key `pass.first`). Since the contract
 * cannot be edited, every read site goes through this instead of
 * `achievement.line` directly, so the honest bank text is what actually
 * reaches a learner. Flagged for the controller's ledger: `contracts.ts`'s
 * `first-blood.line` itself still reads the removed wording and should be
 * corrected there whenever that frozen file next gets a signed-off pass.
 */
export function achievementLine(achievement: Achievement): string {
  if (achievement.id === 'first-blood') return bankLine('pass.first')
  return achievement.line
}

/**
 * Fix round 1, M3: `bronze` (`text-warning`) and `gold` (`text-celebration`)
 * are the same lightness, 0.04 chroma and 10 degrees of hue apart on
 * Midnight -- indistinguishable, and tier was conveyed by colour alone.
 * Bronze gets its own literal colour, well clear of both `--warning` and
 * `--celebration` in every theme; the tier NAME is also printed as text
 * below (`TIER_LABEL`), so nothing here still depends on colour alone.
 */
const TIER_COLOR_CLASS: Record<AchievementTier, string> = {
  bronze: '',
  silver: 'text-muted-foreground',
  gold: 'text-celebration',
}
const BRONZE_COLOR = 'oklch(0.62 0.13 48)'

export const TIER_LABEL: Record<AchievementTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
}

export interface TrophyGlyphProps {
  tier?: AchievementTier
  /** Outline-only, muted -- the locked silhouette used on the shelf. */
  locked?: boolean
  className?: string
}

/**
 * Hand-drawn inline SVG trophy (brief: no emoji; achievement art is CSS or
 * inline SVG). Shared by the unlock card and the shelf's locked/unlocked
 * tiles so both draw the same shape.
 *
 * Fix round 1, M2: the handles used to start at x=5/x=19 while the cup spans
 * x=7..17, so both handles were drawn floating two units clear of the cup --
 * "two detached curls" at 28px. They now start on the cup's own edge.
 */
export function TrophyGlyph({ tier, locked = false, className }: TrophyGlyphProps) {
  const colorClass = locked ? 'text-muted-foreground' : tier ? TIER_COLOR_CLASS[tier] : 'text-celebration'
  const style = !locked && tier === 'bronze' ? { color: BRONZE_COLOR } : undefined
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', colorClass, className)} style={style}>
      <path
        d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4Z"
        fill={locked ? 'none' : 'currentColor'}
        stroke="currentColor"
        strokeWidth={locked ? 1.4 : 0}
        opacity={locked ? 0.6 : 0.9}
      />
      <path d="M7 5H5a2 2 0 0 0 2 4M17 5h2a2 2 0 0 1-2 4" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M10 13.5v2.5H8.5a1 1 0 0 0 0 2h7a1 1 0 0 0 0-2H14v-2.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export interface TrophyCardProps {
  /** null for the collapsed "N new trophies" card. */
  achievement: Achievement | null
  collapsedCount?: number
  /** The individual achievements a collapsed card represents, resolved from
   *  the store's `collapsedDetails` -- shown on hover/focus as a fan-out
   *  (fix round 1, C3). Ignored when `achievement` is non-null. */
  collapsedAchievements?: readonly Achievement[]
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
 * GSAP's). Enters from the side, standing in for "from the shelf position"
 * (spec 7.6) directionally until a real shelf anchor exists to slide from.
 * Always dismissable via the visible close button; `Celebration.tsx`
 * additionally wires Escape at the layer level.
 *
 * Fix round 1, I6: no `role="status"` here -- the celebration layer's one
 * sr-only live region is the sole announcement channel; this card is a
 * silent visual on top of it.
 */
export function TrophyCard({ achievement, collapsedCount, collapsedAchievements, motionPref, onDismiss, onOpenShelf }: TrophyCardProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const isCollapsed = Boolean(collapsedCount && collapsedCount > 0)
  const title = isCollapsed ? `${collapsedCount} new trophies` : achievement?.name ?? 'Trophy unlocked'
  const line = isCollapsed ? 'Go see them.' : achievement ? achievementLine(achievement) : ''

  const entrance = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        // "Enters from the shelf position": a horizontal slide, not the
        // generic drop-from-top every other card round 1 shared.
        initial: { opacity: 0, x: 32, scale: 0.96 },
        animate: { opacity: 1, x: 0, scale: 1 },
        // Fix round 2, I7: exit carries no `ease` -- never `ease-in` on UI,
        // and the shorter duration alone already makes exit faster than enter.
        exit: { opacity: 0, x: 16, scale: 0.98, transition: { duration: EXIT_S } },
        transition: { duration: ENTER_S, ease: ENTER_EASE },
      }

  return (
    <motion.div
      {...entrance}
      className="group pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-rule bg-card p-4 shadow-[0_0_0_1px_var(--glow),0_0_32px_var(--glow)]"
    >
      <TrophyGlyph tier={achievement?.tier} locked={false} className="mt-1" />
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium text-foreground">{title}</p>
        {achievement && <p className="text-micro text-muted-foreground">{TIER_LABEL[achievement.tier]}</p>}
        <p className="mt-1 text-micro text-muted-foreground">{line}</p>
        {isCollapsed && (
          <>
            <button
              type="button"
              onClick={onOpenShelf}
              className="mt-2 text-micro text-primary underline-offset-4 hover:underline"
            >
              Open the shelf
            </button>
            {collapsedAchievements && collapsedAchievements.length > 0 && (
              <div
                data-testid="collapsed-reveal"
                className={cn(
                  'mt-2 flex max-w-0 gap-2 overflow-hidden opacity-0 group-hover:max-w-[240px] group-hover:opacity-100 group-focus-within:max-w-[240px] group-focus-within:opacity-100',
                  // A11Y-13: `max-width` itself never transitions -- it snaps
                  // both open and closed, keyboard-reachable via
                  // `group-focus-within`, not only on hover. Only opacity
                  // animates, and only when the resolved preference allows it.
                  reducedMotion ? 'transition-none' : 'transition-opacity duration-200',
                )}
                aria-hidden="true"
              >
                {collapsedAchievements.map((one) => (
                  <TrophyGlyph key={one.id} tier={one.tier} className="size-4 shrink-0" />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} className="shrink-0">
        <X aria-hidden="true" />
      </Button>
    </motion.div>
  )
}
