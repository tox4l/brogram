import type { SupabaseClient } from '@supabase/supabase-js'
import type { LearnerState, ProfilerReply } from '@/lib/contracts'
import type { WorkingProfile } from '@/lib/onboarding/derive'

export function messageOf(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : 'Something went wrong. Try again.'
}

/**
 * Every field in `profileDelta` replaces the prior value outright, except `motivation`:
 * phase-2 answers arrive one key per turn, so an earlier key must survive a later delta
 * that only carries a different one. Used once, on the sixth answer, to fold a genuine
 * (non-fallback) Profiler reply over the locally-derived provisional profile (spec R4.2.4).
 */
export function mergeProfileDelta(prev: WorkingProfile, delta: ProfilerReply['profileDelta']): WorkingProfile {
  return {
    learningStyle: delta.learningStyle ?? prev.learningStyle,
    styleVector: delta.styleVector ?? prev.styleVector,
    tone: delta.tone ?? prev.tone,
    verbosity: delta.verbosity ?? prev.verbosity,
    motivation: delta.motivation ? { ...prev.motivation, ...delta.motivation } : prev.motivation,
    onboardingComplete: delta.onboardingComplete ?? prev.onboardingComplete,
  }
}

/**
 * The same read-modify-write, version-guarded upsert `useExerciseLoop` uses for
 * `learner_state`: read the current row, apply the delta, write back at `version + 1`
 * conditioned on the version just read, and retry a stale write a few times.
 */
export async function writeLearnerState(
  client: SupabaseClient,
  fallback: LearnerState,
  build: (base: LearnerState) => LearnerState,
): Promise<LearnerState> {
  const userId = fallback.userId
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await client.from('learner_state').select('state,version').eq('user_id', userId).maybeSingle()
    if (error) throw error
    const base: LearnerState = row?.state && row.state.mastery && row.state.profile && row.state.streak
      ? { ...row.state, version: row.version }
      : { ...fallback, version: row?.version ?? 0 }
    const changed = build(base)
    const nextState: LearnerState = { ...changed, userId, version: base.version + 1, updatedAt: new Date().toISOString() }
    const payload = { user_id: userId, state: nextState, version: nextState.version, updated_at: nextState.updatedAt }
    const write = row
      ? await client.from('learner_state').update(payload).eq('user_id', userId).eq('version', base.version).select('version').maybeSingle()
      : await client.from('learner_state').insert(payload).select('version').maybeSingle()
    if (write.error) {
      if ('code' in write.error && write.error.code === '23505') continue
      throw write.error
    }
    if (!write.data) continue
    return nextState
  }
  throw new Error('Progress changed elsewhere. Try again.')
}
