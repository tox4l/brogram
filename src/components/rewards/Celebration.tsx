'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { ACHIEVEMENTS, xpToReach, type Achievement, type MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { play } from '@/lib/sound/manager'
import type { SoundEventId } from '@/lib/sound/events'
import { line, lineWith } from '@/lib/voice/lines'
import {
  clearShownCelebrations, markConfettiFired, markSoundFired, useCelebrationQueue,
  type CelebrationDetail, type CelebrationItem, type CelebrationKind,
} from '@/lib/rewards/useCelebration'
import { Button } from '@/components/ui/button'
import { fireConfetti } from './Confetti'
import { LevelBadge } from './LevelBadge'
import { StreakFlame } from './StreakFlame'
import { Sparks } from './Sparks'
import { TrophyCard, achievementLine } from './TrophyCard'
import { ENTER_EASE, ENTER_S, EXIT_S } from './motionTokens'

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
 * the achievement bar is data, not the bank, routed through
 * `achievementLine()` -- fix round 2, I1 -- so `first-blood`'s frozen
 * `contracts.ts` line never ships verbatim. The collapsed "N new trophies"
 * announcement is `achievement.collapsed` (T2.7b) -- TrophyCard's own
 * visible title/line stay literal, byte-identical to this key's text and
 * already pinned by rewards.test.tsx). `item.id` is
 * used as the rotation seed: deterministic per celebration instance (stable
 * across an unrelated re-render, and safe to assert against in tests),
 * while still varying across different instances, which is what "rotating"
 * means here.
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
      if (collapsedCount) return lineWith('achievement.collapsed', { n: collapsedCount }, seed)
      const record = achievementRecord(detail.skill)
      return record ? achievementLine(record) : 'Trophy unlocked.'
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

  // Fix round 1, C1 + I4a; fix round 2, C1: fire sound/haptic/confetti
  // exactly once per item, decoupled from card visibility, and tracked in
  // the STORE (`markSoundFired`/`markConfettiFired`) rather than a
  // component-level tracker -- `<Celebration />` remounts on every route
  // change, and an item queued but never shown deliberately survives a
  // route change (see `clearShownCelebrations`'s doc comment), so it is
  // still live when the next route mounts a fresh layer. A component-level
  // guard (a `useRef`, or round 1's mounted-`<ConfettiBurst>` trick) resets
  // exactly then; the store-level guard cannot, because it was never tied
  // to any one mount. Keyed off the FULL queue (every item that currently
  // exists), not `current`, so a card queued behind two others still
  // sounds/bursts on time (I4a) instead of whenever it reaches the front.
  useEffect(() => {
    for (const item of queue) {
      if (markSoundFired(item.id)) {
        for (const soundId of soundsFor(item.kind)) play(soundId)
        // A11Y-10: gated on the motion preference this component already
        // resolves -- the sound-mute half of this fix needs a reader
        // exported from src/lib/sound/manager.ts (outside this lane's owned
        // paths; see the report's recipe for that export).
        if (!reducedMotion && HAPTIC_KINDS.has(item.kind)) buzz(item.kind === 'level-up' ? [20, 40, 20] : 15)
      }
      if (item.confetti && markConfettiFired(item.id)) {
        fireConfetti(reducedMotion)
      }
    }
  }, [queue, reducedMotion])

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
      {/* Fix round 2, I7 regression: AnimatePresence must wrap the
          conditional, not sit inside it -- nested inside `current && tier`,
          React unmounts AnimatePresence together with its child the moment
          the queue empties (every ordinary auto-dismiss and every
          close-button click on the last card), so no exit ever played. */}
      <AnimatePresence mode="wait">
        {current && tier && (
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
        )}
      </AnimatePresence>
    </>
  )
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

interface CardMotionProps {
  initial: { opacity: number; y: number; scale: number }
  animate: { opacity: number; y: number; scale: number }
  exit: { opacity: number; y: number; scale: number; transition: { duration: number } }
  transition: { duration: number; ease?: readonly [number, number, number, number] }
}

/**
 * Fix round 2, I7 regression: exits never set `ease` -- "Never `ease-in` on
 * UI" (spec line 1039) is an explicit ban, and duration alone (`EXIT_S` <
 * `ENTER_S`) already satisfies "exit is always faster than enter."
 */
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
        exit: { opacity: 0, y: -4, scale: 0.97, transition: { duration: EXIT_S } },
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
        // Fix round 2: anchored below the shell header instead of `top-4`
        // sitting directly over it (the achievement lane was the one tier
        // M9's fix round 1 pass missed).
        <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4 sm:top-24 sm:justify-end sm:pr-6">
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

