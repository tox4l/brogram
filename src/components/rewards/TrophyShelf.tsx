'use client'

import { motion } from 'motion/react'
import { ACHIEVEMENTS, type MotionPreference } from '@/lib/contracts'
import { useAchievements } from '@/lib/query/hooks'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { STAGGER } from '@/lib/motion/tokens'
import { line } from '@/lib/voice/lines'
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
  // visibleWhenLocked (fix round 1, M4): every shipped achievement sets this
  // true today, but the flag exists so a future secret unlock is not spoiled
  // by a shelf that shows every row regardless.
  const sorted = [...ACHIEVEMENTS]
    .filter((achievement) => achievement.visibleWhenLocked || unlockedMap.has(achievement.id))
    .sort((a, b) => a.ordinal - b.ordinal)
  // Fix round 1, I5: an error and "nothing unlocked" must never render at
  // the same time -- a learner with real unlocks behind a 404'd query was
  // being told their shelf was empty underneath the line saying it failed
  // to load. One honest state per situation, not two stacked.
  const showEmpty = !query.isPending && !query.isError && unlockedMap.size === 0

  return (
    <div className="space-y-3">
      {query.isError && <p className="text-micro text-muted-foreground">{line('error.load')}</p>}
      {showEmpty && <p className="text-small text-muted-foreground">{line('empty.trophies')}</p>}
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
                'flex flex-col items-center gap-2 rounded-xl border p-3 text-center',
                // W4 spec section 8 ("never a dashed box") / section 9's
                // repeated "the dashed borders go": a locked trophy is a
                // designed, quieter fill on the same --rule edge, not a
                // dashed placeholder.
                // Fix round (review T48-5): `bg-muted/50` at 50% resolved to
                // the same lightness as `bg-card` in four of five palettes
                // (Arcade: identical) -- full-alpha `bg-muted` is a real,
                // separated step from `bg-card` in every palette.
                isUnlocked ? 'border-rule bg-card' : 'border-rule bg-muted',
              )}
            >
              <motion.span
                animate={!reducedMotion && freshUnlock ? { scale: [1, 1.15, 1] } : undefined}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <TrophyGlyph tier={achievement.tier} locked={!isUnlocked} className="size-7" />
              </motion.span>
              <p className="text-micro font-medium text-foreground">{achievement.name}</p>
              <p className="text-micro leading-snug text-muted-foreground">
                {isUnlocked ? formatUnlockedDate(unlockedAt) : achievement.how}
              </p>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}
