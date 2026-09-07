'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { ACHIEVEMENTS, type Achievement, type MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { play } from '@/lib/sound/manager'
import type { SoundEventId } from '@/lib/sound/events'
import { levelBand } from '@/lib/rewards/goal'
import { useCelebrationQueue, type CelebrationDetail, type CelebrationItem, type CelebrationKind } from '@/lib/rewards/useCelebration'
import { Button } from '@/components/ui/button'
import { ConfettiBurst } from './Confetti'
import { LevelBadge } from './LevelBadge'
import { StreakFlame } from './StreakFlame'
import { TrophyCard } from './TrophyCard'

export interface CelebrationProps {
  motionPref?: MotionPreference
  /** The collapsed achievement card's "Open the shelf" action. */
  onOpenShelf?: () => void
}

/**
 * Auto-dismiss budget per kind (spec 7.6's "2.5s, dismissable" for a trophy
 * card, generalised for every other kind). `level-up` is 0 -- "level-up is
 * always dismissable" (brief step 1) reads as a deliberate exception: it
 * never times out on its own, only the visible close button or Escape ends
 * it, so a rare, important moment cannot be missed by looking away for a
 * second.
 */
const AUTO_DISMISS_MS: Partial<Record<CelebrationKind, number>> = {
  'first-win': 3200,
  pass: 1400,
  chain: 1200,
  'clo-close': 2600,
  'course-clear': 3000,
  'streak-ignite': 2200,
  'streak-milestone': 2800,
  best: 1400,
  achievement: 2500,
  goal: 2200,
}

/** Pass and level-up only (brief step 7) -- a bonus layer, feature-detected,
 *  and never the only channel for anything (every call site here also plays
 *  a sound and renders text). */
const HAPTIC_KINDS = new Set<CelebrationKind>(['pass', 'level-up'])

function buzz(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Bonus layer only -- never load-bearing.
  }
}

function achievementRecord(id?: string): Achievement | undefined {
  return id ? ACHIEVEMENTS.find((a) => a.id === id) : undefined
}

const FIRST_WIN_LINE = achievementRecord('first-blood')?.line ?? 'First one down.'
const COURSE_CLEAR_LINE = achievementRecord('course-clear')?.line ?? 'Course cleared.'

/**
 * Every row of spec 7.6 that carries a sound, mapped to the `SoundEventId`
 * it plays. `course-clear` calls two ids on purpose: the manager's own
 * 250ms rank debounce (T0.5) is what actually produces "layered with
 * level.up" (spec 7.6's own phrase) by cutting off the lower-ranked one --
 * this component does not have to reimplement that decision.
 */
function soundsFor(kind: CelebrationKind): SoundEventId[] {
  switch (kind) {
    case 'first-win': return ['first.win']
    case 'pass': return ['pass']
    case 'chain': return ['chain.tick']
    case 'clo-close': return ['clo.close']
    case 'course-clear': return ['clo.close', 'level.up']
    case 'level-up': return ['level.up']
    case 'streak-ignite': return ['streak.light']
    case 'streak-milestone': return ['streak.milestone']
    case 'best': return ['best']
    case 'achievement': return ['best']
    case 'goal': return ['goal.done']
    default: return []
  }
}

/**
 * The visible text every kind renders (never sound without also rendering
 * text -- the acceptance block's own words). `detail.skill` doubles as a
 * CLO/course label on `clo-close` and an achievement id on `achievement`;
 * `detail.n` as a chain count, a streak-day count, or (via `levelUpDetail`)
 * how many levels a single pass crossed.
 */
function textFor(kind: CelebrationKind, detail: CelebrationDetail, collapsedCount?: number): string {
  switch (kind) {
    case 'first-win': return FIRST_WIN_LINE
    case 'pass': return 'Locked in. Keep going.'
    case 'chain': return detail.n ? `Chain ×${detail.n}.` : 'Chain building.'
    case 'clo-close': return detail.skill ? `${detail.skill} locked.` : 'Skill locked.'
    case 'course-clear': return COURSE_CLEAR_LINE
    case 'level-up': {
      const level = detail.level ?? 1
      const jump = detail.n && detail.n > 1 ? ` ${detail.n} levels at once.` : ''
      return `Level ${level}. ${levelBand(level)}.${jump}`
    }
    case 'streak-ignite': return `Day ${detail.n ?? 1}. Same time tomorrow.`
    case 'streak-milestone': return `${detail.n ?? 0} days. That is not luck.`
    case 'best': return 'New personal best.'
    case 'achievement': {
      if (collapsedCount) return `${collapsedCount} new trophies. Go see them.`
      return achievementRecord(detail.skill)?.line ?? 'Trophy unlocked.'
    }
    case 'goal': return 'Goal met. That is the day, right there.'
    default: return ''
  }
}

