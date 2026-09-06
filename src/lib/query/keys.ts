/**
 * Every TanStack Query key BroGram uses, in one place, so an invalidation can
 * never miss a variant of a key that a call site built by hand and got
 * slightly wrong. Every call site imports `qk` rather than writing an array
 * literal; every mutation's `onSettledInvalidate` list is built from `qk` too.
 */

import type { CourseCode } from '@/lib/contracts'

export const qk = {
  curriculum: (code: CourseCode) => ['curriculum', code] as const,
  learnerState: (userId: string) => ['learner-state', userId] as const,
  attempts: (userId: string) => ['attempts', userId] as const,
  /** `/reports` only: 1000-row cap, narrow columns, fetched on tab open (spec 5.2). */
  reportAttempts: (userId: string) => ['report-attempts', userId] as const,
  activityDays: (userId: string) => ['activity-days', userId] as const,
  wellness: (userId: string) => ['wellness', userId] as const,
  lessonProgress: (userId: string) => ['lesson-progress', userId] as const,
  achievements: (userId: string) => ['achievements', userId] as const,
  integrityBreakdown: (userId: string) => ['integrity-breakdown', userId] as const,
} as const
