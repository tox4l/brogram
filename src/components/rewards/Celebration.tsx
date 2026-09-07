'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { ACHIEVEMENTS, xpToReach, type Achievement, type MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { play } from '@/lib/sound/manager'
import type { SoundEventId } from '@/lib/sound/events'
import { line, lineWith } from '@/lib/voice/lines'
import { DUR, EASE } from '@/lib/motion/tokens'
import {
  clearShownCelebrations, useCelebrationQueue,
  type CelebrationDetail, type CelebrationItem, type CelebrationKind,
} from '@/lib/rewards/useCelebration'
import { Button } from '@/components/ui/button'
import { ConfettiBurst } from './Confetti'
import { LevelBadge } from './LevelBadge'
import { StreakFlame } from './StreakFlame'
import { Sparks } from './Sparks'
import { TrophyCard } from './TrophyCard'

export interface CelebrationProps {
  motionPref?: MotionPreference
  /** The collapsed achievement card's "Open the shelf" action. */
  onOpenShelf?: () => void
  /** The exercise result panel (or wherever a routine pass/best belongs) --
   *  fix round 1, C3(a): a routine pass renders as a compact line anchored
   *  here, not a top-centre notification. Omit on a route with no results
   *  panel (Account, de-rot summary); the minor lane then anchors to the
   *  bottom of the viewport instead. */
  resultsAnchorRef?: RefObject<HTMLElement | null>
}

/** Which of six presentations a kind gets (fix round 1, C3 -- spec 7.6's
 *  motion column, one lane per rarity instead of one pill for all eleven). */
type Tier = 'epic' | 'level-up' | 'achievement' | 'major' | 'minor' | 'silent'

function tierFor(kind: CelebrationKind): Tier {
  switch (kind) {
    case 'first-win':
    case 'course-clear':
      return 'epic'
    case 'level-up':
      return 'level-up'
    case 'achievement':
      return 'achievement'
    case 'clo-close':
    case 'streak-ignite':
    case 'streak-milestone':
      return 'major'
    case 'pass':
    case 'best':
      return 'minor'
    case 'chain':
    case 'goal':
      return 'silent'
  }
}

/**
 * Fired exactly once per item, ever, for the tab's lifetime (fix round 1,
 * C1). Module-level rather than a per-mount ref: `<Celebration />` remounts
 * on every route change, and an item's sound/haptic/confetti must never
 * replay just because the layer that renders it did.
 */
const firedIds = new Set<string>()

/** Pass and level-up only (brief step 7) -- a bonus layer, feature-detected,
 *  and never the only channel for anything (every fired item also plays a
 *  sound and renders text). */
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
 * Every kind's copy comes from `src/lib/voice/lines.ts` (fix round 1, I1;
 * the achievement bar is data, not the bank: an unlock's own `.line` from
 * `ACHIEVEMENTS`, and the collapsed "N new trophies" card, which has no
 * bank key yet -- flagged for T2.7b in the report). `item.id` is used as
 * the rotation seed: deterministic per celebration instance (stable across
 * an unrelated re-render, and safe to assert against in tests), while still
 * varying across different instances, which is what "rotating" means here.
 */
function textFor(item: CelebrationItem): string {
  const { kind, detail, collapsedCount, id: seed } = item
  switch (kind) {
    case 'first-win': return line('pass.first', seed)
    case 'pass': return line('pass', seed)
    case 'chain': return lineWith('chain.tick', { n: detail.n ?? 1 }, seed)
    case 'clo-close': return lineWith('clo.close', { skill: detail.skill ?? 'That skill' }, seed)
    case 'course-clear': return line('course.clear', seed)
    case 'level-up': return lineWith('level.up', { n: detail.level ?? 1 }, seed)
    case 'streak-ignite': return lineWith('streak.keep', { n: detail.n ?? 1 }, seed)
    case 'streak-milestone': return lineWith('streak.milestone', { n: detail.n ?? 0 }, seed)
    case 'best': return lineWith('best', { n: detail.n ?? 0 }, seed)
    case 'achievement': {
      if (collapsedCount) return `${collapsedCount} new trophies. Go see them.`
      return achievementRecord(detail.skill)?.line ?? 'Trophy unlocked.'
    }
    case 'goal': return line('goal.done', seed)
    default: return ''
  }
}

