/**
 * Flame states and milestones (spec section 7.4). Pure and total: every
 * input is a plain number or boolean the caller already has (the streak
 * count from `LearnerState.streak`, whether today is already counted, the
 * learner's local hour, the same instant's UTC hour, and whether this
 * evaluation follows a fresh transition) -- nothing here reads a clock or a
 * calendar itself.
 *
 * Streak copy always frames keeping something good, never impending loss
 * (spec 7.4): no state here is a countdown, and nothing about "at risk" ever
 * turns into a number of hours left.
 */

export type FlameState = 'cold' | 'lit' | 'at-risk' | 'ignite' | 'milestone' | 'reset'

/** Streak lengths that get the bigger burst plus a milestone card (spec 7.4). */
export const MILESTONES: readonly number[] = [3, 7, 14, 30, 50, 100]

/** The hour (24h, either clock -- see `flameState`) after which an uncounted
 *  streak reads as "at risk". */
const AT_RISK_LOCAL_HOUR = 18

/**
 * `justTransitioned` (fix round 1: renamed from `justCounted`, which said
 * nothing about the on-load call and shipped `reset` untested and
 * unreachable -- Important 2 / Ruling 3) means this evaluation follows a
 * transition worth flagging. The caller passes `true` from its **own**
 * before/after comparison, in exactly two circumstances -- never as a
 * blanket "this is the mount render" or "this is the post-action render"
 * flag:
 *
 *  - **A fresh win**: immediately after recording a qualifying action that
 *    took the streak from not-yet-counted-today to counted -- the day's
 *    first qualifying action. `streak` is the count *after* that action, so
 *    it is always positive here -- this produces `ignite` (or `milestone`
 *    when the new count is one of `MILESTONES`).
 *  - **A fresh death**: the one on-load check that compares the freshly
 *    loaded streak against what the caller last knew and finds it dropped to
 *    zero since the last visit. `streak` is 0 here and this produces `reset`.
 *
 * Every other evaluation passes `false` -- including a mount that finds the
 * streak still alive (nothing transitioned; it is read exactly like any
 * other quiet render, below), and every same-day action *after* the first
 * (so `ignite` never replays on a learner's second or third rep of the day).
 * A plain (`false`) evaluation is: `cold` at zero streak, `at-risk` once
 * either clock has passed `AT_RISK_LOCAL_HOUR` with nothing counted yet
 * today (see the two-clock note below), and `lit` otherwise -- including a
 * positive streak earlier in the day that has not yet been extended, which
 * is not yet urgent and never rendered as if it were (spec 7.4: no
 * countdown, no guilt trip before there is a real risk).
 *
 * `localHour` and `utcHour` are both read for "at risk" (Important 4, fix
 * round 1): the streak day itself rolls on a UTC date key (spec 7.4's
 * server-clock ruling; `RewardContext.today` is a UTC key), so the real
 * deadline is the UTC roll, not the learner's local evening. A learner east
 * of UTC (Doha, UTC+3) can be two hours from losing the streak at 01:00
 * local -- `localHour` alone would read `lit` right up to the moment it
 * dies. Either clock crossing the hour is enough, so the cue still reads as
 * "your evening" for a learner near UTC while never staying quiet for one
 * whose local clock rolled into a new day before the streak's UTC day did.
 */
export function flameState(
  streak: number,
  countedToday: boolean,
  localHour: number,
  utcHour: number,
  justTransitioned: boolean,
): FlameState {
  if (justTransitioned && streak <= 0) return 'reset'
  if (streak <= 0) return 'cold'
  if (justTransitioned) return MILESTONES.includes(streak) ? 'milestone' : 'ignite'
  if (!countedToday && (localHour >= AT_RISK_LOCAL_HOUR || utcHour >= AT_RISK_LOCAL_HOUR)) return 'at-risk'
  return 'lit'
}

/**
 * The largest milestone strictly greater than `before` and reached by
 * `after`, or null when none was crossed (including when the streak did not
 * move forward at all -- a reset-and-restart that lands lower than before is
 * never reported as "crossing" anything).
 */
export function crossedMilestone(before: number, after: number): number | null {
  if (after <= before) return null
  const crossed = MILESTONES.filter((milestone) => before < milestone && milestone <= after)
  return crossed.length > 0 ? Math.max(...crossed) : null
}
