/**
 * The daily goal and level bands (spec section 7.3, 7.4). Pure: every read
 * comes off `RewardContext`, including `today`, which the caller derived
 * from the server clock in `buildRewardContext` -- nothing here calls
 * `Date.now()` or `new Date()`.
 */
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
