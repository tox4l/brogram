import type { SupabaseClient } from '@supabase/supabase-js'
import type { Clo, LearnerProfile, LearnerState, ProfilerReply } from '@/lib/contracts'
import fallbackQuestions from '@/lib/agents/fixtures/profiler-fallback.json'

/** Everything the Profiler builds up except displayName, which the profile row already owns. */
export type WorkingProfile = Omit<LearnerProfile, 'displayName'>

export const INITIAL_PROFILE: WorkingProfile = {
  learningStyle: 'mixed',
  styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
  tone: 'supportive',
  verbosity: 'short',
  motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
  onboardingComplete: false,
}

export type OnboardingQuestion = { id: string; text: string; options: string[] }

/**
 * The trigger is `onboarding-answer`: the Profiler is only ever asked for the *next*
 * question once an answer exists. The very first question the student ever sees is
 * therefore never fetched from the agent; it is the same fixed fallback question the
 * server itself would serve first, so the opening screen never waits on a network call.
 */
const firstFallback = fallbackQuestions.questions[0]
export const FIRST_QUESTION: OnboardingQuestion = {
  id: firstFallback.id,
  text: firstFallback.text,
  options: firstFallback.options.map((option) => option.text),
}

/** The client is told which phase it is in by the id prefix, not by a separate flag. */
export function phaseOfQuestion(id: string): 1 | 2 {
  return id.startsWith('p2') ? 2 : 1
}

/**
 * Every field in `profileDelta` replaces the prior value outright, except `motivation`:
 * phase-2 answers arrive one key per turn, so an earlier key must survive a later delta
 * that only carries a different one.
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

export function mapCloRow(row: Record<string, unknown>): Clo {
  return {
    id: String(row.id),
    course: String(row.course),
    ordinal: Number(row.ordinal),
    outcome: String(row.outcome),
    topics: (row.topics as string[]) ?? [],
    prerequisites: (row.prerequisites as string[]) ?? [],
    patterns: (row.patterns as string[]) ?? [],
    assessableInCode: row.assessable_in_code === true,
  }
}

export const LANGUAGE_LABELS: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', java: 'Java',
  sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript', cpp: 'C++', csharp: 'C#', php: 'PHP',
}

export function messageOf(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : 'Something went wrong. Try again.'
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
  throw new Error('Your progress changed elsewhere. Try again.')
}
