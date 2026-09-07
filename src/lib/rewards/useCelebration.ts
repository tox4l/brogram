'use client'

/**
 * The one entry point every celebration-firing call site uses (T2.2's pass
 * path, T2.3's Progress/Account trophy shelf, T2.9a/T2.9b's de-rot runs):
 * `celebrate(kind, detail)` enqueues an event; `<Celebration />`
 * (src/components/rewards/Celebration.tsx) is the one place that reads the
 * queue back and renders it. The two are decoupled through a module-level
 * store (the same shape `src/lib/sound/manager.ts` uses) rather than React
 * context, because a call site that fires a celebration (a hook, a mutation
 * `onSuccess`, a game loop) is very often not a descendant of whatever
 * mounts the celebration layer, and does not need to be.
 *
 * Everything a call site never has to think about lives here:
 *  - **priority** (spec 7.6/R7.3's ranking, restated for the visual layer):
 *    a higher-priority event shows before a lower one that arrived first;
 *  - **one at a time**: only the highest-priority, oldest item is "current";
 *  - **the achievement collapse** (brief step 1): a queue of more than two
 *    pending achievement unlocks collapses into one "N new trophies" card
 *    rather than three unlocks at 2.5s each in front of the next rep;
 *  - **the confetti cooldown and eligibility** (brief step 1): confetti is
 *    decided once, at the moment a celebration is queued, against a hard
 *    1200ms cooldown -- never re-decided at render/dequeue time, so "two
 *    celebrations inside 1200ms produce one confetti" holds regardless of
 *    when the UI actually gets around to showing them.
 */

import { useSyncExternalStore } from 'react'
import { levelsCrossed } from '@/lib/rewards/goal'

export type CelebrationKind =
  | 'first-win' | 'pass' | 'chain' | 'clo-close' | 'course-clear'
  | 'level-up' | 'streak-ignite' | 'streak-milestone' | 'best' | 'achievement' | 'goal'

/**
 * A small, deliberately generic bag -- the same three fields serve different
 * meanings on different kinds (documented at each call site in
 * `Celebration.tsx`'s `textFor`/`soundsFor`): `skill` carries a CLO/course
 * label on `clo-close` and an achievement id on `achievement`; `n` carries a
 * chain count, a streak-day count, or an achievement-queue count depending
 * on kind; `level` carries the level reached on `level-up`.
 */
export interface CelebrationDetail {
  level?: number
  skill?: string
  n?: number
}

export interface CelebrationItem {
  id: string
  kind: CelebrationKind
  detail: CelebrationDetail
  at: number
  /** True when this specific item earned a confetti burst (decided at enqueue time). */
  confetti: boolean
  /** Present only on the collapsed "N new trophies" achievement card. */
  collapsedCount?: number
}

/**
 * Visual priority (independent of, but modelled on, the sound manager's
 * `RANK` in src/lib/sound/tiers.ts): the biggest, rarest moments preempt the
 * queue so a level-up or a skill lock is never sitting behind a routine
 * pass toast. `achievement` sits lowest -- a burst of unlocks should never
 * shoulder aside gameplay-relevant feedback the learner is mid-action for,
 * which is also the reason it is the one kind with its own collapse rule.
 */
const PRIORITY: Record<CelebrationKind, number> = {
  'first-win': 100,
  'level-up': 90,
  'clo-close': 80,
  'course-clear': 78,
  pass: 70,
  chain: 60,
  best: 55,
  'streak-milestone': 50,
  'streak-ignite': 45,
  goal: 40,
  achievement: 35,
}

/** Brief step 1: "a queue longer than two collapses into one" -- the third
 *  pending achievement is what triggers the collapse, so the threshold is 2. */
const ACHIEVEMENT_COLLAPSE_THRESHOLD = 2

/** Brief step 1 / spec 7.6: "confetti has a hard 1200ms cooldown". */
const CONFETTI_COOLDOWN_MS = 1200

let seq = 0
function nextId(): string {
  seq += 1
  return `celebration-${seq}`
}

let rawItems: { id: string; kind: CelebrationKind; detail: CelebrationDetail; at: number; confetti: boolean }[] = []
let derivedQueue: CelebrationItem[] = []
let hasPassedThisSession = false
let lastConfettiAt = -Infinity
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Brief step 1's confetti policy, read literally: "the session's first
 * pass, on a chain tick reaching 3, and on milestones" -- `first-win`
 * (permanent, but this module only ever sees it once per real session
 * anyway), the session's first `pass`, a `chain` whose `detail.n` is
 * exactly 3, and a `streak-milestone`. Nothing else in the reward table
 * (7.6) describes particles, so nothing else is eligible here. Decided once
 * per call, against the shared cooldown clock -- a losing decision never
 * gets a second chance later.
 */
