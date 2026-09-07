/**
 * The twenty achievement predicates (spec section 7.5). Every predicate is a
 * pure, total function of a `RewardContext`: it never throws, including on a
 * brand-new account's empty context, and it never reads anything but the
 * fields already on `ctx`.
 *
 * Three predicates carry corrections the spec's critic pass called out --
 * each is documented at its own definition below (`comeback`, `twoTongues`,
 * `keptThePromise`).
 */
import type { Achievement, CloId, DrillLane, DrillResult, Language, Mastery } from '@/lib/contracts'
import { ACHIEVEMENTS, levelForXp } from '@/lib/contracts'
import { clo, course } from '@/lib/curriculum'
import { DRILL_META } from '@/app/(app)/derot/lib'
import type { RewardAttempt, RewardContext } from './context'

export type AchievementPredicate = (ctx: RewardContext) => boolean

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function masteryValues(ctx: RewardContext): Mastery[] {
  return Object.values(ctx.state.mastery)
}

/**
 * A CLO counts as "touched" the moment it has any recorded **pass** -- a
 * chain in progress, a closed skill, or a pattern ever passed -- not only
 * once it closes.
 *
 * Fix round 1 (Critical 1): this used to also count `lastAttemptAt !== null`,
 * which `applyFail` sets on every failure too (`src/lib/learner/score.ts`),
 * not only on a pass. That let `two-tongues` unlock on two *failed* reps in
 * two different-language courses -- a permanent, unrecoverable wrong unlock,
 * since migration 0007 grants `user_achievements` insert-only, no update, no
 * delete. Every remaining clause here (`closed`, `chain > 0`,
 * `patternsPassed.length > 0`) is pass-derived only, so a pass always leaves
 * a trace here and a fail never does (`src/lib/learner/score.ts`'s
 * `applyFail` zeroes `chain` and leaves `patternsPassed` untouched).
 */
function isTouched(mastery: Mastery): boolean {
  return mastery.closed || mastery.chain > 0 || mastery.patternsPassed.length > 0
}

const MEDIUM_OR_HARDER = 3

// ---------------------------------------------------------------------------
// #1-2: first pass, first pass with no scaffolding
// ---------------------------------------------------------------------------

const firstBlood: AchievementPredicate = (ctx) => ctx.attempts.some((a) => a.passed)

/**
 * "Pass a medium or harder rep with zero hints." The frozen `Attempt`
 * contract carries no difficulty column (it was never needed before this),
 * so `RewardContext`'s attempts are `RewardAttempt`: an `Attempt` widened
 * with an *optional* `difficulty`, filled in only by a caller that already
 * has it (see `context.ts`). An attempt with no difficulty attached simply
 * cannot satisfy this predicate yet -- that is a "not yet", never a throw.
 */
const noWheels: AchievementPredicate = (ctx) =>
  ctx.attempts.some((a) => a.passed && a.hintCount === 0 && a.difficulty !== undefined && a.difficulty >= MEDIUM_OR_HARDER)

// ---------------------------------------------------------------------------
// #3-5: mastery milestones
// ---------------------------------------------------------------------------

const threeAngles: AchievementPredicate = (ctx) => masteryValues(ctx).some((m) => m.closed)

const FIVE_LOCKED_TARGET = 5
const fiveLocked: AchievementPredicate = (ctx) => masteryValues(ctx).filter((m) => m.closed).length >= FIVE_LOCKED_TARGET

/** "Lock every skill in a course." Reads `path` (the Planner's ordered list
 *  for the current course) and `mastery` only -- no curriculum lookup needed,
 *  and no course is "cleared" before a path for it has even been planned. */
const courseClear: AchievementPredicate = (ctx) => {
  const path = ctx.state.path
  return path.length > 0 && path.every((id) => ctx.state.mastery[id]?.closed === true)
}

// ---------------------------------------------------------------------------
// #6-7: walkthroughs
// ---------------------------------------------------------------------------

const READ_THE_MANUAL_TARGET = 5
const readTheManual: AchievementPredicate = (ctx) =>
  ctx.lessonProgress.filter((p) => p.status === 'completed').length >= READ_THE_MANUAL_TARGET

/** "Finish every walkthrough in a course." `lesson_progress` rows carry a
 *  `cloId`, not a course code, so the course is recovered through the
 *  curriculum's own CLO lookup (`clo(id).course`) -- pure, static, bundled
 *  data, the same lookup `src/lib/course/map.ts` already keys off of `Clo`
 *  objects for. Fires for the first course where every counted lesson
 *  (`courseLessonCounts`) has a completed row.
 *
 *  `courseLessonCounts` is trusted as the authoritative denominator (Minor
 *  2): this predicate never re-derives it from the curriculum, so the
 *  caller building `RewardContext` owns the "non-draft, shipped lessons
 *  only" rule -- `Clo.draft` CLOs (e.g. every INFS1201 CLO today) must not
 *  be counted toward a total this predicate can actually complete. */
