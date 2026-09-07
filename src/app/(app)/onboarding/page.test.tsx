import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, LearnerState } from '@/lib/contracts'
import { qk } from '@/lib/query/keys'
import { QUESTIONS } from '@/lib/onboarding/questions'
import { readQueuedCompletion } from '@/lib/onboarding/completionQueue'
import Onboarding from './page'
import OnboardingLoading from './loading'

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
 *
 * Fix round 1 (Opus review) added: onboardingComplete is now persisted in its own write, started
 * immediately rather than after the Profiler call settles (Critical C1), and every write also
 * updates the TanStack Query cache `/courses` reads from (Important I2) — both covered below.
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(), call: vi.fn(), from: vi.fn(), push: vi.fn(), redirect: vi.fn(), setLearnerState: vi.fn(), toast: vi.fn(),
}))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), redirect: mocks.redirect }))
vi.mock('@/lib/agents/client', () => ({ callAgent: mocks.call }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('sonner', () => ({ toast: mocks.toast }))

// The first question's hook line renders through `<Reveal mode="chars"
// surface="onboarding-hook">` (W4.14 -- the onboarding hook is one of the two
// surfaces licensed for a character reveal), which calls the real
// `SplitText.create` under non-reduced motion. jsdom has no layout (SplitText
// measures real line boxes), so this suite mocks it exactly as
// src/components/motion/Reveal.test.tsx and src/components/lesson/lesson.test.tsx
// do -- shape-only, never invoking `onSplit` itself, which leaves the plain
// question text in place for every `getByText`/`getByRole('heading', ...)`
// query below.
const splitTextMocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('gsap/SplitText', () => ({ SplitText: { create: splitTextMocks.create } }))

const envelope = (reply: unknown, fallback = false): AgentEnvelope<unknown> => ({
  ok: true, agent: 'profiler', reply, fallback, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 },
})

type Row = Record<string, unknown>
let learnerStateRows: Row[]
let queryClient: QueryClient
/** Consumed one at a time by the next `insert`/`update` call, to simulate a transient write failure (Wave 1 gate I3). */
let failNextWrites = 0

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
    then: (resolve: (result: { data: unknown; error: { message: string } | null }) => unknown) => {
      if (action === 'insert' || action === 'update') {
        if (failNextWrites > 0) {
          failNextWrites -= 1
          return Promise.resolve(resolve({ data: null, error: { message: 'network blip' } }))
        }
      }
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

function renderPage(ui: ReactElement = <Onboarding />) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/** Answers the first five questions with each question's first option, advancing past the option-fill delay each time. */
async function answerFirstFive() {
  for (let i = 0; i < 5; i += 1) {
    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[i].options[0].label }))
    await screen.findByText(QUESTIONS[i + 1].text)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  failNextWrites = 0
  learnerStateRows = [{ user_id: 'student', state: baseLearnerState(), version: 4 }]
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mocks.session.mockReturnValue(session())
  mocks.from.mockImplementation(() => learnerStateBuilder())
  splitTextMocks.create.mockReset().mockImplementation(() => ({ revert: vi.fn(), lines: [], words: [], chars: [] }))
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  // @ts-expect-error test-only cleanup of a global a couple of tests below own
  delete window.matchMedia
})

