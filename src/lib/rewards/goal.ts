/**
 * The daily goal and level bands (spec section 7.3, 7.4). Pure: every read
 * comes off `RewardContext`, including `today`, which the caller derived
 * from the server clock in `buildRewardContext` -- nothing here calls
 * `Date.now()` or `new Date()`.
 */
import { levelForXp } from '@/lib/contracts'
import { recordGoalDay } from '@/lib/wellness/prefs'
import type { RewardContext } from './context'
import { utcDateKey } from './context'

function landedOn(ctx: RewardContext, iso: string | null): boolean {
  return iso !== null && utcDateKey(iso) === ctx.today
}

/**
 * A win is any of: a passed exercise, a completed walkthrough, or a
 * completed de-rot run in either lane (spec 7.4). Every qualifying event
 * dated today counts once, including a de-rot run that was not "correct" --
 * a win tracks genuine showing up, not a score threshold (the same reading
 * `sharp` / `touch-grass` in achievements.ts use for what counts as a
 * finished run), and `breathe` (spec 7.9) cannot even produce an incorrect
 * result. A walkthrough counts once, on the day it was first completed --
 * `completedAt` is set once and never rewritten on a later re-read
 * (src/lib/lesson/progress.ts), so reopening a finished lesson can never
 * manufacture a second win for a different day.
 */
export function winsToday(ctx: RewardContext): number {
  const exerciseWins = ctx.attempts.filter((attempt) => attempt.passed && landedOn(ctx, attempt.createdAt)).length
  const walkthroughWins = ctx.lessonProgress.filter((progress) => landedOn(ctx, progress.completedAt)).length
  const derotWins = ctx.drillResults.filter((result) => landedOn(ctx, result.at)).length
  return exerciseWins + walkthroughWins + derotWins
}

/** Whether today's wins have reached `prefs.dailyGoal`. Going past it is not
 *  a different state -- "going past it says nothing" (spec 7.4) is a
 *  frequency guard the caller applies (fire `goal.done` once, off whether
 *  `wellness.prefs.goalDays` already has today's key), not something this
 *  function distinguishes. */
export function goalMet(ctx: RewardContext): boolean {
  return winsToday(ctx) >= ctx.prefs.dailyGoal
}

/**
 * The once-per-day `goal.done` frequency guard (Important 5, fix round 1 --
 * brief Step 3 / R7.7 named this as this task's own obligation, and it had
 * no owner: `kept-the-promise` reads `prefs.goalDays`, but nothing recorded
 * into it). True exactly once per UTC day: the goal is met today, and
 * today's key is not already in `goalDays`. A caller firing `goal.done` off
 * `winsToday(ctx) === ctx.prefs.dailyGoal` misses the day two wins land at
 * once; one firing off `>=` re-fires on every later win that day -- the
 * infinite treadmill spec 7.4 exists to prevent. This is the one place that
 * rule lives.
 */
export function shouldRecordGoalDay(ctx: RewardContext): boolean {
  return goalMet(ctx) && !ctx.prefs.goalDays.includes(ctx.today)
}

/**
 * `wellness.prefs.goalDays` with today's key appended (deduped, capped at
 * 120 -- `recordGoalDay`, src/lib/wellness/prefs.ts), or `null` when
 * `shouldRecordGoalDay` is false, so a caller can write back to `prefs`
 * exactly when there is something new to write and never otherwise. The 120
 * cap never interacts with `kept-the-promise`'s threshold of 7: the oldest
 * entries trimmed are always far more than seven days behind whichever ones
 * would satisfy it.
 */
export function nextGoalDays(ctx: RewardContext): string[] | null {
  return shouldRecordGoalDay(ctx) ? recordGoalDay([...ctx.prefs.goalDays], ctx.today) : null
}

export type LevelBand = 'Fresh' | 'Wired In' | 'Shipping' | 'Dangerous' | 'Locked In' | 'Machine'

const LEVEL_BANDS: readonly { upTo: number; band: LevelBand }[] = [
  { upTo: 4, band: 'Fresh' },
  { upTo: 9, band: 'Wired In' },
  { upTo: 14, band: 'Shipping' },
  { upTo: 19, band: 'Dangerous' },
  { upTo: 24, band: 'Locked In' },
  { upTo: 30, band: 'Machine' },
]

/** The label shown next to the level number (spec 7.3). Total over any
 *  finite number: clamped into [1, 30] before lookup, so a level of 0 or 40
 *  (neither of which `levelForXp` ever produces) still returns a band
 *  instead of `undefined`. */
export function levelBand(level: number): LevelBand {
  const clamped = Math.min(30, Math.max(1, Math.round(level)))
  return (LEVEL_BANDS.find((entry) => clamped <= entry.upTo) ?? LEVEL_BANDS[LEVEL_BANDS.length - 1]).band
}

/**
 * Every level crossed going from `beforeXp` to `afterXp`, in ascending order
 * (Important 2, fix round 1 -- spec 7.6's "Level up" row needs to know which
 * levels were crossed, not only whether `levelForXp` disagrees at the two
 * ends: a batch of queued passes landing together, or a Reviewer
 * reconciliation, can cross more than one at once, e.g. 1,340 XP to 2,600 XP
 * crosses both level 3 and level 4). `[]` when XP did not move forward or
 * crossed nothing. Naturally capped at `MAX_LEVEL` (spec 7.3: "past level 30
 * the level stays 30") because `levelForXp` itself never returns higher.
 */
export function levelsCrossed(beforeXp: number, afterXp: number): number[] {
  const before = levelForXp(beforeXp)
  const after = levelForXp(afterXp)
  const crossed: number[] = []
  for (let level = before + 1; level <= after; level += 1) crossed.push(level)
  return crossed
}