/**
 * The one celebration layer T2.2 (exercise pass path), T2.3 (Progress and
 * Account), and T2.9a/T2.9b (de-rot runs) mount. Reads the shared queue,
 * shows exactly one item at a time in a presentation scaled to its rarity
 * (fix round 1, C3), and is dismissable by mouse, by a visible close
 * button, or by Escape from the keyboard (any key, for the full-viewport
 * epic tier).
 */
export function Celebration({ motionPref, onOpenShelf, resultsAnchorRef }: CelebrationProps) {
  const reducedMotion = useReducedMotion(motionPref)
  const { queue, current, dismiss } = useCelebrationQueue()
  const shownIdsRef = useRef<Set<string>>(new Set())

  // Fix round 1, C1 + I4a: fire sound/haptic exactly once per item, decoupled
  // from card visibility. Keyed off the FULL queue (every item that
  // currently exists), not `current` -- an item preempted by something
  // higher-priority and later restored to the front only ever appears in
  // `queue` once, at the moment it was enqueued, so `firedIds` (module
  // level, see above) makes replay structurally impossible rather than
  // merely unlikely. This also lands the sound at the moment of the event
  // instead of whenever its card finally reaches the front (I4a) -- a card
  // queued behind two others still sounds on time. This is a plain module
  // mutation plus imperative calls, never a React `setState`, so it stays
  // clear of the "no synchronous setState in an effect" rule.
  useEffect(() => {
    for (const item of queue) {
      if (firedIds.has(item.id)) continue
      firedIds.add(item.id)
      for (const soundId of soundsFor(item.kind)) play(soundId)
      if (HAPTIC_KINDS.has(item.kind)) buzz(item.kind === 'level-up' ? [20, 40, 20] : 15)
    }
  }, [queue])

  // Confetti (I4a) is a plain derivation from `queue`, not state: the item
  // that earned it stays findable in `queue` for its whole lifetime, and
  // `<ConfettiBurst>` (mounted unconditionally, C1) already guards "the same
  // trigger id never fires twice" for its own mount lifetime. No effect, no
  // setState, no replay path.
  const confettiTrigger = queue.find((item) => item.confetti)?.id ?? null

  // C2: track every id this MOUNT actually displayed, so its own unmount
  // (a route change) can clear them -- an item that was shown and then
  // abandoned must not be promoted again, with its sound, on the next
  // route's mount. An item queued but never shown is left alone: showing it
  // on the next route is its first showing, not a replay.
  useEffect(() => {
    if (current) shownIdsRef.current.add(current.id)
  }, [current])

  useEffect(() => {
    const shown = shownIdsRef.current
    return () => clearShownCelebrations(shown)
  }, [])

  const tier = current ? tierFor(current.kind) : null

  useEffect(() => {
    if (!current) return
    const id = current.id
    const timer = window.setTimeout(() => dismiss(id), current.lifetimeMs)
    return () => window.clearTimeout(timer)
  }, [current, dismiss])

  useEffect(() => {
    if (!current) return
    const id = current.id
    const isEpic = tier === 'epic'
    function onKeyDown(event: KeyboardEvent): void {
      if (isEpic || event.key === 'Escape') dismiss(id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, dismiss, tier])

  const text = current ? textFor(current) : ''

  return (
    <>
      {/* Fix round 1, I6: the ONE announcement channel for every celebration
          -- every card/component below is inert to assistive tech so a
          streak milestone is announced once, not three times. */}
      <div aria-live="polite" className="sr-only">{text}</div>
      <ConfettiBurst trigger={confettiTrigger} motionPref={motionPref} />
      {current && tier && (
        <AnimatePresence mode="wait">
          <CelebrationPresentation
            key={current.id}
            item={current}
            tier={tier}
            text={text}
            reducedMotion={reducedMotion}
            motionPref={motionPref}
            onDismiss={() => dismiss(current.id)}
            onOpenShelf={onOpenShelf}
            resultsAnchorRef={resultsAnchorRef}
          />
        </AnimatePresence>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * Fix round 1, I7: the timing law's own tokens, not literals -- 700ms in,
 * faster out (exit is always faster than enter). `EASE.enter` is stored as
 * the CSS `cubic-bezier(...)` string every plain-CSS transition in this
 * tree reads (`src/lib/motion/tokens.ts`); Motion's `ease` prop wants the
 * same four numbers as a plain tuple, so they are parsed out of the one
 * source of truth rather than re-typed as a second literal here.
 */
const ENTER_S = DUR.celebration / 1000
const EXIT_S = DUR.base / 1000

function bezierTuple(css: string): [number, number, number, number] {
  const match = /cubic-bezier\(([^)]+)\)/.exec(css)
  const parts = (match?.[1] ?? '0,0,1,1').split(',').map((n) => Number.parseFloat(n.trim()))
  return [parts[0], parts[1], parts[2], parts[3]]
}

const ENTER_EASE = bezierTuple(EASE.enter)

interface CardMotionProps {
  initial: { opacity: number; y: number; scale: number }
  animate: { opacity: number; y: number; scale: number }
  exit: { opacity: number; y: number; scale: number; transition: { duration: number; ease?: 'easeIn' } }
  transition: { duration: number; ease?: readonly [number, number, number, number] }
}

function glowCardEntrance(reducedMotion: boolean): CardMotionProps {
  return reducedMotion
    ? {
        initial: { opacity: 0, y: 0, scale: 1 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 0, scale: 1, transition: { duration: EXIT_S } },
        transition: { duration: 0.15 },
      }
    : {
        initial: { opacity: 0, y: -8, scale: 0.95 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -4, scale: 0.97, transition: { duration: EXIT_S, ease: 'easeIn' } },
        transition: { duration: ENTER_S, ease: ENTER_EASE },
      }
}

function CelebrationPresentation(props: {
  item: CelebrationItem
  tier: Tier
  text: string
  reducedMotion: boolean
  motionPref?: MotionPreference
  onDismiss: () => void
  onOpenShelf?: () => void
  resultsAnchorRef?: RefObject<HTMLElement | null>
}) {
  const { item, tier, text, reducedMotion, motionPref, onDismiss, onOpenShelf, resultsAnchorRef } = props

  switch (tier) {
    case 'silent':
      // (f) chain tick / goal done: the pip or ring already animates in
      // place wherever the host page renders <ChainPips>/<GoalRing> --
      // this layer's job for these two kinds is the sound and the single
      // aria-live announcement above, nothing visual layered on top.
      return null

    case 'epic':
      return <EpicCelebration text={text} reducedMotion={reducedMotion} onDismiss={onDismiss} />

    case 'level-up':
      return <LevelUpCelebration item={item} text={text} reducedMotion={reducedMotion} motionPref={motionPref} onDismiss={onDismiss} />

    case 'achievement': {
      const collapsedAchievements = item.collapsedDetails
        ?.map((detail) => achievementRecord(detail.skill))
        .filter((a): a is Achievement => a !== undefined)
      return (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 sm:top-6 sm:justify-end sm:pr-6">
          <TrophyCard
            achievement={item.collapsedCount ? null : achievementRecord(item.detail.skill) ?? null}
            collapsedCount={item.collapsedCount}
            collapsedAchievements={collapsedAchievements}
            motionPref={motionPref}
            onDismiss={onDismiss}
            onOpenShelf={onOpenShelf}
          />
        </div>
      )
    }

    case 'major':
      return <MajorCelebration item={item} text={text} reducedMotion={reducedMotion} motionPref={motionPref} onDismiss={onDismiss} />

    case 'minor':
      return <MinorCelebration text={text} reducedMotion={reducedMotion} onDismiss={onDismiss} anchorRef={resultsAnchorRef} />

    default:
      return null
  }
}

/** (b) First-ever win and course cleared: a full-viewport moment -- dimmed
 *  backdrop, large type, the confetti burst already timed with the reveal
 *  (fired at enqueue, see the queue-watching effect above), dismissed by
 *  any key or a click anywhere. */
interface ScaleMotionProps {
  initial: { opacity: number; scale: number }
  animate: { opacity: number; scale: number }
  exit: { opacity: number; scale: number; transition: { duration: number; ease?: 'easeIn' } }
  transition: { duration: number; ease?: readonly [number, number, number, number] }
}

function EpicCelebration({ text, reducedMotion, onDismiss }: { text: string; reducedMotion: boolean; onDismiss: () => void }) {
  const entrance: ScaleMotionProps = reducedMotion
    ? {
        initial: { opacity: 0, scale: 1 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 1, transition: { duration: EXIT_S } },
        transition: { duration: 0.15 },
      }
    : {
        initial: { opacity: 0, scale: 0.96 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.98, transition: { duration: EXIT_S, ease: 'easeIn' } },
        transition: { duration: ENTER_S, ease: ENTER_EASE },
      }
  return (
    <motion.button
      type="button"
      onClick={onDismiss}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: EXIT_S } }}
      transition={{ duration: ENTER_S }}
      className="pointer-events-auto fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-background/85 backdrop-blur-sm"
      aria-label="Dismiss celebration"
    >
      <motion.p {...entrance} className="max-w-xl px-6 text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {text}
      </motion.p>
    </motion.button>
  )
}

/** (c) Level up: the badge grows in place with a `--glow` edge and the XP
 *  bar refills from the old level's fraction to the new one, stepping
 *  through every crossed level in sequence, with sparks along the bar. */
function LevelUpCelebration({
  item, text, reducedMotion, motionPref, onDismiss,
}: { item: CelebrationItem; text: string; reducedMotion: boolean; motionPref?: MotionPreference; onDismiss: () => void }) {
  const entrance = glowCardEntrance(reducedMotion)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-50 flex justify-center px-4">
      <motion.div
        {...entrance}
        className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-8 py-6 text-center shadow-[0_0_0_1px_var(--glow),0_0_56px_var(--glow)]"
      >
        <LevelBadge level={item.detail.level ?? 1} animateEntrance motionPref={motionPref} className="text-base" />
        <LevelUpXpBar detail={item.detail} reducedMotion={reducedMotion} />
        <p className="text-sm font-medium text-foreground">{text}</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} className="absolute right-2 top-2">
          <X aria-hidden="true" />
        </Button>
      </motion.div>
    </div>
  )
}

