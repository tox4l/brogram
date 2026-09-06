'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Attempt, LearnerState, LessonProgress, UserAchievement } from '@/lib/contracts'
import type { WellnessRow } from '@/lib/learner/compile'
import { qk } from '@/lib/query/keys'
import type { ActivityDay } from '@/lib/query/hooks'

export interface QuerySeedProps {
  userId: string
  learnerState?: LearnerState
  attempts?: Attempt[]
  wellness?: WellnessRow
  lessonProgress?: LessonProgress[]
  achievements?: UserAchievement[]
  activityDays?: ActivityDay[]
}

/**
 * Seeds the TanStack Query cache with rows `(app)/layout.tsx` already fetched
 * server-side, before the first paint. This runs inside `useState`'s lazy
 * initializer — which React calls synchronously during render, not after —
 * rather than `useEffect`, so the very first client render already reads the
 * seeded data instead of refetching everything the layout just did.
 *
 * This is the lighter documented alternative to `dehydrate`/`HydrationBoundary`
 * (spec 5.2): correct here because the layout reads through the Supabase
 * server client, not `fetch`. Only props actually supplied are seeded, so a
 * caller that has not fetched a given row yet (see the layout's own comment)
 * simply leaves that query to fetch on the client as usual. Renders nothing.
 */
export function QuerySeed(props: QuerySeedProps) {
  const queryClient = useQueryClient()
  useState(() => {
    const { userId, learnerState, attempts, wellness, lessonProgress, achievements, activityDays } = props
    if (learnerState !== undefined) queryClient.setQueryData(qk.learnerState(userId), learnerState)
    if (attempts !== undefined) queryClient.setQueryData(qk.attempts(userId), attempts)
    if (wellness !== undefined) queryClient.setQueryData(qk.wellness(userId), wellness)
    if (lessonProgress !== undefined) queryClient.setQueryData(qk.lessonProgress(userId), lessonProgress)
    if (achievements !== undefined) queryClient.setQueryData(qk.achievements(userId), achievements)
    if (activityDays !== undefined) queryClient.setQueryData(qk.activityDays(userId), activityDays)
    return null
  })
  return null
}
