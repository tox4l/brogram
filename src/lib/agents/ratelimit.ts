import type { AgentName, AgentTrigger } from '@/lib/contracts'
import { LOCKDOWN } from '@/lib/contracts'
import { serviceClient } from '@/lib/supabase/server'

/** The judge shares the limiter so one student cannot burn the Java quota. */
export type RateName = AgentName | 'judge'

export interface RateDecision {
  ok: boolean
  message: string
}

const HOUR = 3_600_000

const LIMITS: Record<RateName, { max: number; windowMs: number }> = {
  coach: { max: 1, windowMs: 60_000 },
  buddy: { max: 20, windowMs: HOUR },
  author: { max: 10, windowMs: HOUR },
  judge: { max: 30, windowMs: HOUR },
  profiler: { max: 60, windowMs: HOUR },
  planner: { max: 60, windowMs: HOUR },
  diagnoser: { max: 60, windowMs: HOUR },
  reviewer: { max: 60, windowMs: HOUR },
}

const buckets = new Map<string, { count: number; startedAt: number }>()

/** In-memory buckets, backstopped by agent_usage so a redeploy does not hand out a fresh allowance. */
export async function checkRate(userId: string, agent: RateName, trigger?: AgentTrigger, exerciseId?: string): Promise<RateDecision> {
  // a fresh failure reopens the hint window; the per-exercise cap still applies
  if (trigger === 'attempt-failed') buckets.delete(`${userId}:coach`)

  const limit = LIMITS[agent]
  const key = `${userId}:${agent}`
  const now = Date.now()
  const previous = buckets.get(key)
  const bucket = previous && now - previous.startedAt < limit.windowMs ? previous : { count: 0, startedAt: now }
  const window = limit.windowMs === HOUR ? 'hour' : `${limit.windowMs / 1000} seconds`
  if (bucket.count >= limit.max) return { ok: false, message: `${agent} is limited to ${limit.max} per ${window}` }

  const svc = serviceClient()
  if (agent === 'coach' && exerciseId) {
    const { data } = await svc
      .from('attempts')
      .select('hint_count')
      .eq('user_id', userId)
      .eq('exercise_id', exerciseId)
      .order('created_at', { ascending: false })
      .limit(1)
    const spent = data?.[0]?.hint_count ?? 0
    if (spent >= LOCKDOWN.maxHintsPerExercise) {
      return { ok: false, message: `you have used all ${LOCKDOWN.maxHintsPerExercise} hints for this exercise` }
    }
  }

  const hourlyMax = Math.ceil((limit.max * HOUR) / limit.windowMs)
  const { count } = await svc
    .from('agent_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('agent', agent)
    .gt('created_at', new Date(now - HOUR).toISOString())
  if ((count ?? 0) >= hourlyMax) return { ok: false, message: `${agent} is limited to ${hourlyMax} per hour` }

  bucket.count += 1
  buckets.set(key, bucket)
  return { ok: true, message: '' }
}
