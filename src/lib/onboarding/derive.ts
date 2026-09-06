import type { LearnerProfile, ProfilerReply, ProfilerRequest } from '@/lib/contracts'
import fallbackQuestions from '@/lib/agents/fixtures/profiler-fallback.json'

/**
 * Everything the Profiler builds up except displayName, which the profile row already owns.
 * Moved here (T1.5) from `src/app/(app)/onboarding/lib.ts` so both the onboarding page and this
 * module's own pure scorers share one definition.
 */
export type WorkingProfile = Omit<LearnerProfile, 'displayName'>

export const INITIAL_PROFILE: WorkingProfile = {
  learningStyle: 'mixed',
  styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
  tone: 'supportive',
  verbosity: 'short',
  motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
  onboardingComplete: false,
}

type StyleAxis = 'visual' | 'verbal' | 'example' | 'theory'
type FallbackQuestion = { id: string; text: string; options: { text: string; axis: StyleAxis }[] }

/**
 * The phase-1 question bank, straight from the fixture the Profiler's own fallback reads
 * (`src/lib/agents/fixtures/profiler-fallback.json`). `src/lib/onboarding/questions.ts` takes its
 * first four entries verbatim; `profiler.ts` imports `PHASE1` from here instead of the fixture
 * directly so there is exactly one place that resolves an id to its scoring axis.
 */
export const PHASE1: FallbackQuestion[] = fallbackQuestions.questions as FallbackQuestion[]

/**
 * The phase-2 question bank, moved verbatim out of `src/lib/agents/profiler.ts:53-60` (T1.5 step
 * 3) so the client can read it without importing the agent module. `profiler.ts` imports this
 * exact array back — one implementation, never two copies to drift apart. Do not reorder, reword,
 * or re-id these: `src/lib/agents/profiler.test.ts` (unowned by this task) pins `profiler.fallback`'s
 * behaviour against this exact shape.
 */
export const PHASE2 = [
  { id: 'p2q1', text: 'Why are you learning to code right now?', options: ['To pass my courses', 'To get good at this', 'To build something', 'I am not sure yet'] },
  { id: 'p2q2', text: 'Do you want to go beyond what your courses cover?', options: ['Yes', 'Only what the course needs', 'Ask me later'] },
  { id: 'p2q3', text: 'How deep do you want to go?', options: ['Pass', 'Understand', 'Master'] },
  { id: 'p2q4', text: 'Do you want to learn how to work with AI coding agents as part of this?', options: ['Yes', 'Not now'] },
  { id: 'p2q5', text: 'How should I talk to you?', options: ['Playful', 'Supportive', 'Tough love', 'Direct'] },
  { id: 'p2q6', text: 'Short answers or detailed ones?', options: ['Short', 'Detailed'] },
]

const TONE_BY_OPTION: Record<string, LearnerProfile['tone']> = {
  Playful: 'playful',
  Supportive: 'supportive',
  'Tough love': 'tough-love',
  Direct: 'direct',
}

/**
 * Every chosen option adds 0.2 to its axis, clamped to 1. Moved verbatim from `profiler.ts:70-81`
 * (T1.5 step 3): no behaviour change, only relocated so the client can call it directly.
 */
export function styleFromAnswers(answers: ProfilerRequest['answers']): Pick<LearnerProfile, 'styleVector' | 'learningStyle'> {
  const counts: Record<StyleAxis, number> = { visual: 0, verbal: 0, example: 0, theory: 0 }
  for (const a of answers) {
    const q = PHASE1.find(x => x.id === a.questionId)
    const option = q?.options.find(o => o.text === a.answer)
    if (option) counts[option.axis] += 1
  }
  const axis = (n: number) => Math.min(1, Math.round(n * 20) / 100)
  const styleVector = { visual: axis(counts.visual), verbal: axis(counts.verbal), example: axis(counts.example), theory: axis(counts.theory) }
  const learningStyle: LearnerProfile['learningStyle'] =
    styleVector.visual - styleVector.verbal >= 0.2 ? 'visual' : styleVector.verbal - styleVector.visual >= 0.2 ? 'verbal' : 'mixed'
  return { styleVector, learningStyle }
}

/**
 * Phase-2 answers map by question id and exact option text; only the keys those answers decided
 * are returned. Moved verbatim from `profiler.ts:85-101` (T1.5 step 3): the sparse shape is load
 * bearing — `src/lib/agents/profiler.test.ts:149` pins `{ why: '...' }` with no other motivation
 * keys present, because the live agent's own fallback merges this delta key-by-key onto whatever
 * the learner already has. `provisionalProfile` below is the one that fills in defaults for the
 * local-only path; this function itself must stay sparse.
 */
export function motivationFromAnswers(answers: ProfilerRequest['answers']): ProfilerReply['profileDelta'] {
  const delta: ProfilerReply['profileDelta'] = {}
  const motivation: NonNullable<ProfilerReply['profileDelta']['motivation']> = {}
  for (const a of answers) {
    const index = PHASE2.findIndex(q => q.id === a.questionId)
    switch (index) {
      case 0: motivation.why = a.answer; break
      case 1: motivation.beyondCourses = a.answer === 'Yes'; break
      case 2: motivation.depth = a.answer.toLowerCase() as 'pass' | 'understand' | 'master'; break
      case 3: motivation.wantsAgenticCoding = a.answer === 'Yes'; break
      case 4: delta.tone = TONE_BY_OPTION[a.answer] ?? 'direct'; break
      case 5: delta.verbosity = a.answer === 'Detailed' ? 'verbose' : 'short'; break
    }
  }
  if (Object.keys(motivation).length) delta.motivation = motivation
  return delta
}

/**
 * The whole six-question answer set, scored locally with zero network calls (spec R4.2):
 * style/learningStyle from the phase-1 answers, tone and whichever motivation keys the phase-2
 * answers decided, everything else (verbosity, beyondCourses, wantsAgenticCoding) at the
 * onboarding default because those questions were cut from the six (brief R4.1) — the Buddy and
 * Account own asking for them later, never onboarding again.
 */
export function provisionalProfile(answers: { questionId: string; answer: string }[]): WorkingProfile {
  const { styleVector, learningStyle } = styleFromAnswers(answers)
  const delta = motivationFromAnswers(answers)
  return {
    ...INITIAL_PROFILE,
    styleVector,
    learningStyle,
    tone: delta.tone ?? INITIAL_PROFILE.tone,
    verbosity: delta.verbosity ?? INITIAL_PROFILE.verbosity,
    motivation: delta.motivation ? { ...INITIAL_PROFILE.motivation, ...delta.motivation } : INITIAL_PROFILE.motivation,
  }
}
