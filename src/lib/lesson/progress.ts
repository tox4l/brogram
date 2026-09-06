/**
 * Pure progress math for lesson walkthroughs. Reducer-shaped: every event
 * folds a previous `LessonProgress` (or none) into the next one. No I/O, no
 * agent, no clock reads -- `now` is always passed in.
 *
 * `nextProgress` does not assign `userId`: it is threaded straight through
 * from `prev` when one exists. When `prev` is null (the 'opened' event
 * seeding a brand-new row) it is left as `''`; the caller owns attaching the
 * authenticated user id before persisting, the same way it owns the primary
 * key on insert.
 */
import type { CloId, LessonProgress, LessonPublic } from '@/lib/contracts'

export type LessonEvent =
  | { type: 'opened'; lesson: LessonPublic }
  | { type: 'block-advanced'; index: number }
  | { type: 'check'; right: boolean }
  | { type: 'completed' }
  | { type: 'skipped' }

export function lessonStatus(p: LessonProgress | null): 'unseen' | 'started' | 'completed' | 'skipped' {
  return p ? p.status : 'unseen'
}

/** lessonVersion < lesson.version. */
export function isStale(p: LessonProgress, lesson: LessonPublic): boolean {
  return p.lessonVersion < lesson.version
}

function freshProgress(userId: string, lesson: LessonPublic, now: string): LessonProgress {
  return {
    userId,
    lessonId: lesson.id as CloId,
    cloId: lesson.cloId,
    status: 'started',
    blockIndex: 0,
    checksPassed: 0,
    checksFailed: 0,
    lessonVersion: lesson.version,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
  }
}

function requirePrev(prev: LessonProgress | null, event: LessonEvent['type']): LessonProgress {
  if (!prev) throw new Error(`lesson progress event "${event}" requires the lesson to already be opened`)
  return prev
}

export function nextProgress(prev: LessonProgress | null, event: LessonEvent, now: string): LessonProgress {
  switch (event.type) {
    case 'opened': {
      if (!prev || isStale(prev, event.lesson)) {
        return freshProgress(prev?.userId ?? '', event.lesson, now)
      }
      // Reopening current content never regresses a finished lesson; anything
      // else (started, skipped) reopens as started.
      return { ...prev, status: prev.status === 'completed' ? 'completed' : 'started', updatedAt: now }
    }
    case 'block-advanced': {
      const cur = requirePrev(prev, event.type)
      return { ...cur, blockIndex: event.index, updatedAt: now }
    }
    case 'check': {
      const cur = requirePrev(prev, event.type)
      return {
        ...cur,
        checksPassed: cur.checksPassed + (event.right ? 1 : 0),
        checksFailed: cur.checksFailed + (event.right ? 0 : 1),
        updatedAt: now,
      }
    }
    case 'completed': {
      const cur = requirePrev(prev, event.type)
      return { ...cur, status: 'completed', completedAt: now, updatedAt: now }
    }
    case 'skipped': {
      const cur = requirePrev(prev, event.type)
      if (cur.status === 'completed') return { ...cur, updatedAt: now }
      return { ...cur, status: 'skipped', updatedAt: now }
    }
  }
}