/**
 * (b) First-ever win and course cleared: a full-viewport moment -- dimmed
 * backdrop, large type, the confetti burst already timed with the reveal
 * (fired at enqueue, see the queue-watching effect above), dismissed by any
 * key or a click anywhere.
 *
 * Small round 3: on the exercise route, an 85%-opacity `--background` scrim
 * behind bare `text-foreground` type was not enough over a busy syntax-
 * highlighted editor and results panel -- code's own high local colour
 * contrast bled through the blur, and the line read as an oversized wash
 * rather than a moment (it read fine on the plain preview page, which has
 * nothing but flat background behind it). Two independent fixes, not one:
 * the scrim dims to the spec's 40-60% band (a moment, not a full block --
 * `LOCKDOWN`'s idle guard is the 85% cover, and that is a different
 * register entirely, R9.6), and the text now sits on its own fully opaque
 * `.celebration-plate` (`--celebration`/`--celebration-foreground`, the one
 * token pair T0.6 guarantees contrast for) -- legibility no longer depends
 * on how much of the workspace shows through the scrim at all. The line
 * itself is `clamp()`-sized to the viewport with a hard cap so it can never
 * grow past a comfortable reading size, and the plate is capped at
 * `min(90vw, 42rem)` with generous padding so it always sits inside the
 * safe area instead of touching the viewport edges.
 *
 * Fix round 2 minor: a plain `div[role="presentation"]` instead of a
 * `<motion.button>` wrapping a `<motion.p>` -- a `<p>` is not phrasing
 * content, and a full-screen focusable control sitting in the tab order
 * for ~2.8s bought nothing the existing key handler did not already cover.
 */
interface ScaleMotionProps {
  initial: { opacity: number; scale: number }
  animate: { opacity: number; scale: number }
  exit: { opacity: number; scale: number; transition: { duration: number } }
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
        exit: { opacity: 0, scale: 0.98, transition: { duration: EXIT_S } },
        transition: { duration: ENTER_S, ease: ENTER_EASE },
      }
  return (
    <motion.div
      role="presentation"
      onClick={onDismiss}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: EXIT_S } }}
      transition={{ duration: ENTER_S }}
      // 50%, inside the spec's 40-60% band for a full-viewport MOMENT --
      // never the 85% `LOCKDOWN` reserves for an enforcement cover (R9.6:
      // different register entirely). The plate below is what actually
      // guarantees legibility; the scrim only has to read as "dimmed."
      className="pointer-events-auto fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-background/50 p-6 backdrop-blur-md"
    >
      <motion.div
        {...entrance}
        className="celebration-plate max-w-[min(90vw,42rem)] rounded-3xl bg-celebration px-8 py-7 shadow-[0_0_0_1px_var(--glow),0_24px_64px_rgba(0,0,0,0.35)]"
      >
        <p
          className="text-center font-semibold leading-tight tracking-tight text-celebration-foreground"
          style={{ fontSize: 'clamp(1.375rem, 4vw, 2.5rem)' }}
        >
          {text}
        </p>
      </motion.div>
    </motion.div>
  )
}

/**
 * A theme-portable rarity accent, layered under `--glow`'s own box-shadow
 * (fix round 2, Defect B): `--glow` is a near-invisible 18%-alpha dark blue
 * on Paper's near-white card (`globals.css:314`), leaving the level-up and
 * major cards with no rarity signal at all on that theme. `--celebration`
 * is a saturated, always-legible accent in every theme (it is what the
 * glyphs and the goal ring already use), so a 2px border in that colour
 * reads on all four themes regardless of whether the glow itself renders.
 */
const RARITY_BORDER = 'border-2 border-celebration'

/** (c) Level up: the badge grows in place with a `--glow`/`--celebration`
 *  edge and the XP bar refills from the old level's fraction to the new
 *  one, stepping through every crossed level in sequence, with sparks
 *  along the bar. */