function LevelUpXpBar({ detail, reducedMotion }: { detail: CelebrationDetail; reducedMotion: boolean }) {
  const barRef = useRef<HTMLDivElement>(null)
  const finalLevel = detail.level ?? 1
  const levelsUp = Math.max(1, detail.n ?? 1)
  const startLevel = Math.max(1, finalLevel - levelsUp + 1)
  const hasXp = detail.fromXp !== undefined && detail.toXp !== undefined

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    if (reducedMotion || !hasXp) {
      el.style.transform = 'scaleX(1)'
      return
    }
    const fromXp = detail.fromXp as number
    const toXp = detail.toXp as number

    let cancelled = false
    void import('gsap').then(({ gsap }) => {
      if (cancelled || !el) return
      gsap.killTweensOf(el)
      const startFrom = xpToReach(startLevel)
      const startTo = xpToReach(startLevel + 1)
      const startFrac = startTo > startFrom ? Math.max(0, Math.min(1, (fromXp - startFrom) / (startTo - startFrom))) : 0
      gsap.set(el, { scaleX: startFrac, transformOrigin: 'left' })
      const timeline = gsap.timeline()
      for (let level = startLevel; level <= finalLevel; level += 1) {
        const bandFrom = xpToReach(level)
        const bandTo = xpToReach(level + 1)
        const isLast = level === finalLevel
        const endFrac = isLast
          ? bandTo > bandFrom ? Math.max(0, Math.min(1, (toXp - bandFrom) / (bandTo - bandFrom))) : 1
          : 1
        timeline.to(el, { scaleX: endFrac, duration: 0.4, ease: 'power2.out' })
        if (!isLast) timeline.set(el, { scaleX: 0 })
      }
    })
    return () => {
      cancelled = true
    }
  }, [detail.fromXp, detail.toXp, finalLevel, startLevel, hasXp, reducedMotion])

  return (
    <div className="flex w-40 flex-col items-center gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div ref={barRef} className="h-full w-full origin-left rounded-full bg-celebration" style={{ transform: 'scaleX(0)' }} />
      </div>
      {!reducedMotion && <Sparks trigger={`${startLevel}-${finalLevel}`} motionPref={undefined} count={4} />}
    </div>
  )
}