const fullRead: AchievementPredicate = (ctx) => {
  const completedByCourse = new Map<string, number>()
  for (const progress of ctx.lessonProgress) {
    if (progress.status !== 'completed') continue
    const course = clo(progress.cloId)?.course
    if (!course) continue
    completedByCourse.set(course, (completedByCourse.get(course) ?? 0) + 1)
  }
  return Object.entries(ctx.courseLessonCounts).some(([code, total]) => total > 0 && (completedByCourse.get(code) ?? 0) >= total)
}

// ---------------------------------------------------------------------------
// #8: comeback (critic-corrected)
// ---------------------------------------------------------------------------

const COMEBACK_FAIL_THRESHOLD = 3

/**
 * "Pass a rep you failed three times or more." Grouped by exercise, **within
 * the 50-row attempts window only** (`ctx.attempts` is already that window --
 * see `context.ts`'s `ATTEMPTS_WINDOW`). The locked card's copy says "in your
 * recent history" precisely because of this: a fail-fail-fail-pass sequence
 * that scrolled out of the last 50 attempts cannot fire this, and pretending
 * otherwise would make it a silently-broken achievement instead of an honest
 * one (spec 7.5 #8 critic).
 *
 * Order-aware (Minor 1, fix round 1): `ctx.attempts` arrives most-recent-
 * first (`context.ts`'s documented convention), so for each exercise this
 * walks newest-to-oldest and, for every pass found, counts only the fails
 * *older* than it (later in the array). A pass that came before three fails
 * (chronologically) -- the fails are newer, not older -- must not fire this;
 * the achievement is "you came back", not "you happened to fail after".
 */
