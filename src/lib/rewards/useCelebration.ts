'use client'

/**
 * The one entry point every celebration-firing call site uses (T2.2's pass
 * path, T2.3's Progress/Account trophy shelf, T2.9a/T2.9b's de-rot runs):
 * `celebrate(kind, detail, eventId?)` enqueues an event; `<Celebration />`
 * (src/components/rewards/Celebration.tsx) is the one place that reads the
 * queue back and renders it. The two are decoupled through a module-level
 * store (the same shape `src/lib/sound/manager.ts` uses) rather than React
 * context, because a call site that fires a celebration (a hook, a mutation
 * `onSuccess`, a game loop) is very often not a descendant of whatever
 * mounts the celebration layer, and does not need to be.
 *
 * Everything a call site never has to think about lives here:
 *  - **priority**: a higher-priority event shows before a lower one that
 *    arrived first; **one at a time**: only the highest-priority, oldest
 *    item is "current";
 *  - **the achievement collapse**: a queue of more than two pending
 *    achievement unlocks collapses into one "N new trophies" card rather
 *    than three unlocks in a row in front of the next rep;
 *  - **the confetti cooldown and eligibility**: decided once, at the moment
 *    a celebration is queued, against a hard 1200ms cooldown -- never
 *    re-decided at render/dequeue time;
 *  - **a bounded lifetime per item** (fix round 1, C2/I4b): every kind has a
 *    maximum time it may occupy the queue, several routine events landing
 *    in the same ~300ms submit share a shrunk budget so one submit can
 *    never own more than ~3s of screen time, and a stale item (nobody read
 *    the store before its lifetime elapsed -- a route that does not mount
 *    `<Celebration />`) is dropped on the next read rather than promoted
 *    later with a stale sound;
 *  - **idempotency** (fix round 1, I8): an optional `eventId` makes a
 *    repeated `celebrate()` call for the same event (a StrictMode
 *    double-invoke, a retried mutation) a no-op for as long as the first
 *    call's item is still live in the queue.
 */

import { useSyncExternalStore } from 'react'
import { levelsCrossed } from '@/lib/rewards/goal'

export type CelebrationKind =
  | 'first-win' | 'pass' | 'chain' | 'clo-close' | 'course-clear'
  | 'level-up' | 'streak-ignite' | 'streak-milestone' | 'best' | 'achievement' | 'goal'

/**
 * A small, deliberately generic bag -- the same fields serve different
 * meanings on different kinds (documented at each read site in
 * `Celebration.tsx`'s `textFor`/`soundsFor`): `skill` carries a CLO/course
 * label on `clo-close` and an achievement id on `achievement`; `n` carries a
 * chain count, a streak-day count, an achievement-queue count, or a
 * personal-best score depending on kind; `level` carries the level reached
 * on `level-up`; `fromXp`/`toXp` are optional and, when supplied, let the
 * level-up presentation refill the XP bar from the old level's fraction to
 * the new one instead of only growing the badge.
 */
export interface CelebrationDetail {
  level?: number
  skill?: string
  n?: number
  fromXp?: number
  toXp?: number
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
  /** The individual achievements' details a collapsed card represents (fix
   *  round 1, C3: the render layer fans these out on hover/focus). Present
   *  only alongside `collapsedCount`. */
  collapsedDetails?: readonly CelebrationDetail[]
  /** Milliseconds this item may live in the queue: both the auto-dismiss
   *  budget the render layer uses while it is current, and the staleness
   *  TTL the store itself enforces on read (fix round 1, C2/I4b). */
  lifetimeMs: number
}