/** (a) Skill locked / streak ignite / streak milestone: a centred card with
 *  the `--glow` edge spec 7.6 asks for by name, one size step below the
 *  epic/level-up moments. */
function MajorCelebration({
  item, text, reducedMotion, motionPref, onDismiss,
}: { item: CelebrationItem; text: string; reducedMotion: boolean; motionPref?: MotionPreference; onDismiss: () => void }) {
  const entrance = glowCardEntrance(reducedMotion)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/4 z-50 flex justify-center px-4">
      <motion.div
        {...entrance}
        className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-[0_0_0_1px_var(--glow),0_0_40px_var(--glow)]"
      >
        {(item.kind === 'streak-ignite' || item.kind === 'streak-milestone') && (
          <StreakFlame
            state={item.kind === 'streak-milestone' ? 'milestone' : 'ignite'}
            days={item.detail.n ?? 0}
            motionPref={motionPref}
            announce={false}
          />
        )}
        <p className="text-sm font-semibold text-foreground">{text}</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} className="ml-1 shrink-0">
          <X aria-hidden="true" />
        </Button>
      </motion.div>
    </div>
  )
}

/** (a) Routine pass / personal best: a compact chip anchored near the
 *  results panel (fix round 1, C3) instead of the shared top-centre slot
 *  every kind used to own -- it never competes with the rare-event lanes
 *  above, and never sits over the shell header (fix round 1, M9). */