const comeback: AchievementPredicate = (ctx) => {
  const byExercise = new Map<string, RewardAttempt[]>()
  for (const attempt of ctx.attempts) {
    const list = byExercise.get(attempt.exerciseId)
    if (list) list.push(attempt)
    else byExercise.set(attempt.exerciseId, [attempt])
  }

  for (const attempts of byExercise.values()) {
    for (let i = 0; i < attempts.length; i += 1) {
      if (!attempts[i].passed) continue
      const olderFails = attempts.slice(i + 1).filter((a) => !a.passed).length
      if (olderFails >= COMEBACK_FAIL_THRESHOLD) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// #9: speed
// ---------------------------------------------------------------------------

const UNDER_A_MINUTE_MS = 60_000
const underAMinute: AchievementPredicate = (ctx) =>
  ctx.attempts.some((a) => a.passed && a.hintCount === 0 && a.durationMs < UNDER_A_MINUTE_MS)

// ---------------------------------------------------------------------------
// #10: two-tongues (critic-corrected)
// ---------------------------------------------------------------------------

const TWO_TONGUES_TARGET = 2

/**
 * "Pass reps in two different languages." Derived from closed-or-touched
 * CLOs via `mastery`, never from the attempts window: a learner who passes
 * sixty Python reps before switching course has aged every one of them out
 * of the 50-row window by the time the first JS pass lands, so the window
 * would silently never see two languages at once. `mastery` is unbounded and
 * keyed by CLO, and each CLO belongs to exactly one course with one language
 * (`clo(id).course` then `course(code).language`, both pure static lookups),
 * so the language set only grows and is never subject to a rolling cap
 * (spec 7.5 #10 critic).
 *
 * Reads `course(code).language` only, never `secondaryLanguage` (e.g.
 * INFS2201's `mongo`) -- a mongo-only rep never counts as a second language
 * here. Under-fires only, which is the safe direction for an honesty-first
 * achievement (Minor 4).
 */
const twoTongues: AchievementPredicate = (ctx) => {
  const languages = new Set<Language>()
  for (const [cloId, mastery] of Object.entries(ctx.state.mastery)) {
    if (!isTouched(mastery)) continue
    const language = course(clo(cloId as CloId)?.course ?? '')?.language
    if (language) languages.add(language)
  }
  return languages.size >= TWO_TONGUES_TARGET
}

// ---------------------------------------------------------------------------
// #11: pattern breadth
// ---------------------------------------------------------------------------

const PATTERN_HUNTER_TARGET = 10
const patternHunter: AchievementPredicate = (ctx) => {
  const patterns = new Set<string>()
  for (const mastery of masteryValues(ctx)) for (const pattern of mastery.patternsPassed) patterns.add(pattern)
  return patterns.size >= PATTERN_HUNTER_TARGET
}

// ---------------------------------------------------------------------------
// #12-14: streaks
// ---------------------------------------------------------------------------

const dayThree: AchievementPredicate = (ctx) => ctx.state.streak.exerciseDays >= 3
const weekStrong: AchievementPredicate = (ctx) => ctx.state.streak.exerciseDays >= 7
const thirty: AchievementPredicate = (ctx) => ctx.state.streak.exerciseDays >= 30

// ---------------------------------------------------------------------------
// #15: kept-the-promise (critic-corrected, R7.7)
// ---------------------------------------------------------------------------

const KEPT_THE_PROMISE_TARGET = 7

/**
 * "Hit your daily goal seven times." A claim about seven *past* days, which
 * nothing else in this shape can see: the 50-row attempts window cannot look
 * back that far once walkthroughs and de-rot runs also count as wins, and
 * `lesson_progress` / `drill_results` live in different tables from
 * `attempts` entirely. Ruling R7.7 gives it one durable byte of memory --
 * `wellness.prefs.goalDays`, appended once per day a goal is met -- and this
 * predicate reads exactly that (spec 7.5 #15 critic).
 */
const keptThePromise: AchievementPredicate = (ctx) => ctx.prefs.goalDays.length >= KEPT_THE_PROMISE_TARGET

// ---------------------------------------------------------------------------
// #16-17: de-rot lanes
// ---------------------------------------------------------------------------

const LANE_RUN_TARGET = 10

/**
 * "Finish ten Arcade / Playground runs." Counts `drillResults` rows directly
 * for the lane -- see `RewardContext.drillResults`'s doc comment (Important
 * 5, fix round 1): this is correct once one row is one completed run, which
 * is already true for Playground but not yet true for Arcade (still one row
 * per drill item as shipped). `sharp` will fire roughly 6x too early for
 * Arcade until T2.9a's run model lands; that gap is T2.9a's obligation, not
 * a bug in this count.
 *
 * W2-SCHEMA-I2: a row's `lane` is a required contract field, but rows
 * written before Wave 2 never carried it, and no migration backfills it.
 * `DrillKind` fully determines `DrillLane` (`DRILL_META`, one lane per kind,
 * `src/app/(app)/derot/lib.ts`), so the kind is the source of truth here,
 * never the possibly-absent stored field -- identical guard to
 * `src/components/report/derive.ts`'s `deriveDrillScores`.
 */
function laneOf(result: DrillResult): DrillLane {
  return DRILL_META[result.kind]?.lane ?? 'arcade'
}

const sharp: AchievementPredicate = (ctx) => ctx.drillResults.filter((d) => laneOf(d) === 'arcade').length >= LANE_RUN_TARGET
const touchGrass: AchievementPredicate = (ctx) => ctx.drillResults.filter((d) => laneOf(d) === 'play').length >= LANE_RUN_TARGET

// ---------------------------------------------------------------------------
// #18: personal bests
// ---------------------------------------------------------------------------

const BEAT_YOURSELF_TARGET = 5

/**
 * "Set five personal bests." A `DrillResult` does not self-mark whether it
 * *was* a personal best, so this replays the window in time order and counts
 * every strict-improvement moment per kind -- the same "beats your own prior
 * best" rule the 7.6 reward-event table names, and the same per-kind
 * comparison R7.6a requires (scores are only ever compared within one kind).
 * A kind's first-ever result trivially sets its first best.
 */
function countPersonalBests(results: readonly DrillResult[]): number {
  const bestByKind = new Map<string, number>()
  let count = 0
  for (const result of [...results].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const priorBest = bestByKind.get(result.kind)
    if (priorBest === undefined || result.score > priorBest) {
      bestByKind.set(result.kind, result.score)
      count += 1
    }
  }
  return count
}

const beatYourself: AchievementPredicate = (ctx) => countPersonalBests(ctx.drillResults) >= BEAT_YOURSELF_TARGET

// ---------------------------------------------------------------------------
// #19-20: level
// ---------------------------------------------------------------------------

const levelFive: AchievementPredicate = (ctx) => levelForXp(ctx.state.points) >= 5
const machine: AchievementPredicate = (ctx) => levelForXp(ctx.state.points) >= 25

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** One predicate per id in `ACHIEVEMENTS` (achievements.test.ts pins the parity). */
export const PREDICATES: Readonly<Record<string, AchievementPredicate>> = {
  'first-blood': firstBlood,
  'no-wheels': noWheels,
  'three-angles': threeAngles,
  'five-locked': fiveLocked,
  'course-clear': courseClear,
  'read-the-manual': readTheManual,
  'full-read': fullRead,
  comeback,
  'under-a-minute': underAMinute,
  'two-tongues': twoTongues,
  'pattern-hunter': patternHunter,
  'day-three': dayThree,
  'week-strong': weekStrong,
  thirty,
  'kept-the-promise': keptThePromise,
  sharp,
  'touch-grass': touchGrass,
  'beat-yourself': beatYourself,
  'level-five': levelFive,
  machine,
}

/** Achievements whose predicate is true against `ctx` and whose id is not
 *  already in `held`. Read-only: never mutates `ctx`, never touches
 *  `ctx.state.points` -- achievements are recognition, not currency (R7.1). */
export function newlyUnlocked(ctx: RewardContext, held: readonly string[]): Achievement[] {
  const heldSet = new Set(held)
  return ACHIEVEMENTS.filter((achievement) => !heldSet.has(achievement.id) && PREDICATES[achievement.id]?.(ctx) === true)
}