interface RawItem {
  id: string
  kind: CelebrationKind
  detail: CelebrationDetail
  at: number
  confetti: boolean
  lifetimeMs: number
  eventId?: string
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

/**
 * The maximum time each kind's card may occupy the queue (spec 7.6's motion
 * column, "rare events longer, but bounded" -- fix round 1, C2). `level-up`
 * used to never auto-dismiss at all; "always dismissable" (brief step 1)
 * guarantees the close-button/Escape affordance, it does not require an
 * infinite card, and an infinite card is exactly what let a stale one
 * survive a route change and replay on the next mount (C2's failure
 * scenario). `achievement`'s 2500ms is the brief's own "2.5s" number.
 */
const BASE_LIFETIME_MS: Record<CelebrationKind, number> = {
  'first-win': 2800,
  pass: 1500,
  chain: 1200,
  'clo-close': 2600,
  'course-clear': 2800,
  'level-up': 7000,
  'streak-ignite': 2200,
  'streak-milestone': 2800,
  best: 1400,
  achievement: 2500,
  goal: 2200,
}

/** Brief step 1: "a queue longer than two collapses into one" -- the third
 *  pending achievement is what triggers the collapse, so the threshold is 2. */
const ACHIEVEMENT_COLLAPSE_THRESHOLD = 2

/** Brief step 1 / spec 7.6: "confetti has a hard 1200ms cooldown". */
const CONFETTI_COOLDOWN_MS = 1200

/**
 * I4b: kinds exempt from the same-submit time-budget cap below. `achievement`
 * already has its own collapse rule; `level-up` is the one guaranteed-long
 * card and must never be shortened by unrelated events landing nearby.
 */
const BATCH_EXEMPT = new Set<CelebrationKind>(['achievement', 'level-up'])
/** A submit firing three-plus routine events (clo-close + pass + chain is
 *  the brief's own example) is treated as one batch when items land within
 *  this many ms of each other. */
const BATCH_WINDOW_MS = 300
/** The whole batch may not occupy more than this much total screen time --
 *  "the moment has to be over before the learner's hands are back on the
 *  keyboard" (fix round 1 screenshot judgement). */
const BATCH_BUDGET_MS = 3000
const MIN_BATCHED_LIFETIME_MS = 500

/** A defensive cap (fix round 1, M7): a route that never mounts
 *  `<Celebration />` must not let `rawItems` grow without bound. */
const MAX_RAW_ITEMS = 50

const EMPTY_QUEUE: readonly CelebrationItem[] = []

let seq = 0
function nextId(): string {
  seq += 1
  return `celebration-${seq}`
}

let rawItems: RawItem[] = []
let derivedQueue: CelebrationItem[] = EMPTY_QUEUE as CelebrationItem[]
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
 * gets a second chance later, and (fix round 1, I4) never gets re-decided
 * at render time either: the render layer only ever reads this flag.
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

/**
 * I4b: a burst of three-plus non-exempt events landing within
 * `BATCH_WINDOW_MS` of each other shares a shrunk time budget so the whole
 * burst cannot exceed `BATCH_BUDGET_MS`. Mutates any already-queued siblings
 * in place (their lifetime can only shrink, never grow) and returns the
 * lifetime for the item being enqueued right now.
 */
function applyBatchCap(kind: CelebrationKind, at: number): number {
  const base = BASE_LIFETIME_MS[kind]
  if (BATCH_EXEMPT.has(kind)) return base
  const siblings = rawItems.filter((item) => !BATCH_EXEMPT.has(item.kind) && at - item.at < BATCH_WINDOW_MS)
  const batchSize = siblings.length + 1
  if (batchSize <= 2) return base
  const share = Math.max(MIN_BATCHED_LIFETIME_MS, Math.floor(BATCH_BUDGET_MS / batchSize))
  for (const sibling of siblings) sibling.lifetimeMs = Math.min(sibling.lifetimeMs, share)
  return Math.min(base, share)
}

/** C2: drop anything older than its own lifetime. Returns whether anything
 *  was actually removed, so the caller only pays for `recomputeDerived()`
 *  when the queue really changed -- `getSnapshot()` must return the exact
 *  same reference across repeated calls when nothing changed, which
 *  `useSyncExternalStore` relies on to avoid tearing/re-render loops. */
function pruneStale(now: number): boolean {
  if (rawItems.length === 0) return false
  const before = rawItems.length
  rawItems = rawItems.filter((item) => now - item.at < item.lifetimeMs)
  return rawItems.length !== before
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
          collapsedDetails: achievements.map((item) => item.detail),
          lifetimeMs: Math.max(...achievements.map((item) => item.lifetimeMs)),
        }]
      : achievements.map((item) => ({ ...item }))
  derivedQueue = [...rest.map((item) => ({ ...item })), ...achievementView].sort((a, b) => {
    const byPriority = PRIORITY[b.kind] - PRIORITY[a.kind]
    return byPriority !== 0 ? byPriority : a.at - b.at
  })
}

