import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, LearnerState } from '@/lib/contracts'
import { QUESTIONS } from '@/lib/onboarding/questions'
import Onboarding from './page'

/**
 * Rewritten for T1.5: the flow this file tested (up to 13 questions, one blocking Profiler call
 * per answer, an inline course picker and Planner call) is replaced (spec R1.3, R1.4, R4.1-R4.4).
 * Guarantees carried over from the previous suite, re-asserted here against the new flow:
 *   - cumulative answers are sent to the Profiler (now once, not per-question);
 *   - a profile delta's `motivation` merges key-by-key over what the learner already has, never
 *     replacing the object outright;
 *   - the `learner_state` write is the same version-guarded upsert, landing at `version + 1` with
 *     `onboardingComplete: true`.
 * "Error recovery" (the old retry-with-alert UI) no longer applies to this page: the only network
 * call left in onboarding is the single background Profiler refinement, which by design never
 * surfaces an error to the learner (spec R4.2.5) — course selection and its own error recovery
 * move to `/courses` (T1.6).
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(), call: vi.fn(), from: vi.fn(), push: vi.fn(), redirect: vi.fn(), setLearnerState: vi.fn(),
}))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), redirect: mocks.redirect }))
vi.mock('@/lib/agents/client', () => ({ callAgent: mocks.call }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: mocks.from }) }))

const envelope = (reply: unknown, fallback = false): AgentEnvelope<unknown> => ({
  ok: true, agent: 'profiler', reply, fallback, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 },
})

type Row = Record<string, unknown>
let learnerStateRows: Row[]

function baseLearnerState(overrides: Partial<{ version: number; onboardingComplete: boolean }> = {}): LearnerState {
  return {
    userId: 'student',
    profile: {
      displayName: 'Maya',
      learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive',
      verbosity: 'short',
      motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: overrides.onboardingComplete ?? false,
    },
    currentCourse: null,
    path: [],
    nextExerciseIds: [],
    mastery: {},
    recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0,
    integrityScore: 0,
    accountStatus: 'active',
    version: overrides.version ?? 4,
    updatedAt: '2026-09-05T09:00:00Z',
  }
}

function session(overrides: Partial<{ version: number; onboardingComplete: boolean }> = {}) {
  return {
    user: { id: 'student' },
    profile: { id: 'student', account_status: 'active', restricted_until: null },
    learnerState: baseLearnerState(overrides),
    setLearnerState: mocks.setLearnerState,
  }
}

/** A minimal Supabase query-builder fake, just enough for the `learner_state` read-modify-write in `writeLearnerState`. */
function learnerStateBuilder() {
  let action: 'read' | 'insert' | 'update' = 'read'
  let payload: Row | undefined
  const eqValues: Record<string, unknown> = {}
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { eqValues[key] = value; return builder },
    maybeSingle: () => builder,
    insert: (value: Row) => { action = 'insert'; payload = value; return builder },
    update: (value: Row) => { action = 'update'; payload = value; return builder },
    then: (resolve: (result: { data: unknown; error: null }) => unknown) => {
      if (action === 'insert') {
        const row = { ...payload! }
        learnerStateRows.push(row)
        return Promise.resolve(resolve({ data: { version: row.version }, error: null }))
      }
      if (action === 'update') {
        const found = learnerStateRows.filter((row) => Object.entries(eqValues).every(([k, v]) => row[k] === v))
        found.forEach((row) => Object.assign(row, payload))
        return Promise.resolve(resolve({ data: found.length ? { version: found[0].version } : null, error: null }))
      }
      const found = learnerStateRows.find((row) => Object.entries(eqValues).every(([k, v]) => row[k] === v))
      return Promise.resolve(resolve({ data: found ?? null, error: null }))
    },
  }
  return builder
}

function currentRow(): LearnerState {
  const row = learnerStateRows.find((entry) => entry.user_id === 'student')!
  return row.state as LearnerState
}

/** Answers the first five questions with each question's first option, advancing past the option-fill delay each time. */
async function answerFirstFive() {
  for (let i = 0; i < 5; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: QUESTIONS[i].options[0].label }))
    await screen.findByText(QUESTIONS[i + 1].text)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  learnerStateRows = [{ user_id: 'student', state: baseLearnerState(), version: 4 }]
  mocks.session.mockReturnValue(session())
  mocks.from.mockImplementation(() => learnerStateBuilder())
})
afterEach(cleanup)