const MINOR_KINDS = new Set<CelebrationKind>(['pass', 'chain', 'best'])

/**
 * The one celebration layer T2.2 (exercise pass path), T2.3 (Progress and
 * Account), and T2.9a/T2.9b (de-rot runs) mount. Reads the shared queue
 * (`useCelebrationQueue`), shows exactly one item at a time, plays its
 * sound and (for pass/level-up) a haptic buzz once per item, fires confetti
 * only when the queue decided this item earned it, and is dismissable by
 * mouse, by a visible close button, or by Escape from the keyboard.
 */
export function Celebration({ motionPref, onOpenShelf }: CelebrationProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const { current, dismiss } = useCelebrationQueue()

  // Fire the side effects (sound, haptics) exactly once per item -- keyed by
  // `current?.id` in the dependency array rather than a manual "already
  // played" ref, so this never double-fires across a re-render that leaves
  // `current` referentially unchanged.
  useEffect(() => {
    if (!current) return
    for (const soundId of soundsFor(current.kind)) play(soundId)
    if (HAPTIC_KINDS.has(current.kind)) buzz(current.kind === 'level-up' ? [20, 40, 20] : 15)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    if (!current) return
    const timeout = AUTO_DISMISS_MS[current.kind]
    if (!timeout) return // level-up: never auto-dismisses (brief step 1).
    const id = current.id
    const timer = window.setTimeout(() => dismiss(id), timeout)
    return () => window.clearTimeout(timer)
  }, [current, dismiss])

  useEffect(() => {
    if (!current) return
    const id = current.id
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') dismiss(id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, dismiss])

  const text = current ? textFor(current.kind, current.detail, current.collapsedCount) : ''

  return (
    <>
      {/* Announced through aria-live with the text, never by motion alone. */}
      <div aria-live="polite" role="status" className="sr-only">{text}</div>
      {current?.confetti && <ConfettiBurst trigger={current.id} motionPref={motionPref} />}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 sm:top-6">
        <AnimatePresence mode="wait">
          {current && (
            <CelebrationCard
              key={current.id}
              item={current}
              text={text}
              reducedMotion={reducedMotion}
              motionPref={motionPref}
              onDismiss={() => dismiss(current.id)}
              onOpenShelf={onOpenShelf}
            />
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

function CelebrationCard({
  item, text, reducedMotion, motionPref, onDismiss, onOpenShelf,
}: {
  item: CelebrationItem
  text: string
  reducedMotion: boolean
  motionPref?: MotionPreference
  onDismiss: () => void
  onOpenShelf?: () => void
}) {
  if (item.kind === 'achievement') {
    return (
      <TrophyCard
        achievement={item.collapsedCount ? null : achievementRecord(item.detail.skill) ?? null}
        collapsedCount={item.collapsedCount}
        motionPref={motionPref}
        onDismiss={onDismiss}
        onOpenShelf={onOpenShelf}
      />
    )
  }

  const minor = MINOR_KINDS.has(item.kind)
  const entrance = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, y: -8, scale: 0.95 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -4, scale: 0.97 },
        transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
      }

  return (
    <motion.div
      {...entrance}
      role="status"
      className={
        minor
          ? 'pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-[var(--elevation-sm)]'
          : 'pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-[var(--elevation-lg)]'
      }
    >
      {item.kind === 'level-up' && <LevelBadge level={item.detail.level ?? 1} animateEntrance motionPref={motionPref} />}
      {(item.kind === 'streak-ignite' || item.kind === 'streak-milestone') && (
        <StreakFlame
          state={item.kind === 'streak-milestone' ? 'milestone' : 'ignite'}
          days={item.detail.n ?? 0}
          motionPref={motionPref}
        />
      )}
      <p className={minor ? 'text-sm font-medium text-foreground' : 'text-sm font-semibold text-foreground'}>{text}</p>
      <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} className="ml-1 shrink-0">
        <X aria-hidden="true" />
      </Button>
    </motion.div>
  )
}
