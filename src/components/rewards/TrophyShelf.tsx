'use client'

import { motion } from 'motion/react'
import { ACHIEVEMENTS, type MotionPreference } from '@/lib/contracts'
import { useAchievements } from '@/lib/query/hooks'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { STAGGER } from '@/lib/motion/tokens'
import { TrophyGlyph } from './TrophyCard'
import { cn } from '@/lib/utils'

export interface TrophyShelfProps {
  motionPref?: MotionPreference
  /** Achievement ids unlocked earlier in THIS session -- these get the
   *  one-time entrance flourish (spec 10.10); every other unlocked trophy
   *  just sits still with its date. */
  unlockedThisSession?: readonly string[]
}

function formatUnlockedDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unlocked'
  return `Unlocked ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/**
 * The trophy shelf (spec 10.10): all twenty achievements, always in ordinal
 * order, unlocked ones lit with their date and locked ones showing exactly
 * what earns them -- "nothing is a mystery box" (spec 7.5), so `how` is
 * never hidden behind a locked state.
 *
 * `user_achievements` (migration 0007) is not applied in production yet
 * (T0.4), so this renders honestly off whatever `useAchievements()` hands
 * back: pending or errored both read as "nothing unlocked yet" rather than
 * crashing or lying about progress -- the twenty locked cards, each stating
 * its own rule, are already an honest and useful shelf on their own.
 */
export function TrophyShelf({ motionPref, unlockedThisSession }: TrophyShelfProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const query = useAchievements()
  const unlockedMap = new Map((query.data ?? []).map((row) => [row.achievementId, row.unlockedAt]))
  const sorted = [...ACHIEVEMENTS].sort((a, b) => a.ordinal - b.ordinal)
  const showEmpty = unlockedMap.size === 0 && !query.isPending

  return (
    <div className="space-y-3">
      {query.isError && (
        <p role="status" className="text-xs text-muted-foreground">
          Trophies could not load right now. Showing what is available to earn.
        </p>
      )}
      {showEmpty && <p className="text-sm text-muted-foreground">Nothing on the shelf yet. First pass puts something here.</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((achievement, index) => {
          const unlockedAt = unlockedMap.get(achievement.id)
          const isUnlocked = unlockedAt !== undefined
          const freshUnlock = isUnlocked && (unlockedThisSession?.includes(achievement.id) ?? false)
          const delay = reducedMotion ? 0 : Math.min(index * STAGGER.step, STAGGER.max) / 1000

          return (
            <motion.li
              key={achievement.id}
              initial={reducedMotion ? undefined : { opacity: 0, y: 6 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              transition={reducedMotion ? undefined : { delay, duration: 0.2 }}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center',
                isUnlocked ? 'border-border bg-card' : 'border-dashed border-input opacity-70',
              )}
            >
              <motion.span
                animate={!reducedMotion && freshUnlock ? { scale: [1, 1.15, 1] } : undefined}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <TrophyGlyph tier={achievement.tier} locked={!isUnlocked} className="size-7" />
              </motion.span>
              <p className="text-xs font-medium text-foreground">{achievement.name}</p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {isUnlocked ? formatUnlockedDate(unlockedAt) : achievement.how}
              </p>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}
