/**
 * The two write-side helpers `newlyUnlocked` (achievements.ts) and
 * `shouldRecordGoalDay`/`nextGoalDays` (goal.ts) never had: something that
 * actually persists, invalidates the cache, and fires the celebration.
 * X1 / W2-SCHEMA-C2 and X7 (v2-wave2-review.md sections 3 and 6).
 *
 * Both functions here share one shape, deliberately mirroring the pattern
 * `useExerciseLoop.ts`'s local `recordGoalAndStreak` already established
 * (read-or-build the context the caller already has, write, invalidate,
 * celebrate) so a caller migrating onto these reads as a straight swap, not
 * a redesign: build a `RewardContext` (`buildRewardContext`, context.ts),
 * call one of these, done. Both degrade silently on any failure -- a missed
 * achievement or goal day is a missed celebration, never a broken pass, a
 * broken walkthrough completion, or a broken de-rot run.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Achievement } from '@/lib/contracts'
import { getQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { prefsPatch } from '@/lib/wellness/prefs'
import { newlyUnlocked } from './achievements'
import type { RewardContext } from './context'
import { nextGoalDays, shouldRecordGoalDay } from './goal'
import { celebrate } from './useCelebration'

/**
 * Postgres/PostgREST codes for "the object being asked for is not there
 * yet" -- mirrors `src/app/(app)/layout.tsx`'s `MISSING_OBJECT_CODES`
 * (that file is outside this lane's owned paths, so this is a deliberate,
 * small duplication rather than a shared import across an ownership
 * boundary). `user_achievements` does not exist at schema 0005; migration
 * 0007 adds it. Only these codes degrade to "nothing unlocked yet" --
 * anything else (permission denied, a network failure, an expired JWT)
 * is a real error this still surfaces to the console, not a silent 0005 no-op.
 */
const MISSING_OBJECT_CODES = new Set(['42P01', 'PGRST205', '42883', 'PGRST202'])

function isMissingObjectError(err: { code?: string } | null | undefined): boolean {
  return err != null && typeof err.code === 'string' && MISSING_OBJECT_CODES.has(err.code)
}

/**
 * Unlocks whatever `ctx` newly qualifies for and is not already in `held`,
 * writes it, and celebrates only what was actually created.
 *
 * Ruling (X1, blocking caveat carried): `held` may be a stale, cold-cache
 * read -- this never celebrates off a client-side diff against it. The
 * insert is `upsert(..., { ignoreDuplicates: true })` (a plain POST, valid
 * against migration 0007's insert-only policy) with `.select()` on the
 * returned representation: PostgREST hands back only the rows the insert
 * actually created, never the ones that already existed. A repeated call
 * for an achievement already unlocked (a retried effect, a second call site
 * evaluating the same context) therefore always resolves to an empty
 * `created` list and celebrates nothing a second time, regardless of what
 * `held` said going in.
 *
 * No-ops (returns `[]`, no throw) when `user_achievements` does not exist
 * yet (schema 0005) -- `isMissingObjectError`.
 */
export async function recordAchievements(
  client: SupabaseClient,
  userId: string,
  ctx: RewardContext,
  held: readonly string[],
): Promise<Achievement[]> {
  const candidates = newlyUnlocked(ctx, held)
  if (candidates.length === 0) return []
  try {
    const rows = candidates.map((achievement) => ({ user_id: userId, achievement_id: achievement.id }))
    const { data, error } = await client
      .from('user_achievements')
      .upsert(rows, { onConflict: 'user_id,achievement_id', ignoreDuplicates: true })
      .select('achievement_id')
    if (error) {
      if (isMissingObjectError(error)) return []
      throw error
    }
    const createdIds = new Set((data ?? []).map((row) => (row as { achievement_id: string }).achievement_id))
    const created = candidates.filter((achievement) => createdIds.has(achievement.id))
    if (created.length === 0) return created
    void getQueryClient().invalidateQueries({ queryKey: qk.achievements(userId) })
    for (const achievement of created) {
      celebrate('achievement', { skill: achievement.id }, `${userId}:achievement:${achievement.id}`)
    }
    return created
  } catch (err) {
    if (isMissingObjectError(err as { code?: string } | null | undefined)) return []
    console.warn('Could not record achievements; the pass itself is unaffected.', err)
    return []
  }
}

/**
 * Call-site recipe for `recordAchievements` (report step d):
 *
 * ```ts
 * import { recordAchievements } from '@/lib/rewards/record'
 * const ctx = buildRewardContext({ state, attempts, activityDays, lessonProgress, drillResults, prefs, courseLessonCounts, now: new Date(attempt.createdAt) })
 * void recordAchievements(client, userId, ctx, heldAchievementIds)
 * ```
 */

/**
 * The once-per-day goal write: applies `shouldRecordGoalDay`, persists the
 * appended `goalDays` (`nextGoalDays`, already deduped and capped) onto
 * `wellness.prefs`, invalidates the cache, and fires `goal.done` -- once.
 *
 * Naming note (deliberate, flagged for the report): `src/lib/wellness/
 * prefs.ts` already exports a pure `recordGoalDay(days, dateKey): string[]`
 * (append-dedupe-cap on a plain array, no I/O). This is a different function
 * with the same name in a different module: the brief names this helper
 * `recordGoalDay` specifically, and the two are never imported into the same
 * file today (this one calls `nextGoalDays` from `./goal`, which already
 * wraps the pure one). A file that ever needs both must alias one on import.
 *
 * Same update-then-insert-if-absent shape `useExerciseLoop.ts`'s local
 * `recordGoalAndStreak` uses, and the same once-per-day eventId
 * (`${userId}:goal:${ctx.today}`) it already fires -- a caller migrating
 * onto this reads as a straight swap. Returns whether a goal day was
 * actually recorded, mainly for tests; callers do not need to await it.
 */
export async function recordGoalDay(client: SupabaseClient, userId: string, ctx: RewardContext): Promise<boolean> {
  if (!shouldRecordGoalDay(ctx)) return false
  const goalDays = nextGoalDays(ctx)
  if (!goalDays) return false
  try {
    const patch = prefsPatch({ ...ctx.prefs, goalDays })
    const updated = await client
      .from('wellness')
      .update({ prefs: patch, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle()
    if (updated.error) throw updated.error
    if (!updated.data) {
      const inserted = await client.from('wellness').insert({ user_id: userId, prefs: patch })
      if (inserted.error) throw inserted.error
    }
    void getQueryClient().invalidateQueries({ queryKey: qk.wellness(userId) })
    celebrate('goal', undefined, `${userId}:goal:${ctx.today}`)
    return true
  } catch (err) {
    console.warn("Could not record today's goal; the pass itself is unaffected.", err)
    return false
  }
}

/**
 * Call-site recipe for `recordGoalDay` (X7 fix):
 *
 * ```ts
 * import { recordGoalDay } from '@/lib/rewards/record'
 * const ctx = buildRewardContext({ state, attempts, activityDays, lessonProgress, drillResults, prefs, courseLessonCounts, now: new Date() })
 * void recordGoalDay(client, userId, ctx)
 * ```
 *
 * The one thing every call site must get right: build `ctx` with the REAL
 * `lessonProgress` and `drillResults` for today, not empty arrays -- an
 * exercise-pass call site that still hands this empty `lessonProgress`/
 * `drillResults` (as `useExerciseLoop.ts`'s current local version does)
 * reproduces X7 exactly, just one layer down.
 */