describe('onboarding', () => {
  it('shows exactly the first of six local questions on mount and calls no agent', () => {
    render(<Onboarding />)
    expect(screen.getByText(QUESTIONS[0].text)).toBeTruthy()
    expect(QUESTIONS).toHaveLength(6)
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
    const progress = screen.getByRole('img', { name: 'Question 1 of 6' })
    expect(progress.children).toHaveLength(6)
  })

  it('focuses the first option so the flow is usable by keyboard alone', () => {
    render(<Onboarding />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: QUESTIONS[0].options[0].label }))
  })

  it('answers questions one through five entirely locally: zero agent calls, each tap advances the card', async () => {
    render(<Onboarding />)
    await answerFirstFive()
    expect(screen.getByText(QUESTIONS[5].text)).toBeTruthy()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('fires exactly one Profiler call on the sixth answer and advances to /courses without awaiting it', async () => {
    let resolveCall!: (value: AgentEnvelope<unknown>) => void
    mocks.call.mockImplementationOnce(() => new Promise((resolve) => { resolveCall = resolve }))
    render(<Onboarding />)
    await answerFirstFive()

    fireEvent.click(screen.getByRole('button', { name: QUESTIONS[5].options[0].label }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/courses'))

    // The stage has already advanced; only now do we resolve the still-pending call.
    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ agent: 'profiler', trigger: 'onboarding-answer', phase: 2 }))
    const request = mocks.call.mock.calls[0][0]
    expect(request.answers).toEqual(QUESTIONS.map((q) => ({ questionId: q.id, answer: q.options[0].label })))

    resolveCall(envelope({ nextQuestion: null, done: true, profileDelta: {} }))
    await waitFor(() => expect(currentRow().version).toBe(5))
    expect(currentRow().profile.onboardingComplete).toBe(true)
  })

  it('completes onboarding with the provisional profile and onboardingComplete: true when the Profiler call rejects', async () => {
    mocks.call.mockRejectedValueOnce(new Error('upstream unavailable'))
    render(<Onboarding />)
    await answerFirstFive()
    fireEvent.click(screen.getByRole('button', { name: QUESTIONS[5].options[0].label }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/courses'))
    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true))
    expect(currentRow().version).toBe(5)
    // Locally-scored values from the taps above stand: p2q1's first option is "To pass my
    // courses" (motivation.why) and p2q5's first option is "Playful" (tone).
    expect(currentRow().profile.motivation.why).toBe('To pass my courses')
    expect(currentRow().profile.tone).toBe('playful')
    expect(mocks.setLearnerState).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }))
  })

  it('merges a genuine (non-fallback) Profiler reply over the provisional profile, motivation key-by-key', async () => {
    mocks.call.mockResolvedValueOnce(envelope({ nextQuestion: null, done: true, profileDelta: { tone: 'direct', motivation: { depth: 'master' } } }, false))
    render(<Onboarding />)
    await answerFirstFive()
    fireEvent.click(screen.getByRole('button', { name: QUESTIONS[5].options[0].label }))

    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true))
    expect(currentRow().profile.tone).toBe('direct')
    expect(currentRow().profile.motivation.depth).toBe('master')
    // `why` was decided locally by the p2q1 tap and must survive a delta that only carries `depth`.
    expect(currentRow().profile.motivation.why).toBe('To pass my courses')
  })

  it('treats a fallback reply (AGENT_DRY_RUN or an exhausted retry) like a failure: the provisional profile stands', async () => {
    mocks.call.mockResolvedValueOnce(envelope({ nextQuestion: null, done: true, profileDelta: { tone: 'direct' } }, true))
    render(<Onboarding />)
    await answerFirstFive()
    fireEvent.click(screen.getByRole('button', { name: QUESTIONS[5].options[0].label }))

    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true))
    expect(currentRow().profile.tone).toBe('playful')
  })

  it('redirects to /courses and renders no question when onboardingComplete is already true', () => {
    mocks.session.mockReturnValue(session({ onboardingComplete: true }))
    render(<Onboarding />)
    expect(mocks.redirect).toHaveBeenCalledWith('/courses')
    expect(screen.queryByText(QUESTIONS[0].text)).toBeNull()
    expect(mocks.call).not.toHaveBeenCalled()
  })
})