describe('onboarding', () => {
  it('shows exactly the first of six local questions on mount and calls no agent', () => {
    renderPage()
    expect(screen.getByText(QUESTIONS[0].text)).toBeTruthy()
    expect(screen.getByText('Question 1 of 6')).toBeTruthy()
    expect(QUESTIONS).toHaveLength(6)
    expect(mocks.call).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('focuses the card (not an option) so the heading is announced before any option', () => {
    renderPage()
    const heading = screen.getByRole('heading', { name: QUESTIONS[0].text })
    expect(document.activeElement?.contains(heading)).toBe(true)
  })

  it('answers questions one through five entirely locally: zero agent calls, each tap advances the card', async () => {
    renderPage()
    await answerFirstFive()
    expect(screen.getByText(QUESTIONS[5].text)).toBeTruthy()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('fires exactly one Profiler call on the sixth answer and persists onboardingComplete before that call ever resolves', async () => {
    let resolveCall!: (value: AgentEnvelope<unknown>) => void
    mocks.call.mockImplementationOnce(() => new Promise((resolve) => { resolveCall = resolve }))
    renderPage()
    await answerFirstFive()

    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/courses'))

    expect(mocks.call).toHaveBeenCalledTimes(1)
    expect(mocks.call).toHaveBeenCalledWith(expect.objectContaining({ agent: 'profiler', trigger: 'onboarding-answer', phase: 2 }))
    const request = mocks.call.mock.calls[0][0]
    expect(request.answers).toEqual(QUESTIONS.map((q) => ({ questionId: q.id, answer: q.options[0].label })))

    // Fix round 1 (Critical C1): the completing write must not depend on the Profiler call
    // resolving — assert it lands first, with the still-pending call never having been resolved.
    await waitFor(() => expect(currentRow().version).toBe(5))
    expect(currentRow().profile.onboardingComplete).toBe(true)
    expect(queryClient.getQueryData(qk.learnerState('student'))).toMatchObject({ version: 5, profile: { onboardingComplete: true } })

    resolveCall(envelope({ nextQuestion: null, done: true, profileDelta: {} }))
    await waitFor(() => expect(currentRow().version).toBe(5))
  })

  it('a reload between the completing write and the Profiler response never re-asks and never re-calls (fix round 1, C1)', async () => {
    let resolveCall!: (value: AgentEnvelope<unknown>) => void
    mocks.call.mockImplementationOnce(() => new Promise((resolve) => { resolveCall = resolve }))
    renderPage()
    await answerFirstFive()
    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))

    // The completing write has landed; the Profiler call is still pending.
    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true))
    expect(mocks.call).toHaveBeenCalledTimes(1)

    // Simulate a hard reload: a brand-new mount, backed by the now-persisted row, in a fresh
    // query cache — exactly what a real page load would rehydrate from Postgres.
    cleanup()
    mocks.session.mockReturnValue({ ...session(), learnerState: currentRow() })
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage()

    expect(mocks.redirect).toHaveBeenCalledWith('/courses')
    expect(screen.queryByText(QUESTIONS[0].text)).toBeNull()
    expect(mocks.call).toHaveBeenCalledTimes(1) // still just the one call from before the "reload"

    resolveCall(envelope({ nextQuestion: null, done: true, profileDelta: {} }))
  })

  it('retries a completing write that fails once and succeeds on the retry: no re-ask, exactly one Profiler call (Wave 1 gate I3)', async () => {
    mocks.call.mockRejectedValueOnce(new Error('upstream unavailable'))
    failNextWrites = 1
    renderPage()
    await answerFirstFive()
    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/courses'))

    // The first attempt failed (consuming the one queued failure); the retry after the short
    // delay succeeds, so this must be waited past.
    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true), { timeout: 3000 })
    expect(currentRow().version).toBe(5) // one successful write landed; the failed attempt cost no version
    expect(readQueuedCompletion('student')).toBeNull() // never had to fall back to the local queue
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.call).toHaveBeenCalledTimes(1) // still exactly one Profiler call in the whole flow

    cleanup()
    mocks.session.mockReturnValue({ ...session(), learnerState: currentRow() })
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage()
    expect(mocks.redirect).toHaveBeenCalledWith('/courses')
    expect(screen.queryByText(QUESTIONS[0].text)).toBeNull()
    expect(mocks.call).toHaveBeenCalledTimes(1) // remounting never re-asks or re-calls
  })

  it('queues locally and shows a plain notice when a completing write fails twice, and never re-asks or re-calls on remount (Wave 1 gate I3)', async () => {
    mocks.call.mockRejectedValueOnce(new Error('upstream unavailable'))
    failNextWrites = 2
    renderPage()
    await answerFirstFive()
    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/courses'))

    // Both attempts fail; only after the retry's delay does this fall back to the local queue.
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Saved on this device. We will sync when the connection is back.'), { timeout: 3000 })
    const queued = readQueuedCompletion('student')
    expect(queued?.onboardingComplete).toBe(true)
    expect(queued?.motivation.why).toBe('To pass my courses') // the compiled profile, not just a bare flag
    // Nothing landed in Postgres: the row is exactly as it started.
    expect(currentRow().profile.onboardingComplete).toBe(false)
    expect(currentRow().version).toBe(4)
    // The session flag is never reverted, so this session itself is never re-asked either.
    expect(mocks.setLearnerState).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ onboardingComplete: true }) }))

    // Remount, backed by the still-incomplete server row (nothing persisted) but the local queue
    // from above intact — exactly a reload after both writes failed.
    cleanup()
    mocks.session.mockReturnValue(session()) // fresh session: server truth is still onboardingComplete: false
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage()

    expect(mocks.redirect).not.toHaveBeenCalled() // server truth says false, but the queue still wins
    expect(mocks.push).toHaveBeenCalledWith('/courses') // the retry-on-mount effect navigates away
    expect(screen.queryByText(QUESTIONS[0].text)).toBeNull() // never re-asked
    expect(mocks.call).toHaveBeenCalledTimes(1) // never re-called

    // The retry-on-mount effect's own write now succeeds (failNextWrites is back to 0).
    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true))
    expect(readQueuedCompletion('student')).toBeNull() // cleared once it actually lands
  })

  it('completes onboarding with the provisional profile and onboardingComplete: true when the Profiler call rejects', async () => {
    mocks.call.mockRejectedValueOnce(new Error('upstream unavailable'))
    renderPage()
    await answerFirstFive()
    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/courses'))
    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true))
    expect(currentRow().version).toBe(5) // one write only — the rejected call never triggers a second
    // Locally-scored values from the taps above stand: p2q1's first option is "To pass my
    // courses" (motivation.why and, fix round 1 I1, motivation.depth: 'pass'); p2q5's first
    // option is "Playful" (tone).
    expect(currentRow().profile.motivation.why).toBe('To pass my courses')
    expect(currentRow().profile.motivation.depth).toBe('pass')
    expect(currentRow().profile.tone).toBe('playful')
    expect(mocks.setLearnerState).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }))
    expect(queryClient.getQueryData(qk.learnerState('student'))).toMatchObject({ version: 5 })
  })

  it('merges a genuine (non-fallback) Profiler reply over the completed profile, motivation key-by-key, in a second write', async () => {
    mocks.call.mockResolvedValueOnce(envelope({ nextQuestion: null, done: true, profileDelta: { tone: 'direct', motivation: { depth: 'master' } } }, false))
    renderPage()
    await answerFirstFive()
    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))

    await waitFor(() => expect(currentRow().version).toBe(6)) // the completing write, then the merge write
    expect(currentRow().profile.tone).toBe('direct')
    expect(currentRow().profile.motivation.depth).toBe('master')
    // `why` was decided locally by the p2q1 tap and must survive a delta that only carries `depth`.
    expect(currentRow().profile.motivation.why).toBe('To pass my courses')
    expect(currentRow().profile.onboardingComplete).toBe(true)
    expect(queryClient.getQueryData(qk.learnerState('student'))).toMatchObject({ version: 6, profile: { tone: 'direct' } })
  })

  it('treats a fallback reply (AGENT_DRY_RUN or an exhausted retry) like a failure: no second write, the completed profile stands', async () => {
    mocks.call.mockResolvedValueOnce(envelope({ nextQuestion: null, done: true, profileDelta: { tone: 'direct' } }, true))
    renderPage()
    await answerFirstFive()
    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))

    await waitFor(() => expect(currentRow().profile.onboardingComplete).toBe(true))
    expect(currentRow().version).toBe(5)
    expect(currentRow().profile.tone).toBe('playful')
  })

  it('redirects to /courses and renders no question when onboardingComplete is already true', () => {
    mocks.session.mockReturnValue(session({ onboardingComplete: true }))
    renderPage()
    expect(mocks.redirect).toHaveBeenCalledWith('/courses')
    expect(screen.queryByText(QUESTIONS[0].text)).toBeNull()
    expect(mocks.call).not.toHaveBeenCalled()
  })

  // Plan T4.9 acceptance: "a test that the onboarding character reveal is
  // absent under reduced motion and that textContent is unchanged" (W4.14 /
  // W4.15 -- the onboarding hook line is one of the two surfaces licensed
  // for <Reveal mode="chars">, and under reduced motion Reveal never calls
  // SplitText.create at all).
  it('renders the hook line as a character reveal, and never splits it under reduced motion (W4.14/W4.15)', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: QUESTIONS[0].text }).textContent).toBe(QUESTIONS[0].text)
    // Not reduced (the default in this suite -- no matchMedia stub, no
    // stored preference): Reveal's mode="chars" branch does call SplitText.
    expect(splitTextMocks.create).toHaveBeenCalledTimes(1)
    const [, vars] = splitTextMocks.create.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(vars).toMatchObject({ type: 'chars' })
    cleanup()
    splitTextMocks.create.mockClear()

    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia

    renderPage()
    const heading = screen.getByRole('heading', { name: QUESTIONS[0].text })
    expect(heading.textContent).toBe(QUESTIONS[0].text)
    expect(splitTextMocks.create).not.toHaveBeenCalled()
  })

  // Fix round (I4): pins loading.tsx's shape as a single hairline `--rule`
  // track, not the old six-pill-dot row, so a later lane cannot silently
  // restore the pill row -- nothing else in the repo renders this file.
  it('renders loading.tsx as one hairline track, never a row of pill dots', () => {
    const { container } = render(<OnboardingLoading />)
    expect(container.querySelectorAll('.bg-rule')).toHaveLength(1)
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(1) // the eyebrow skeleton only
  })
})
