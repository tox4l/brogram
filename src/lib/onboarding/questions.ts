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
 * The four phase-1 questions are the fixture's first four, in order (`p1f1`..`p1f4`); the fixture's
 * fifth question is unused. The two phase-2 questions are `p2q1` (motivation.why) and `p2q5`
 * (tone) — the two phase-2 concepts a learner answers directly in onboarding. `p2q3` (depth),
 * `p2q2` (beyondCourses), `p2q4` (wantsAgenticCoding) and `p2q6` (verbosity) are cut per R4.1:
 * depth keeps its onboarding default until a live Profiler reply refines it, and the other three
 * are permanently defaulted and moved to Account / the Buddy.
 */
const PHASE1_QUESTIONS = PHASE1.slice(0, 4)
const PHASE2_IDS = ['p2q1', 'p2q5']

export const QUESTIONS: readonly OnboardingQuestion[] = [
  ...PHASE1_QUESTIONS.map((question): OnboardingQuestion => ({
    id: question.id,
    phase: 1,
    text: question.text,
    options: question.options.map((option) => ({ label: option.text, value: option.text })),
  })),
  ...PHASE2_IDS.map((id): OnboardingQuestion => {
    const question = PHASE2.find((candidate) => candidate.id === id)!
    return {
      id: question.id,
      phase: 2,
      text: question.text,
      options: question.options.map((label) => ({ label, value: label })),
    }
  }),
]

export const MAX_QUESTIONS = 6
