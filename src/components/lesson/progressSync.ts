import type { LessonProgress } from '@/lib/contracts'
import { createClient } from '@/lib/supabase/client'

/**
 * Production schema is 0005; `lesson_progress` (0006) is not applied there
 * yet, so every write in this module fails at the database today. That
 * failure must never lose a learner's answered check -- `LessonView` keeps
 * the render-driving `progress` state entirely in React state, independent
 * of whether this write ever lands, and queues the latest desired row here
 * so the very next time this lesson mounts, the write is retried before
 * anything else happens.
 */
const queueKey = (userId: string, lessonId: string) => `brogram:lesson-progress-queue:${userId}:${lessonId}`

export function queueProgress(userId: string, row: LessonProgress): void {
  try {
    window.localStorage.setItem(queueKey(userId, row.lessonId), JSON.stringify(row))
  } catch {
    // Storage may be disabled; the row still lives in this mount's React state.
  }
}

export function readQueuedProgress(userId: string, lessonId: string): LessonProgress | null {
  try {
    const raw = window.localStorage.getItem(queueKey(userId, lessonId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as LessonProgress) : null
  } catch {
    return null
  }
}

export function clearQueuedProgress(userId: string, lessonId: string): void {
  try {
    window.localStorage.removeItem(queueKey(userId, lessonId))
  } catch {
    // Best-effort only.
  }
}

/** One upsert on the primary key (user_id, lesson_id) -- the same shape
 *  `useLessonProgress`'s `mapLessonProgressRow` reads back. */
export async function persistLessonProgressRow(row: LessonProgress): Promise<void> {
  const client = createClient()
  const { error } = await client.from('lesson_progress').upsert({
    user_id: row.userId,
    lesson_id: row.lessonId,
    clo_id: row.cloId,
    status: row.status,
    block_index: row.blockIndex,
    checks_passed: row.checksPassed,
    checks_failed: row.checksFailed,
    lesson_version: row.lessonVersion,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    updated_at: row.updatedAt,
  }, { onConflict: 'user_id,lesson_id' })
  if (error) throw error
}