function decideConfetti(kind: CelebrationKind, detail: CelebrationDetail | undefined, at: number): boolean {
  const eligible =
    kind === 'first-win' ||
    (kind === 'pass' && !hasPassedThisSession) ||
    (kind === 'chain' && detail?.n === 3) ||
    kind === 'streak-milestone'
  if (!eligible) return false
  if (at - lastConfettiAt < CONFETTI_COOLDOWN_MS) return false
  lastConfettiAt = at
  return true
}

function recomputeDerived(): void {
  const achievements = rawItems.filter((item) => item.kind === 'achievement')
  const rest = rawItems.filter((item) => item.kind !== 'achievement')
  const achievementView: CelebrationItem[] =
    achievements.length > ACHIEVEMENT_COLLAPSE_THRESHOLD
      ? [{
          id: 'achievement-collapsed',
          kind: 'achievement',
          detail: {},
          at: achievements[0].at,
          confetti: false,
          collapsedCount: achievements.length,
        }]
      : achievements.map((item) => ({ ...item }))
  derivedQueue = [...rest.map((item) => ({ ...item })), ...achievementView].sort((a, b) => {
    const byPriority = PRIORITY[b.kind] - PRIORITY[a.kind]
    return byPriority !== 0 ? byPriority : a.at - b.at
  })
}

/** The module-level enqueue every `celebrate()` call (from any component,
 *  hook, or plain call site) goes through. */
export function celebrate(kind: CelebrationKind, detail?: CelebrationDetail): void {
  const at = Date.now()
  const confetti = decideConfetti(kind, detail, at)
  if (kind === 'pass' || kind === 'first-win') hasPassedThisSession = true
  rawItems = [...rawItems, { id: nextId(), kind, detail: detail ?? {}, at, confetti }]
  recomputeDerived()
  notify()
}

/** Dismissing the collapsed achievement card clears every pending
 *  achievement it represents, not just a placeholder row -- there is
 *  nothing left behind for a fourth unlock to silently re-collapse into a
 *  stale count. */
export function dismissCelebration(id: string): void {
  rawItems = id === 'achievement-collapsed' ? rawItems.filter((item) => item.kind !== 'achievement') : rawItems.filter((item) => item.id !== id)
  recomputeDerived()
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): readonly CelebrationItem[] {
  return derivedQueue
}

function getServerSnapshot(): readonly CelebrationItem[] {
  return []
}

/**
 * The pinned public interface (T2.6 brief): every call site that only needs
 * to fire a celebration and know how backed-up the queue is uses this.
 */
export function useCelebration(): { celebrate: typeof celebrate; queueLength: number } {
  const queue = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { celebrate, queueLength: queue.length }
}

/**
 * The rendering seam `Celebration.tsx` uses: the actual current item (not
 * just its count) and the dismiss action. Additive beyond the brief's
 * printed block, same shape as T2.5's own additive exports -- it does not
 * change `useCelebration`'s pinned signature.
 */
export function useCelebrationQueue(): { queue: readonly CelebrationItem[]; current: CelebrationItem | null; dismiss: (id: string) => void } {
  const queue = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { queue, current: queue[0] ?? null, dismiss: dismissCelebration }
}

/**
 * Level-up detection to presentation (brief acceptance block): the bridge
 * between "XP just changed" and a `celebrate('level-up', detail)` call.
 * Built on T2.5's `levelsCrossed` (src/lib/rewards/goal.ts) -- every level
 * strictly between the two XP totals, so a pass big enough to cross two
 * bands at once (a large Reviewer quality bonus landing right at a
 * boundary) shows both rather than silently collapsing to just the
 * endpoint. Returns null when no level was crossed (the common case --
 * most passes move XP without moving the level). `detail.level` is the
 * highest level reached; `detail.n` is how many levels were crossed in one
 * jump, so a two-level jump can say so rather than reading identically to
 * an ordinary level-up in the presentation layer.
 */
export function levelUpDetail(beforeXp: number, afterXp: number): CelebrationDetail | null {
  const crossed = levelsCrossed(beforeXp, afterXp)
  if (crossed.length === 0) return null
  return { level: crossed[crossed.length - 1], n: crossed.length }
}
