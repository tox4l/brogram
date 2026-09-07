/**
 * Assembles `RewardContext`, the one read model every derivation in this
 * module works from (spec 2026-09-06-brogram-v2-bro.md section 7). Pure: no
 * I/O, no agent call, no wall-clock read -- `now` always arrives from the
 * caller so a predicate result never depends on when it happened to run,
 * only on what it was given.
 *
 * `RewardContext` is also the type that makes "self-comparison only" (spec
 * 7.1) checkable, not just claimed: every field is either this learner's own
 * state or a UTC date key. There is no other-learner id, cohort, or rank
 * anywhere in the shape, and context.test.ts pins the exact key set so a
 * future edit cannot add one without the test failing.
 */
import type { Attempt, CourseCode, Difficulty, DrillResult, LearnerState, LessonProgress, WellnessPrefs } from '@/lib/contracts'

/**
 * An `Attempt` widened with the difficulty of the exercise it was made
 * against, when the caller has it.
 *
 * The `attempts` contract row (and the frozen `Attempt` type) carries no
 * difficulty column -- it was never needed until `no-wheels` ("pass a medium
 * or harder rep with zero hints", spec 7.5 #2), which is the first reward
 * derivation to need it. Rather than reopen the frozen contract or the
 * `attempts` table for one achievement, the field is optional here: every
 * real `Attempt` already satisfies `RewardAttempt` with `difficulty`
 * `undefined`, so nothing upstream breaks, and a predicate that needs it
 * simply cannot fire for an entry that lacks it (never throws -- see
 * `achievements.ts`'s `noWheels`). A caller that already has the exercise in
 * memory (the loop that just graded it, or a loaded curriculum bundle) can
 * attach it; nothing in this module ever fetches it.
 */
export type RewardAttempt = Attempt & { readonly difficulty?: Difficulty }

/** One day of activity, exactly the shape `useActivityDays` already fetches
 *  (src/lib/query/hooks.ts) -- restated locally so this module never imports
 *  a client-only hooks file. */
export interface ActivityDay {
  kind: 'exercise' | 'derot'
  day: string
}

export interface RewardContext {
  state: LearnerState
  /** The capped 50-row attempts window (see `ATTEMPTS_WINDOW`). Most recent first. */
  attempts: readonly RewardAttempt[]
  activityDays: readonly ActivityDay[]
  lessonProgress: readonly LessonProgress[]
  /**
   * The capped 300-row drill_results window (spec R7.6b). Oldest first.
   *
   * Invariant this module assumes but does not itself enforce (Important 5,
   * fix round 1): one row is one *completed run*. That is already true for
   * every Playground game (one `DrillResult` per 60-120s game) but not yet
   * true for Arcade, which as shipped still writes one row per drill *item*
   * -- a run is meant to be six items (spec 7.9). `sharp`, `touch-grass` and
   * `winsToday`'s de-rot term all count rows directly and will over-count
   * Arcade "runs" by roughly 6x until T2.9a lands the run model that makes
   * one row equal one run for both lanes. See achievements.test.ts's
   * "invariant: one DrillResult row is one completed run" block.
   */
  drillResults: readonly DrillResult[]
  prefs: WellnessPrefs
  /** Per-course total of *countable* walkthroughs -- non-draft, shipped
   *  lessons only (Minor 2). `full-read` (achievements.ts) trusts this
   *  number as the authoritative denominator and never re-derives it from
   *  the curriculum; a caller that includes a draft CLO's lesson in this
   *  count hands `full-read` a target it can never actually reach. */
  courseLessonCounts: Readonly<Record<CourseCode, number>>
  /** UTC date key ("YYYY-MM-DD"), read from the server clock the caller supplies. */
  today: string
}

/** Mirrors `ATTEMPTS_CAP` in src/lib/query/hooks.ts. Restated, not imported --
 *  that file is client-only ('use client', a React Query hook module) and
 *  this one must stay importable from anywhere, including Node test runs. */
export const ATTEMPTS_WINDOW = 50

/** Mirrors the 300 cap baked into `append_drill_result` (migration 0009). */
export const DRILL_RESULTS_WINDOW = 300

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * The UTC calendar day exactly as written in an ISO timestamp -- no `Date`
 * round-trip that could shift it by the machine's local offset. Same
 * convention as `dateKey` in src/lib/learner/compile.ts and
 * src/app/(app)/derot/lib.ts: Postgres hands back `timestamptz` in UTC, so a
 * server `now` is turned into a key the same way, through `now.toISOString()`.
 * Returns null for a string that does not start with a date -- callers treat
 * that as "not today" rather than throwing.
 */
export function utcDateKey(iso: string): string | null {
  const match = ISO_DATE.exec(iso)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

export interface BuildRewardContextArgs {
  state: LearnerState
  attempts: readonly RewardAttempt[]
  activityDays: readonly ActivityDay[]
  lessonProgress: readonly LessonProgress[]
  drillResults: readonly DrillResult[]
  prefs: WellnessPrefs
  courseLessonCounts: Readonly<Record<CourseCode, number>>
  /** The server clock. Never read from `Date.now()` inside this module. */
  now: Date
}

/**
 * Assembled entirely from data that already exists (spec 7.5): the caller's
 * already-fetched Learner State, attempts window, lesson progress, drill
 * results and wellness prefs. Defensively re-applies both caps so a caller
 * that forgot one cannot silently change what a predicate counts against --
 * `comeback` (7.5 #8) reads "recent history" and means it, and `sharp` /
 * `touch-grass` (#16, #17) count `drillResults` rows directly.
 *
 * `attempts` arrives most-recent-first (the order `useAttempts` fetches in),
 * so the cap keeps the first `ATTEMPTS_WINDOW`. `drillResults` arrives
 * oldest-first (the order `append_drill_result` maintains), so the cap keeps
 * the last `DRILL_RESULTS_WINDOW`.
 */
export function buildRewardContext(args: BuildRewardContextArgs): RewardContext {
  const today = utcDateKey(args.now.toISOString()) ?? args.now.toISOString().slice(0, 10)
  return {
    state: args.state,
    attempts: args.attempts.slice(0, ATTEMPTS_WINDOW),
    activityDays: args.activityDays,
    lessonProgress: args.lessonProgress,
    drillResults: args.drillResults.slice(-DRILL_RESULTS_WINDOW),
    prefs: args.prefs,
    courseLessonCounts: args.courseLessonCounts,
    today,
  }
}
