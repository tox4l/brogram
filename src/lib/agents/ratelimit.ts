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
/** Hints handed out since the last failed attempt, keyed `${userId}:${exerciseId}`; the stored count is the floor. */
const hintsGiven = new Map<string, number>()

/** In-memory buckets, backstopped by agent_usage so a redeploy does not hand out a fresh allowance. */
export async function checkRate(userId: string, agent: RateName, trigger?: AgentTrigger, exerciseId?: string): Promise<RateDecision> {
  // a fresh failure reopens the hint window and the hints given since the last attempt row
  if (trigger === 'attempt-failed') {
    buckets.delete(`${userId}:coach`)
    if (exerciseId) hintsGiven.delete(`${userId}:${exerciseId}`)
  }

  const limit = LIMITS[agent]
  const key = `${userId}:${agent}`
  const now = Date.now()
  const previous = buckets.get(key)
  const bucket = previous && now - previous.startedAt < limit.windowMs ? previous : { count: 0, startedAt: now }
  buckets.set(key, bucket)
  const window = limit.windowMs === HOUR ? 'hour' : `${limit.windowMs / 1000} seconds`
  if (bucket.count >= limit.max) return { ok: false, message: `${agent} is limited to ${limit.max} per ${window}` }
  // spend the token before the first await, or a burst of parallel requests all pass the same check
  bucket.count += 1
  const release = () => { bucket.count -= 1 }

  const hintKey = `${userId}:${exerciseId}`
  try {
    const svc = serviceClient()
    if (agent === 'coach' && exerciseId) {
      const { data } = await svc
        .from('attempts')
        .select('hint_count')
        .eq('user_id', userId)
        .eq('exercise_id', exerciseId)
        .order('created_at', { ascending: false })
        .limit(1)
      // the stored count is what the last attempt recorded; the memory counter is the hints given since
      const spent = (data?.[0]?.hint_count ?? 0) + (hintsGiven.get(hintKey) ?? 0)
      if (spent >= LOCKDOWN.maxHintsPerExercise) {
        release()
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
    if ((count ?? 0) >= hourlyMax) {
      release()
      return { ok: false, message: `${agent} is limited to ${hourlyMax} per hour` }
    }

    if (agent === 'coach' && exerciseId) hintsGiven.set(hintKey, (hintsGiven.get(hintKey) ?? 0) + 1)
    return { ok: true, message: '' }
  } catch (e) {
    // a database that is down must not also cost the student their allowance for the window
    release()
    throw e
  }
}
