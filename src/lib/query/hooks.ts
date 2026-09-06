'use client'

/**
 * Client read hooks, each keyed on the signed-in user (spec 5.2). Stale
 * times come straight from the table there: `learner-state` and `attempts`
 * refresh in the background every 30s and evict after 5 minutes of no
 * observer; `wellness`, `lesson-progress`, `achievements` and `activity-days`
 * change only through a mutation this app itself makes, so they never go
 * stale on a timer.
 *
 * No agent call is ever a query (the seven-trigger rule, standing constraint
 * #2) — agent replies are one-shot `useMutation`s elsewhere, never listed here.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { Attempt, LearnerState, LessonProgress, UserAchievement } from '@/lib/contracts'
import type { WellnessRow } from '@/lib/learner/compile'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { qk } from './keys'

const THIRTY_SECONDS = 30_000
const FIVE_MINUTES = 300_000
const ATTEMPTS_CAP = 50

export type ActivityDay = { kind: 'exercise' | 'derot'; day: string }

function useUserId(): string | null {
  return useSession((session) => session.user?.id ?? null)
}

async function fetchLearnerState(userId: string): Promise<LearnerState> {
  const client = createClient()
  const { data, error } = await client.from('learner_state').select('state,version').eq('user_id', userId).maybeSingle()
  if (error) throw new Error('Unable to load your learning progress', { cause: error })
  const state = (data?.state as LearnerState | undefined) ?? null
  if (!state) throw new Error('No learning progress found yet')
  return { ...state, userId, version: data?.version ?? state.version }
}

function mapAttemptRow(row: Record<string, unknown>, userId: string): Attempt {
  return {
    id: String(row.id),
    userId,
    exerciseId: String(row.exercise_id),
    code: String(row.code ?? ''),
    results: (row.results as Attempt['results'] | null) ?? [],
    passed: row.passed === true,
    durationMs: Number(row.duration_ms ?? 0),
    hintCount: Number(row.hint_count ?? 0),
    createdAt: String(row.created_at),
  }
}

async function fetchAttempts(userId: string): Promise<Attempt[]> {
  const client = createClient()
  const { data, error } = await client
    .from('attempts')
    .select('id,exercise_id,code,results,passed,duration_ms,hint_count,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(ATTEMPTS_CAP)
  if (error) throw new Error('Unable to load your recent attempts', { cause: error })
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => mapAttemptRow(row, userId))
}

async function fetchActivityDays(): Promise<ActivityDay[]> {
  const client = createClient()
  const { data, error } = await client.rpc('my_activity_days')
  if (error) throw new Error('Unable to load your activity history', { cause: error })
  return ((data as { kind: string; day: string }[] | null) ?? []).map((row) => ({
    kind: row.kind === 'derot' ? 'derot' : 'exercise',
    day: row.day,
  }))
}

async function fetchWellness(userId: string): Promise<WellnessRow> {
  const client = createClient()
  const { data, error } = await client
    .from('wellness')
    .select('user_id,prefs,pomodoro_sessions,water_log,drill_results,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error('Unable to load your wellness settings', { cause: error })
  return (data as WellnessRow | null) ?? {}
}

function mapLessonProgressRow(row: Record<string, unknown>, userId: string): LessonProgress {
  return {
    userId,
    lessonId: String(row.lesson_id),
    cloId: String(row.clo_id),
    status: row.status as LessonProgress['status'],
    blockIndex: Number(row.block_index ?? 0),
    checksPassed: Number(row.checks_passed ?? 0),
    checksFailed: Number(row.checks_failed ?? 0),
    lessonVersion: Number(row.lesson_version ?? 1),
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
  }
}

async function fetchLessonProgress(userId: string): Promise<LessonProgress[]> {
  const client = createClient()
  const { data, error } = await client
    .from('lesson_progress')
    .select('lesson_id,clo_id,status,block_index,checks_passed,checks_failed,lesson_version,started_at,completed_at,updated_at')
    .eq('user_id', userId)
  if (error) throw new Error('Unable to load your walkthrough progress', { cause: error })
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => mapLessonProgressRow(row, userId))
}

function mapAchievementRow(row: Record<string, unknown>, userId: string): UserAchievement {
  return { userId, achievementId: String(row.achievement_id), unlockedAt: String(row.unlocked_at) }
}

async function fetchAchievements(userId: string): Promise<UserAchievement[]> {
  const client = createClient()
  const { data, error } = await client.from('user_achievements').select('achievement_id,unlocked_at').eq('user_id', userId)
  if (error) throw new Error('Unable to load your achievements', { cause: error })
  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => mapAchievementRow(row, userId))
}

export function useLearnerState(): UseQueryResult<LearnerState> {
  const userId = useUserId()
  return useQuery({
    queryKey: qk.learnerState(userId ?? ''),
    queryFn: () => fetchLearnerState(userId as string),
    enabled: userId !== null,
    staleTime: THIRTY_SECONDS,
    gcTime: FIVE_MINUTES,
  })
}

export function useAttempts(): UseQueryResult<Attempt[]> {
  const userId = useUserId()
  return useQuery({
    queryKey: qk.attempts(userId ?? ''),
    queryFn: () => fetchAttempts(userId as string),
    enabled: userId !== null,
    staleTime: THIRTY_SECONDS,
    gcTime: FIVE_MINUTES,
  })
}

export function useActivityDays(): UseQueryResult<ActivityDay[]> {
  const userId = useUserId()
  return useQuery({
    queryKey: qk.activityDays(userId ?? ''),
    queryFn: fetchActivityDays,
    enabled: userId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function useWellness(): UseQueryResult<WellnessRow> {
  const userId = useUserId()
  return useQuery({
    queryKey: qk.wellness(userId ?? ''),
    queryFn: () => fetchWellness(userId as string),
    enabled: userId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function useLessonProgress(): UseQueryResult<LessonProgress[]> {
  const userId = useUserId()
  return useQuery({
    queryKey: qk.lessonProgress(userId ?? ''),
    queryFn: () => fetchLessonProgress(userId as string),
    enabled: userId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

export function useAchievements(): UseQueryResult<UserAchievement[]> {
  const userId = useUserId()
  return useQuery({
    queryKey: qk.achievements(userId ?? ''),
    queryFn: () => fetchAchievements(userId as string),
    enabled: userId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}