function LevelUpCelebration({
  item, text, reducedMotion, motionPref, onDismiss,
}: { item: CelebrationItem; text: string; reducedMotion: boolean; motionPref?: MotionPreference; onDismiss: () => void }) {
  const entrance = glowCardEntrance(reducedMotion)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-50 flex justify-center px-4">
      <motion.div
        {...entrance}
        className={`relative pointer-events-auto flex flex-col items-center gap-3 rounded-2xl ${RARITY_BORDER} bg-card px-8 py-6 text-center shadow-[0_0_0_1px_var(--glow),0_0_56px_var(--glow)]`}
      >
        <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} className="absolute right-2 top-2">
          <X aria-hidden="true" />
        </Button>
        <span className="text-5xl font-semibold tabular text-foreground">{item.detail.level ?? 1}</span>
        <LevelBadge level={item.detail.level ?? 1} animateEntrance motionPref={motionPref} className="text-base" />
        <LevelUpXpBar detail={item.detail} reducedMotion={reducedMotion} />
        <p className="text-sm font-medium text-foreground">{text}</p>
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

  // Fix round 2, GSAP discipline: this used to run a `gsap.timeline()` from
  // a bare `useEffect` with its own dynamic `import('gsap')`, with no kill
  // on cleanup -- dismissing a level-up mid-refill left a timeline ticking
  // against a detached node, and `gsap` is already statically imported by
  // every sibling in this file. `useGSAP` owns the timeline now, so a
  // route change or a re-run mid-tween reverts it automatically.
  useGSAP(() => {
    const el = barRef.current
    if (!el) return
    gsap.killTweensOf(el)
    if (reducedMotion || !hasXp) {
      gsap.set(el, { scaleX: 1, transformOrigin: 'left' })
      return
    }
    const fromXp = detail.fromXp as number
    const toXp = detail.toXp as number
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
  }, [detail.fromXp, detail.toXp, finalLevel, startLevel, hasXp, reducedMotion])

  return (
    <div className="flex w-48 flex-col items-center gap-1.5">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div ref={barRef} className="h-full w-full origin-left rounded-full bg-celebration" style={{ transform: 'scaleX(0)' }} />
      </div>
      {!reducedMotion && <Sparks trigger={`${startLevel}-${finalLevel}`} count={4} />}
    </div>
  )
}

/** Simple hand-drawn padlock (brief: CSS/inline SVG, no emoji) -- the "skill
 *  locked" moment's hero glyph, standing in for the path-map node fill
 *  (spec 7.6) at the scale this overlay can show. */
function LockGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M7 10.5V7.5a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" />
      <path d="M12 16.6v1.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * (a)/(d) Skill locked / streak ignite / streak milestone: a vertical
 * composed card with the flame or the lock as the hero element and the
 * line beneath it (fix round 2, presentation finding -- both used to be a
 * single horizontal toast row: a 20px glyph, the sentence, and an X, which
 * read as a notification regardless of the glow edge). The rarity border
 * (`RARITY_BORDER`) plus `--glow` together carry the signal on every theme.
 */
function MajorCelebration({
  item, text, reducedMotion, motionPref, onDismiss,
}: { item: CelebrationItem; text: string; reducedMotion: boolean; motionPref?: MotionPreference; onDismiss: () => void }) {
  const entrance = glowCardEntrance(reducedMotion)
  const isStreak = item.kind === 'streak-ignite' || item.kind === 'streak-milestone'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/4 z-50 flex justify-center px-4">
      <motion.div
        {...entrance}
        className={`relative pointer-events-auto flex w-72 flex-col items-center gap-3 rounded-2xl ${RARITY_BORDER} bg-card px-6 py-6 text-center shadow-[0_0_0_1px_var(--glow),0_0_40px_var(--glow)]`}
      >
        <Button type="button" variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss} className="absolute right-2 top-2">
          <X aria-hidden="true" />
        </Button>
        {isStreak ? (
          <StreakFlame
            state={item.kind === 'streak-milestone' ? 'milestone' : 'ignite'}
            days={item.detail.n ?? 0}
            motionPref={motionPref}
            announce={false}
            size="hero"
          />
        ) : (
          <LockGlyph className="size-10 text-celebration" />
        )}
        <p className="text-sm font-semibold text-foreground">{text}</p>
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
        exit: { opacity: 0, y: 4, scale: 0.98, transition: { duration: EXIT_S } },
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

/**
 * Anchors the minor lane just below the results panel when one is
 * provided; falls back to a bottom-centre position that never overlaps the
 * shell header (fix round 1, M9). Fix round 2: measured in a **layout**
 * effect, synchronously before the browser paints, instead of a plain
 * effect -- a plain `useEffect` runs after paint, so the chip visibly
 * rendered at the bottom-centre fallback for one frame and then jumped to
 * the anchor. A `scroll` listener keeps it attached to the panel if the
 * learner scrolls during the chip's ~1.5s lifetime.
 */
function useAnchoredStyle(anchorRef?: RefObject<HTMLElement | null>): CSSProperties {
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
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
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef])

  return rect ? { top: rect.top, left: rect.left } : { bottom: 24, left: '50%', transform: 'translateX(-50%)' }
}
