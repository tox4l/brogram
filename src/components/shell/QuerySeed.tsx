'use client'

import { useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Attempt, LearnerState, LessonProgress, UserAchievement } from '@/lib/contracts'
import type { WellnessRow } from '@/lib/learner/compile'
import { resetQueryClientForUser } from '@/lib/query/client'
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

type SeedableField = Exclude<keyof QuerySeedProps, 'userId'>
const SEEDABLE_FIELDS: readonly SeedableField[] = ['learnerState', 'attempts', 'wellness', 'lessonProgress', 'achievements', 'activityDays']

function writeField(queryClient: QueryClient, userId: string, field: SeedableField, props: QuerySeedProps) {
  if (field === 'learnerState') queryClient.setQueryData(qk.learnerState(userId), props.learnerState)
  else if (field === 'attempts') queryClient.setQueryData(qk.attempts(userId), props.attempts)
  else if (field === 'wellness') queryClient.setQueryData(qk.wellness(userId), props.wellness)
  else if (field === 'lessonProgress') queryClient.setQueryData(qk.lessonProgress(userId), props.lessonProgress)
  else if (field === 'achievements') queryClient.setQueryData(qk.achievements(userId), props.achievements)
  else if (field === 'activityDays') queryClient.setQueryData(qk.activityDays(userId), props.activityDays)
}

/**
 * Seeds the TanStack Query cache with rows `(app)/layout.tsx` already fetched
 * server-side, before paint — and keeps re-seeding as the layout's own props
 * change across renders, rather than seeding once and going stale:
 *
 * - The first render always seeds every prop it was actually given.
 * - A later render for the *same* user whose payload reference changed (a
 *   `router.refresh()`, a soft navigation that re-renders the layout with
 *   fresh server rows) re-seeds just the fields whose reference differs from
 *   what was last seeded — a `!==` check per field, never a deep-equality
 *   walk of the whole payload.
 * - A *different* user first clears the previous user's cache
 *   (`resetQueryClientForUser`), so an `Infinity`-`gcTime` key can never
 *   survive a client-side account switch, then force-reseeds every field the
 *   new render was given. The caller should also key this component on
 *   `userId` (as `SessionProvider` already does) so a user change gets a
 *   clean mount rather than relying on this alone.
 *
 * This runs during render — comparing against state captured on a previous
 * render, React's own documented pattern for "adjusting state when a prop
 * changes" — not inside `useEffect`, so the very first paint already reads
 * the seeded data. Renders nothing.
 */
export function QuerySeed(props: QuerySeedProps) {
  const queryClient = useQueryClient()
  const [seeded, setSeeded] = useState<QuerySeedProps | null>(null)
  resetQueryClientForUser(props.userId)

  const userChanged = seeded === null || seeded.userId !== props.userId
  const toSeed = SEEDABLE_FIELDS.filter((field) => props[field] !== undefined && (userChanged || props[field] !== seeded![field]))

  if (toSeed.length > 0) {
    for (const field of toSeed) writeField(queryClient, props.userId, field, props)
    setSeeded(props)
  }

  return null
}