function MinorCelebration({
  text, reducedMotion, onDismiss, anchorRef,
}: { text: string; reducedMotion: boolean; onDismiss: () => void; anchorRef?: RefObject<HTMLElement | null> }) {
  const style = useAnchoredStyle(anchorRef)
  const entrance: CardMotionProps = reducedMotion
    ? {
        initial: { opacity: 0, y: 0, scale: 1 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 0, scale: 1, transition: { duration: EXIT_S } },
        transition: { duration: 0.15 },
      }
    : {
        initial: { opacity: 0, y: 6, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 4, scale: 0.98, transition: { duration: EXIT_S, ease: 'easeIn' } },
        transition: { duration: ENTER_S, ease: ENTER_EASE },
      }
  return (
    <div className="pointer-events-none fixed z-50" style={style}>
      <motion.div
        {...entrance}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-[var(--elevation-sm)]"
      >
        <p className="font-medium text-foreground">{text}</p>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss} className="shrink-0">
          <X aria-hidden="true" className="size-3" />
        </Button>
      </motion.div>
    </div>
  )
}

/** Anchors the minor lane just below the results panel when one is
 *  provided; falls back to a bottom-centre position that never overlaps
 *  the shell header (fix round 1, M9 named the header collision directly). */
function useAnchoredStyle(anchorRef?: RefObject<HTMLElement | null>): CSSProperties {
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const el = anchorRef?.current
    if (!el) {
      setRect(null)
      return
    }
    function update() {
      const box = el!.getBoundingClientRect()
      setRect({ top: box.bottom + 8, left: box.left })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchorRef])

  return useMemo<CSSProperties>(
    () => (rect ? { top: rect.top, left: rect.left } : { bottom: 24, left: '50%', transform: 'translateX(-50%)' }),
    [rect],
  )
}
