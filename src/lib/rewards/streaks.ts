/**
 * Flame states and milestones (spec section 7.4). Pure and total: every
 * input is a plain number or boolean the caller already has (the streak
 * count from `LearnerState.streak`, whether today is already counted, the
 * learner's local hour, and whether this evaluation follows a fresh
 * qualifying action) -- nothing here reads a clock or a calendar itself.
 *
 * Streak copy always frames keeping something good, never impending loss
 * (spec 7.4): no state here is a countdown, and nothing about "at risk" ever
 * turns into a number of hours left.
 */

export type FlameState = 'cold' | 'lit' | 'at-risk' | 'ignite' | 'milestone' | 'reset'

/** Streak lengths that get the bigger burst plus a milestone card (spec 7.4). */
export const MILESTONES: readonly number[] = [3, 7, 14, 30, 50, 100]

/** The hour (local, 24h) after which an uncounted streak reads as "at risk". */
const AT_RISK_LOCAL_HOUR = 18

/**
 * `justCounted` means this evaluation follows a transition worth flagging --
 * either a qualifying action that was just recorded, or the on-load check
 * that discovered the streak already broke since the last visit. The two
 * are told apart by the resulting `streak` value alone: landing on a
 * positive count means a win just landed (`ignite`, or `milestone` if that
 * count is one of `MILESTONES`); landing on zero means the streak just died
 * (`reset`). Outside of that transition, the state is a plain read of where
 * the streak already stands: `cold` at zero, `at-risk` once the local hour
 * has passed `AT_RISK_LOCAL_HOUR` with nothing counted yet today, and `lit`
 * otherwise -- including a positive streak earlier in the day that has not
 * yet been extended, which is not yet urgent and never rendered as if it
 * were (spec 7.4: no countdown, no guilt trip before there is a real risk).
 */
export function flameState(streak: number, countedToday: boolean, localHour: number, justCounted: boolean): FlameState {
  if (justCounted) {
    if (streak <= 0) return 'reset'
    return MILESTONES.includes(streak) ? 'milestone' : 'ignite'
  }
  if (streak <= 0) return 'cold'
  if (!countedToday && localHour >= AT_RISK_LOCAL_HOUR) return 'at-risk'
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
