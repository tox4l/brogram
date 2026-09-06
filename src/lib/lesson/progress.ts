/**
 * Pure progress math for lesson walkthroughs. Reducer-shaped: every event
 * folds a previous `LessonProgress` (or none) into the next one. No I/O, no
 * agent, no clock reads -- `now` is always passed in.
 *
 * `userId` travels on the 'opened' event -- the only event that can create a
 * row -- so a forgotten id is a compile error at the one call site that can
 * get it wrong, rather than a runtime `''` a caller has to remember to patch.
 */
import type { CloId, LessonProgress, LessonPublic } from '@/lib/contracts'

export type LessonEvent =
  | { type: 'opened'; lesson: LessonPublic; userId: string }
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
      if (!prev) return freshProgress(event.userId, event.lesson, now)
      if (isStale(prev, event.lesson)) {
        // Content was rewritten. Progress is never deleted (spec 3.2):
        // status, completedAt and check counters survive a version bump so a
        // content fix cannot silently un-finish a walkthrough or un-earn an
        // achievement. Only blockIndex resets -- an old index may point past
        // the rewritten block list -- and lessonVersion re-points at the
        // current content.
        return { ...prev, lessonVersion: event.lesson.version, blockIndex: 0, updatedAt: now }
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
      // A repeat 'completed' (a re-read that scrolls past the bridge block
      // again) must not mint a fresh completedAt -- that can manufacture a
      // daily-goal win for a day the lesson was not actually finished.
      return { ...cur, status: 'completed', completedAt: cur.completedAt ?? now, updatedAt: now }
    }
    case 'skipped': {
      const cur = requirePrev(prev, event.type)
      if (cur.status === 'completed') return { ...cur, updatedAt: now }
      return { ...cur, status: 'skipped', updatedAt: now }
    }
  }
}