/**
 * The module-level enqueue every `celebrate()` call (from any component,
 * hook, or plain call site) goes through.
 *
 * `eventId` (fix round 1, I8): pass one whenever the call site's own trigger
 * can itself repeat for the same real-world event -- an effect keyed on a
 * value that React StrictMode double-invokes, or a mutation `onSuccess`
 * that a network retry can re-run. A second `celebrate()` call for an
 * `eventId` still present in the queue (not yet dismissed or expired) is a
 * silent no-op: same event, same celebration, once.
 */
export function celebrate(kind: CelebrationKind, detail?: CelebrationDetail, eventId?: string): void {
  const at = Date.now()
  if (eventId !== undefined && rawItems.some((item) => item.eventId === eventId)) return
  const confetti = decideConfetti(kind, detail, at)
  if (kind === 'pass' || kind === 'first-win') hasPassedThisSession = true
  const lifetimeMs = applyBatchCap(kind, at)
  rawItems = [...rawItems, { id: nextId(), kind, detail: detail ?? {}, at, confetti, lifetimeMs, eventId }]
  if (rawItems.length > MAX_RAW_ITEMS) rawItems = rawItems.slice(-MAX_RAW_ITEMS)
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

/**
 * C2: "a route change clears already-shown items." `<Celebration />` calls
 * this on unmount with the ids it actually rendered as `current` during its
 * lifetime -- an item that was displayed and then abandoned (the learner
 * navigated away instead of dismissing it) is cleared rather than being
 * promoted again, with its sound, on the next route's mount. An item that
 * was queued but never got a turn as `current` is deliberately left alone:
 * it has not been shown yet, so showing it on the next route is its first
 * and only showing, not a replay (C2's own worked example: "a legitimate
 * celebration fired 50ms before a router.push").
 */
export function clearShownCelebrations(shownIds: ReadonlySet<string>): void {
  if (shownIds.size === 0) return
  const before = rawItems.length
  rawItems = rawItems.filter((item) => !shownIds.has(item.id))
  if (rawItems.length === before) return
  recomputeDerived()
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): readonly CelebrationItem[] {
  if (pruneStale(Date.now())) recomputeDerived()
  return derivedQueue
}

function getServerSnapshot(): readonly CelebrationItem[] {
  return EMPTY_QUEUE
}

/**
 * The pinned public interface (T2.6 brief): every call site that only needs
 * to fire a celebration and know how backed-up the queue is uses this.
 *
 * M6: a call site that only ever calls `celebrate()` and never reads
 * `queueLength` does not need this hook at all -- `celebrate` is already a
 * stable, standalone export (`import { celebrate } from
 * '@/lib/rewards/useCelebration'`) that fires without subscribing to the
 * store, so a route holding something render-sensitive (the exercise
 * editor) is never re-rendered just because a celebration landed elsewhere.
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
 * jump; `fromXp`/`toXp` are carried through so the level-up card can refill
 * an XP bar rather than only growing the badge.
 */
export function levelUpDetail(beforeXp: number, afterXp: number): CelebrationDetail | null {
  const crossed = levelsCrossed(beforeXp, afterXp)
  if (crossed.length === 0) return null
  return { level: crossed[crossed.length - 1], n: crossed.length, fromXp: beforeXp, toXp: afterXp }
}
