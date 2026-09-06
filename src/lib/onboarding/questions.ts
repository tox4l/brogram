import { PHASE1, PHASE2 } from './derive'

export interface OnboardingQuestion {
  id: string
  phase: 1 | 2
  text: string
  options: { label: string; value: string }[]
}

/**
 * The whole onboarding flow, six questions, ships in the client bundle (spec 4.1): four from the
 * Profiler's own phase-1 fallback fixture, two from its hardcoded phase-2 set — both re-exported
 * unchanged from `src/lib/onboarding/derive.ts`, which is itself the single place `profiler.ts`
 * reads them from, so the local bank and the agent's fallback can never drift apart
 * (`questions.test.ts` asserts the identity directly against `derive.ts`'s exports).
 *
 * The four phase-1 questions are the fixture's first four, pinned by id (`p1f1`..`p1f4`) rather than
 * a positional slice, so reordering or inserting a fixture entry cannot silently change which four
 * a learner sees (fix round 1, Minor M1) — the fixture's fifth question is unused. The two phase-2
 * questions are `p2q1` (motivation.why, and motivation.depth — derived locally in
 * `derive.ts#provisionalProfile`, fix round 1 I1) and `p2q5` (tone) — the two phase-2 concepts a
 * learner answers directly in onboarding. `p2q2` (beyondCourses), `p2q4` (wantsAgenticCoding) and
 * `p2q6` (verbosity) are cut per R4.1 and permanently defaulted, moved to Account / the Buddy.
 */
const PHASE1_IDS = ['p1f1', 'p1f2', 'p1f3', 'p1f4']
const PHASE2_IDS = ['p2q1', 'p2q5']

function findOrThrow<T extends { id: string }>(bank: readonly T[], id: string): T {
  const question = bank.find((candidate) => candidate.id === id)
  if (!question) throw new Error(`onboarding questions.ts: "${id}" is not in its source bank`)
  return question
}

export const QUESTIONS: readonly OnboardingQuestion[] = [
  ...PHASE1_IDS.map((id): OnboardingQuestion => {
    const question = findOrThrow(PHASE1, id)
    return {
      id: question.id,
      phase: 1,
      text: question.text,
      options: question.options.map((option) => ({ label: option.text, value: option.text })),
    }
  }),
  ...PHASE2_IDS.map((id): OnboardingQuestion => {
    const question = findOrThrow(PHASE2, id)
    return {
      id: question.id,
      phase: 2,
      text: question.text,
      options: question.options.map((label) => ({ label, value: label })),
    }
  }),
]

export const MAX_QUESTIONS = 6
