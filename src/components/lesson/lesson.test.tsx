import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import type { CourseCode, LearnerState, LessonPublic } from '@/lib/contracts'
import goldenLessonFile from '../../../seed/lessons/INFS1101.json'
import { LessonView } from './LessonView'

// --- The real golden lesson (INFS1101-3), owned by T1.1's content pipeline.
// Loaded from the committed seed file rather than hand-copied, so a real
// regression in that content trips this test too. Found by cloId rather than
// array index -- T1.1 is authoring more lessons into this same file in
// parallel, so INFS1101-3's position in the array is not stable.
const GOLDEN_LESSON = (goldenLessonFile as { lessons: { cloId: string }[] }).lessons
  .find((lesson) => lesson.cloId === 'INFS1101-3') as unknown as LessonPublic

const BLOCK_LABEL: Record<string, string> = {
  concept: 'Concept', snippet: 'Code example', worked: 'Worked example',
  check: 'Check', recap: 'Recap', bridge: 'Next',
}

// --- A synthetic lesson exercising every check kind, kept independent of any
// other task's content so this suite never breaks on someone else's edit.
const ALL_KINDS_LESSON: LessonPublic = {
  id: 'TEST101-1',
  cloId: 'TEST101-1',
  course: 'TEST101',
  language: 'python',
  version: 1,
  title: 'Every check kind',
  hook: 'One of each.',
  estimatedMinutes: 5,
  draft: false,
  tags: [],
  exitLine: 'Done.',
  blocks: [
    { type: 'concept', id: 'c1', heading: 'A concept', body: 'Body text.' },
    { type: 'snippet', id: 's1', language: 'python', code: 'print(1)', runnable: false, caption: 'A snippet' },
    { type: 'worked', id: 'w1', language: 'python', code: 'x = 1\ny = 2', steps: [{ line: 1, say: 'Step one.' }, { line: 2, say: 'Step two.' }] },
    { type: 'check', id: 'chk-predict', kind: 'predict-output', prompt: 'What prints?', language: 'python', code: 'print(1 + 1)', expected: '2', normalize: 'lines', hint: 'Add them.', explain: 'One plus one is two.' },
    { type: 'check', id: 'chk-choose', kind: 'choose', prompt: 'Pick one.', options: ['A', 'B'], correctIndex: 1, why: ['why-a', 'why-b'], hint: 'Think again.', explain: 'B is right.' },
    { type: 'check', id: 'chk-bug', kind: 'spot-the-bug', prompt: 'Find the bug.', language: 'python', code: 'x = 1\ny = 2\nz = x + y', bugLines: [3], hint: 'Look at the last line.', explain: 'Line 3 has the bug.' },
    { type: 'check', id: 'chk-blank', kind: 'fill-blank', prompt: 'Fill it in.', language: 'python', template: 'x = __1__', blanks: [{ id: '1', accept: ['5'] }], hint: 'Use five.', explain: 'x should be 5.' },
    { type: 'check', id: 'chk-micro', kind: 'micro-code', prompt: 'Write a function.', language: 'python', starterCode: 'def f():\n    pass', tests: [{ id: 't1', input: '', expected: '1', hidden: false, name: 'returns 1' }], hint: 'Return 1.', explain: 'f should return 1.' },
    { type: 'recap', id: 'r1', bullets: ['Bullet one.', 'Bullet two.'], remember: 'Remember this.' },
    { type: 'bridge', id: 'b1', say: 'Go try a real one.' },
  ],
}

const SPOT_THE_BUG_LESSON: LessonPublic = {
  ...ALL_KINDS_LESSON,
  id: 'TEST101-2',
  cloId: 'TEST101-2',
  blocks: [ALL_KINDS_LESSON.blocks.find((block) => block.id === 'chk-bug')!],
}

// --- Wave 1 gate fix (C1): a DSAI2201-shaped lesson, whose course declares
// Pyodide packages, plus a course with none (INFS1101-shaped) -- kept
// synthetic rather than pulled from the real seed files so this suite never
// breaks on someone else's content edit.
const DSAI_COURSE_PACKAGES = ['numpy', 'pandas', 'matplotlib', 'scikit-learn']

const PACKAGES_LESSON: LessonPublic = {
  id: 'DSAI2201-1',
  cloId: 'DSAI2201-1',
  course: 'DSAI2201',
  language: 'python',
  version: 1,
  title: 'A packages lesson',
  hook: 'Hook.',
  estimatedMinutes: 5,
  draft: false,
  tags: [],
  exitLine: 'Done.',
  blocks: [
    { type: 'snippet', id: 's1', language: 'python', code: 'import pandas as pd', runnable: true, packages: ['seaborn'] },
    { type: 'check', id: 'chk-micro', kind: 'micro-code', prompt: 'Write a function.', language: 'python', starterCode: 'def f():\n    pass', tests: [{ id: 't1', input: '', expected: '1', hidden: false }], hint: 'Return 1.', explain: 'f should return 1.' },
    { type: 'bridge', id: 'b1', say: 'Go try a real one.' },
  ],
}

const NO_PACKAGES_LESSON: LessonPublic = {
  id: 'INFS1101-9',
  cloId: 'INFS1101-9',
  course: 'INFS1101',
  language: 'python',
  version: 1,
  title: 'A no-packages lesson',
  hook: 'Hook.',
  estimatedMinutes: 5,
  draft: false,
  tags: [],
  exitLine: 'Done.',
  blocks: [
    { type: 'snippet', id: 's1', language: 'python', code: 'print(1)', runnable: true },
    { type: 'bridge', id: 'b1', say: 'Go try a real one.' },
  ],
}

const mocks = vi.hoisted(() => ({
  clo: vi.fn(),
  course: vi.fn(),
  lessonFor: vi.fn(),
  loadCourseBundle: vi.fn(),
  getRuntime: vi.fn(),
  run: vi.fn(),
  callAgent: vi.fn(),
  streamAgent: vi.fn(),
  play: vi.fn(),
  recordGoalDay: vi.fn(),
}))

const db = vi.hoisted(() => ({
  wellnessPrefs: {} as unknown,
  lessonProgressRows: [] as Record<string, unknown>[],
  upsertCalls: [] as Record<string, unknown>[],
  upsertShouldFail: false,
}))

vi.mock('@/lib/curriculum', () => ({
  clo: mocks.clo,
  course: mocks.course,
  lessonFor: mocks.lessonFor,
  loadCourseBundle: mocks.loadCourseBundle,
}))

vi.mock('@/lib/runtimes', () => ({
  getRuntime: mocks.getRuntime,
  subscribeRuntimeProgress: () => () => {},
}))

vi.mock('@/lib/agents/client', () => ({
  callAgent: mocks.callAgent,
  streamAgent: mocks.streamAgent,
}))

vi.mock('@/lib/sound/manager', () => ({
  play: mocks.play,
}))

// X7: `recordGoalDay`'s own internal logic (`shouldRecordGoalDay`, the write,
// the once-per-day celebration) is already covered by `record.test.ts`
// (W2FIX-F2) -- this suite only needs to prove the walkthrough completion
// path calls it, exactly once, which is what mocking it down to a plain spy
// isolates.
vi.mock('@/lib/rewards/record', () => ({
  recordGoalDay: mocks.recordGoalDay,
}))

// The Editor's own CodeMirror behaviour is exercised by
// `src/components/exercise/Editor.test.tsx`; this suite only needs to prove
// its own integration point (lazy load, props threaded through), so a light
// stub keeps every test here fast and free of real-editor async noise.
vi.mock('@/components/exercise/Editor', () => ({
  Editor: ({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) => (
    <textarea aria-label={label ?? 'Code editor'} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'wellness') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { prefs: db.wellnessPrefs }, error: null }) }) }) }
      }
      if (table === 'lesson_progress') {
        return {
          select: () => ({ eq: async () => ({ data: db.lessonProgressRows, error: null }) }),
          upsert: async (payload: Record<string, unknown>) => {
            db.upsertCalls.push(payload)
            if (db.upsertShouldFail) return { error: new Error('relation "lesson_progress" does not exist') }
            db.lessonProgressRows = [...db.lessonProgressRows.filter((row) => row.lesson_id !== payload.lesson_id), payload]
            return { error: null }
          },
        }
      }
      // X7: `LessonView` now also reads `useAttempts()` to build the reward
      // context it hands `recordGoalDay` -- an empty, always-succeeding
      // result here, distinct from `wellness`/`lesson_progress`, so every
      // test in this file (not only the goal-day ones) never trips the
      // catch-all below just from mounting.
      if (table === 'attempts') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }
      }
      throw new Error(`lesson.test.tsx: unexpected table "${table}"`)
    },
  }),
}))

const observerSpy = vi.fn()
class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: ReadonlyArray<number> = []
  constructor(private callback: IntersectionObserverCallback) { observerSpy() }
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this)
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}

function setCurriculum(lesson: LessonPublic, coursePackages?: string[]) {
  mocks.clo.mockReturnValue({ id: lesson.cloId, course: lesson.course as CourseCode, ordinal: 1, outcome: 'x', topics: [], prerequisites: [], patterns: [], assessableInCode: true })
  mocks.course.mockReturnValue({
    code: lesson.course as CourseCode, slug: lesson.course.toLowerCase(), title: lesson.course,
    language: lesson.language, runtime: 'browser', level: 1, prerequisites: [], topics: [], cloIds: [lesson.cloId],
    status: 'live', ...(coursePackages ? { packages: coursePackages } : {}),
  })
  mocks.loadCourseBundle.mockResolvedValue({ code: lesson.course, clos: [], exercises: [], lessons: [lesson] })
  mocks.lessonFor.mockReturnValue(lesson)
}

function wrapper(userId = 'learner-1', learnerState: LearnerState | null = null) {
  const client = makeQueryClient()
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: { id: userId } as User, profile: null, learnerState }}>
          {children}
        </SessionProvider>
      </QueryClientProvider>
    )
  }
}

/** X7: `recordGoalDay`'s call site needs a real `LearnerState` in the
 *  session store -- `buildRewardContext` requires the field structurally,
 *  even though `recordGoalDay`'s own logic never reads it. */
function learnerStateFixture(userId: string): LearnerState {
  return {
    userId,
    profile: {
      displayName: 'Test learner', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: null, path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function checkSection(promptText: string): HTMLElement {
  const prompt = screen.getByText(promptText)
  const section = prompt.closest('section')
  if (!section) throw new Error(`no <section> ancestor for prompt "${promptText}"`)
  return section as HTMLElement
}

beforeEach(() => {
  db.wellnessPrefs = {}
  db.lessonProgressRows = []
  db.upsertCalls = []
  db.upsertShouldFail = false
  window.localStorage.clear()
  mocks.getRuntime.mockReturnValue({ run: mocks.run, warmup: vi.fn(), abort: vi.fn(), language: 'python' })
  observerSpy.mockClear();
  (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver = FakeIntersectionObserver
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('LessonView', () => {
  it('renders the golden lesson (INFS1101-3) with every block type, in order', async () => {
    setCurriculum(GOLDEN_LESSON)
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })

    await screen.findByText(GOLDEN_LESSON.title)
    const sections = Array.from(document.querySelectorAll('section[aria-label]')) as HTMLElement[]
    const labels = sections.map((section) => section.getAttribute('aria-label'))
    expect(labels).toEqual(GOLDEN_LESSON.blocks.map((block) => BLOCK_LABEL[block.type]))
  })

  it('a wrong predict-output reveals the hint, and the second wrong reveals the explain', async () => {
    setCurriculum(GOLDEN_LESSON)
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(GOLDEN_LESSON.title)

    const check = GOLDEN_LESSON.blocks.find((block) => block.type === 'check' && block.kind === 'predict-output') as { prompt: string; hint: string; explain: string }
    const section = checkSection(check.prompt)
    const textbox = within(section).getByRole('textbox')
    const submit = () => fireEvent.click(within(section).getByRole('button', { name: /check answer/i }))

    fireEvent.change(textbox, { target: { value: 'nonsense' } })
    submit()
    await within(section).findByText('Not yet')
    within(section).getByText(check.hint) // throws if missing
    expect(within(section).queryByText(check.explain)).toBeNull()

    fireEvent.change(textbox, { target: { value: 'still wrong' } })
    submit()
    await within(section).findByText(check.explain)
    expect(within(section).queryByText(check.hint)).toBeNull()
  })

  it('A11Y-15: the hint announces through an aria-live region the focused verdict does not sit inside, in DOM order after it', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(ALL_KINDS_LESSON.title)

    const section = checkSection('What prints?')
    const textbox = within(section).getByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'wrong' } })
    fireEvent.click(within(section).getByRole('button', { name: /check answer/i }))

    const verdict = await within(section).findByText('Not yet')
    // The focus target (I3) must NOT sit inside an aria-live region -- doing
    // so announces the same text twice: once as new live content, once as
    // the newly focused element.
    expect(verdict.closest('[aria-live]')).toBeNull()

    const hint = within(section).getByText('Add them.')
    const liveRegion = hint.closest('[aria-live]')
    expect(liveRegion).not.toBeNull()
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite')
    // The hint must not be injected above the learner's position -- it comes
    // after the verdict in document order.
    const position = verdict.compareDocumentPosition(liveRegion!)
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('every spot-the-bug line is a focusable control reachable by keyboard alone', async () => {
    setCurriculum(SPOT_THE_BUG_LESSON)
    render(<LessonView cloId={SPOT_THE_BUG_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText('Find the bug.')

    const group = screen.getByRole('group', { name: /select every line with a bug/i })
    const lines = within(group).getAllByRole('checkbox')
    expect(lines).toHaveLength(3)
    expect(lines[0].getAttribute('aria-label')).toBe('Line 1: x = 1')
    expect(lines[2].getAttribute('aria-label')).toBe('Line 3: z = x + y')

    lines[0].focus()
    expect(document.activeElement).toBe(lines[0])
    fireEvent.keyDown(lines[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(lines[1])
    fireEvent.keyDown(lines[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(lines[2])

    expect(lines[2].getAttribute('aria-checked')).toBe('false')
    fireEvent.keyDown(lines[2], { key: 'Enter' })
    expect(lines[2].getAttribute('aria-checked')).toBe('true')
  })

  it('never calls an agent across a full open-to-complete run, every check kind answered wrong then right', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(ALL_KINDS_LESSON.title)

    // predict-output
    const predict = checkSection('What prints?')
    const predictBox = within(predict).getByRole('textbox')
    fireEvent.change(predictBox, { target: { value: 'wrong' } })
    fireEvent.click(within(predict).getByRole('button', { name: /check answer/i }))
    await within(predict).findByText('Not yet')
    fireEvent.change(predictBox, { target: { value: '2' } })
    fireEvent.click(within(predict).getByRole('button', { name: /check answer/i }))
    await within(predict).findByText('Right')

    // choose
    const choose = checkSection('Pick one.')
    fireEvent.click(within(choose).getByRole('radio', { name: 'A' }))
    await within(choose).findByText('Not yet')
    fireEvent.click(within(choose).getByRole('radio', { name: 'B' }))
    await within(choose).findByText('Right')

    // spot-the-bug
    const bug = checkSection('Find the bug.')
    const bugLines = within(bug).getAllByRole('checkbox')
    fireEvent.click(bugLines[0])
    fireEvent.click(within(bug).getByRole('button', { name: /check answer/i }))
    await within(bug).findByText('Not yet')
    fireEvent.click(bugLines[0])
    fireEvent.click(bugLines[2])
    fireEvent.click(within(bug).getByRole('button', { name: /check answer/i }))
    await within(bug).findByText('Right')

    // fill-blank
    const blank = checkSection('Fill it in.')
    const blankBox = within(blank).getByRole('textbox')
    fireEvent.change(blankBox, { target: { value: 'wrong' } })
    fireEvent.click(within(blank).getByRole('button', { name: /check answer/i }))
    await within(blank).findByText('Not yet')
    fireEvent.change(blankBox, { target: { value: '5' } })
    fireEvent.click(within(blank).getByRole('button', { name: /check answer/i }))
    await within(blank).findByText('Right')

    // micro-code
    const micro = checkSection('Write a function.')
    mocks.run.mockResolvedValueOnce({ ok: false, results: [{ testId: 't1', passed: false, actual: '0', expected: '1', stdout: '', stderr: '', durationMs: 1 }], passedCount: 0, totalCount: 1, runtime: 'python' })
    fireEvent.click(within(micro).getByRole('button', { name: /run tests/i }))
    await within(micro).findByText('Not yet')
    mocks.run.mockResolvedValueOnce({ ok: true, results: [{ testId: 't1', passed: true, actual: '1', expected: '1', stdout: '', stderr: '', durationMs: 1 }], passedCount: 1, totalCount: 1, runtime: 'python' })
    fireEvent.click(within(micro).getByRole('button', { name: /run tests/i }))
    await within(micro).findByText('Right')

    // finish the walkthrough
    fireEvent.click(screen.getByRole('button', { name: /let's go/i }))
    await screen.findByRole('link', { name: /back to your path/i })

    expect(mocks.callAgent).not.toHaveBeenCalled()
    expect(mocks.streamAgent).not.toHaveBeenCalled()
  })

  it('under reduced motion, no IntersectionObserver is constructed and every block is at full opacity on first render', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia

    setCurriculum(GOLDEN_LESSON)
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(GOLDEN_LESSON.title)

    expect(observerSpy).not.toHaveBeenCalled()
    const sections = Array.from(document.querySelectorAll('section[aria-label]')) as HTMLElement[]
    expect(sections.length).toBeGreaterThan(0)
    for (const section of sections) {
      const wrapperDiv = section.parentElement as HTMLElement
      expect(wrapperDiv.style.opacity).toBe('1')
      expect(wrapperDiv.style.transform === '' || wrapperDiv.style.transform === 'none').toBe(true)
    }

    // @ts-expect-error test-only cleanup of a global we own for this test
    delete window.matchMedia
  })

  it('skipping records the skipped state and never locks the content underneath', async () => {
    setCurriculum(GOLDEN_LESSON)
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(GOLDEN_LESSON.title)

    fireEvent.click(screen.getByRole('button', { name: /i've got this/i }))
    await screen.findByText(/marked as skipped/i)
    // The content is still there and still interactive -- skipping is never a lock.
    screen.getByText(GOLDEN_LESSON.hook) // throws if missing
  })

  it('renders a draft marker when the lesson is a draft', async () => {
    setCurriculum({ ...GOLDEN_LESSON, draft: true })
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(GOLDEN_LESSON.title)
    screen.getByText('Draft') // throws if missing
  })

  it('shows the shared ErrorRetry when the curriculum bundle fails to load, and retry re-fetches it', async () => {
    mocks.clo.mockReturnValue({ id: GOLDEN_LESSON.cloId, course: GOLDEN_LESSON.course as CourseCode, ordinal: 1, outcome: 'x', topics: [], prerequisites: [], patterns: [], assessableInCode: true })
    mocks.loadCourseBundle.mockRejectedValue(new Error('offline'))
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })

    const alert = await screen.findByRole('alert', {}, { timeout: 4000 })
    expect(alert.textContent ?? '').toMatch(/could not load/i)

    mocks.loadCourseBundle.mockResolvedValue({ code: GOLDEN_LESSON.course, clos: [], exercises: [], lessons: [GOLDEN_LESSON] })
    mocks.lessonFor.mockReturnValue(GOLDEN_LESSON)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await screen.findByText(GOLDEN_LESSON.title)
  }, 10000)

  it('shows a plain not-found message for a cloId that resolves to no CLO', () => {
    mocks.clo.mockReturnValue(null)
    render(<LessonView cloId="NOPE-1" />, { wrapper: wrapper() })
    screen.getByText(/could not open/i) // throws if missing
  })

  // --- Fix round 1 -----------------------------------------------------

  it('I2: the aria-live announcement changes between a first and second wrong attempt', async () => {
    setCurriculum(GOLDEN_LESSON)
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(GOLDEN_LESSON.title)

    const check = GOLDEN_LESSON.blocks.find((block) => block.type === 'check' && block.kind === 'predict-output') as { prompt: string }
    const section = checkSection(check.prompt)
    const textbox = within(section).getByRole('textbox')
    const submit = () => fireEvent.click(within(section).getByRole('button', { name: /check answer/i }))

    fireEvent.change(textbox, { target: { value: 'nonsense' } })
    submit()
    await within(section).findByText('Not yet')
    // A11Y-15: the verdict ("Not yet") itself no longer lives inside the
    // aria-live region (it is the focus target instead) -- the region now
    // holds only the hint/explain swap, queried directly rather than off
    // the verdict text.
    const liveRegion = section.querySelector('[aria-live]') as HTMLElement
    const firstAnnouncement = liveRegion.textContent

    fireEvent.change(textbox, { target: { value: 'still wrong' } })
    submit()
    // Same visible word ("Not yet") both times -- the region's announced
    // text (hint swapped for explain) must still differ, or a
    // screen-reader learner hears nothing on this attempt.
    await waitFor(() => expect(liveRegion.textContent).not.toBe(firstAnnouncement))
  })

  it('I3: moves focus to the verdict after grading a check, instead of dropping it to <body>', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(ALL_KINDS_LESSON.title)

    const predict = checkSection('What prints?')
    fireEvent.change(within(predict).getByRole('textbox'), { target: { value: 'wrong' } })
    fireEvent.click(within(predict).getByRole('button', { name: /check answer/i }))
    const verdict = await within(predict).findByText('Not yet')
    await waitFor(() => expect(document.activeElement).toBe(verdict))
  })

  it('I3: moves focus to the final worked-example callout once the last step is reached', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText('Step one.')

    fireEvent.click(screen.getByRole('button', { name: /next step/i }))
    const lastCallout = await screen.findByText('Step two.')
    await waitFor(() => expect(document.activeElement).toBe(lastCallout))
    // The button the learner just activated is gone -- focus did not fall to <body>.
    expect(screen.queryByRole('button', { name: /next step/i })).toBeNull()
  })

  it('I3: moves focus to "Back to your path" once the walkthrough completes', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(ALL_KINDS_LESSON.title)

    fireEvent.click(screen.getByRole('button', { name: /let's go/i }))
    const link = await screen.findByRole('link', { name: /back to your path/i })
    await waitFor(() => expect(document.activeElement).toBe(link))
  })

  it('X7: completing a walkthrough records a goal day exactly once', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    const state = learnerStateFixture('learner-goal')
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper('learner-goal', state) })
    await screen.findByText(ALL_KINDS_LESSON.title)

    fireEvent.click(screen.getByRole('button', { name: /let's go/i }))
    await screen.findByRole('link', { name: /back to your path/i })

    expect(mocks.recordGoalDay).toHaveBeenCalledTimes(1)
    const [, userId, ctx] = mocks.recordGoalDay.mock.calls[0] as [unknown, string, { lessonProgress: { lessonId: string; status: string }[] }]
    expect(userId).toBe('learner-goal')
    // The reward context built for this call carries the just-completed
    // lesson (X7's actual defect: this used to be permanently `[]`).
    expect(ctx.lessonProgress).toContainEqual(expect.objectContaining({ lessonId: ALL_KINDS_LESSON.cloId, status: 'completed' }))
  })

  it('X7: a lesson that is only skipped, never completed, never calls recordGoalDay', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    const state = learnerStateFixture('learner-skip')
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper('learner-skip', state) })
    await screen.findByText(ALL_KINDS_LESSON.title)

    fireEvent.click(screen.getByRole('button', { name: /i've got this/i }))
    await screen.findByText(/marked as skipped/i)

    expect(mocks.recordGoalDay).not.toHaveBeenCalled()
  })

  it('A11Y-06: the progress rail block-count line is not a live region', async () => {
    setCurriculum(GOLDEN_LESSON)
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(GOLDEN_LESSON.title)

    const rail = screen.getByRole('navigation', { name: /walkthrough progress/i })
    const label = within(rail).getByText(/block \d+ of \d+/i)
    expect(label.getAttribute('role')).not.toBe('status')
    expect(label.closest('[aria-live]')).toBeNull()
  })

  it('A11Y-06 + A11Y-15: a screen-reader-style mutation observer counts exactly one live-region announcement per graded attempt, and none from the rail', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(ALL_KINDS_LESSON.title)

    const rail = screen.getByRole('navigation', { name: /walkthrough progress/i })
    const railLabel = within(rail).getByText(/block \d+ of \d+/i)

    // Counted per OBSERVER CALLBACK (one microtask's worth of DOM changes),
    // not per individual `MutationRecord` -- a real screen reader treats a
    // single synchronous DOM update (React's one commit swapping the hint
    // `<p>` for the explain `<p>` is two child-list operations, one remove
    // and one add) as one announcement, not two.
    const railMutations: string[] = []
    const liveMutations: string[] = []
    const observer = new MutationObserver((records) => {
      let touchedRail = false
      let touchedLive = false
      for (const record of records) {
        if (record.target === railLabel || railLabel.contains(record.target)) touchedRail = true
        const node = record.target
        const el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
        if (el?.closest('[aria-live]')) touchedLive = true
      }
      if (touchedRail) railMutations.push(railLabel.textContent ?? '')
      if (touchedLive) liveMutations.push('announced')
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    // Every check kind, wrong then right (the same sequence the "never calls
    // an agent" test already exercises) -- five checks, each graded twice.
    const predict = checkSection('What prints?')
    const predictBox = within(predict).getByRole('textbox')
    fireEvent.change(predictBox, { target: { value: 'wrong' } })
    fireEvent.click(within(predict).getByRole('button', { name: /check answer/i }))
    await within(predict).findByText('Not yet')
    fireEvent.change(predictBox, { target: { value: '2' } })
    fireEvent.click(within(predict).getByRole('button', { name: /check answer/i }))
    await within(predict).findByText('Right')

    const choose = checkSection('Pick one.')
    fireEvent.click(within(choose).getByRole('radio', { name: 'A' }))
    await within(choose).findByText('Not yet')
    fireEvent.click(within(choose).getByRole('radio', { name: 'B' }))
    await within(choose).findByText('Right')

    const bug = checkSection('Find the bug.')
    const bugLines = within(bug).getAllByRole('checkbox')
    fireEvent.click(bugLines[0])
    fireEvent.click(within(bug).getByRole('button', { name: /check answer/i }))
    await within(bug).findByText('Not yet')
    fireEvent.click(bugLines[0])
    fireEvent.click(bugLines[2])
    fireEvent.click(within(bug).getByRole('button', { name: /check answer/i }))
    await within(bug).findByText('Right')

    const blank = checkSection('Fill it in.')
    const blankBox = within(blank).getByRole('textbox')
    fireEvent.change(blankBox, { target: { value: 'wrong' } })
    fireEvent.click(within(blank).getByRole('button', { name: /check answer/i }))
    await within(blank).findByText('Not yet')
    fireEvent.change(blankBox, { target: { value: '5' } })
    fireEvent.click(within(blank).getByRole('button', { name: /check answer/i }))
    await within(blank).findByText('Right')

    const micro = checkSection('Write a function.')
    mocks.run.mockResolvedValueOnce({ ok: false, results: [{ testId: 't1', passed: false, actual: '0', expected: '1', stdout: '', stderr: '', durationMs: 1 }], passedCount: 0, totalCount: 1, runtime: 'python' })
    fireEvent.click(within(micro).getByRole('button', { name: /run tests/i }))
    await within(micro).findByText('Not yet')
    mocks.run.mockResolvedValueOnce({ ok: true, results: [{ testId: 't1', passed: true, actual: '1', expected: '1', stdout: '', stderr: '', durationMs: 1 }], passedCount: 1, totalCount: 1, runtime: 'python' })
    fireEvent.click(within(micro).getByRole('button', { name: /run tests/i }))
    await within(micro).findByText('Right')

    observer.disconnect()

    // A11Y-06: scrolling/answering through the whole lesson never queues a
    // rail announcement -- it carries no `aria-live` at all any more.
    expect(railMutations).toEqual([])
    // A11Y-15: exactly one live-region mutation per graded attempt (the
    // hint/explain swap) -- five checks x two attempts each. Never two for
    // the same attempt, which is what the verdict's own now-removed
    // `aria-live` wrapper used to add on top of this.
    expect(liveMutations.length).toBe(10)
  })

  it('I4: a failed write is queued in localStorage without ever reverting the answered check locally', async () => {
    db.upsertShouldFail = true
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper('learner-queue') })
    await screen.findByText(ALL_KINDS_LESSON.title)
    await waitFor(() => expect(db.upsertCalls.length).toBeGreaterThan(0)) // the 'opened' write, also failing

    const predict = checkSection('What prints?')
    fireEvent.change(within(predict).getByRole('textbox'), { target: { value: '2' } })
    fireEvent.click(within(predict).getByRole('button', { name: /check answer/i }))
    await within(predict).findByText('Right')

    // The check stays answered locally regardless of every write failing.
    within(predict).getByText('Right')

    const key = `brogram:lesson-progress-queue:learner-queue:${ALL_KINDS_LESSON.cloId}`
    await waitFor(() => {
      const raw = window.localStorage.getItem(key)
      expect(raw).not.toBeNull()
      const queued = JSON.parse(raw!) as { checksPassed: number; status: string }
      expect(queued.checksPassed).toBe(1)
      expect(queued.status).toBe('started')
    })
  })

  it('I4: a later successful write drains the queued row exactly once and clears it', async () => {
    // A single-block lesson: block 0 never triggers its own block-advanced
    // dispatch (it is the starting index), so the only write this mount
    // makes is the 'opened' effect draining the queue -- isolating the
    // drain-and-clear behaviour from the unrelated, already-flagged (M1)
    // one-write-per-revealed-block noise a multi-block lesson would add.
    const userId = 'learner-drain'
    const queuedRow = {
      userId, lessonId: SPOT_THE_BUG_LESSON.cloId, cloId: SPOT_THE_BUG_LESSON.cloId,
      status: 'started', blockIndex: 0, checksPassed: 3, checksFailed: 1,
      lessonVersion: 1, startedAt: '2026-09-01T00:00:00.000Z', completedAt: null,
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    window.localStorage.setItem(`brogram:lesson-progress-queue:${userId}:${SPOT_THE_BUG_LESSON.cloId}`, JSON.stringify(queuedRow))
    db.upsertShouldFail = false
    setCurriculum(SPOT_THE_BUG_LESSON)
    render(<LessonView cloId={SPOT_THE_BUG_LESSON.cloId} />, { wrapper: wrapper(userId) })
    await screen.findByText('Find the bug.')

    await waitFor(() => expect(db.upsertCalls.length).toBeGreaterThan(0))
    const payload = db.upsertCalls[0]
    expect(payload.checks_passed).toBe(3)
    expect(payload.checks_failed).toBe(1)

    await waitFor(() => {
      expect(window.localStorage.getItem(`brogram:lesson-progress-queue:${userId}:${SPOT_THE_BUG_LESSON.cloId}`)).toBeNull()
    })
    // Drained exactly once -- no retry storm on the settle-triggered refetch.
    expect(db.upsertCalls).toHaveLength(1)
  })

  it('I1: under reduced motion, block progress still advances instead of freezing at 0', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia

    setCurriculum(GOLDEN_LESSON)
    render(<LessonView cloId={GOLDEN_LESSON.cloId} />, { wrapper: wrapper('learner-reduced') })
    await screen.findByText(GOLDEN_LESSON.title)

    await waitFor(() => {
      const latest = db.upsertCalls.at(-1)
      expect(latest?.block_index).toBe(GOLDEN_LESSON.blocks.length - 1)
    })

    // @ts-expect-error test-only cleanup of a global we own for this test
    delete window.matchMedia
  })

  it('I6: a script tag inside a concept figure is stripped, never rendered live', async () => {
    const hostileLesson: LessonPublic = {
      ...ALL_KINDS_LESSON,
      id: 'TEST101-3',
      cloId: 'TEST101-3',
      blocks: [{
        type: 'concept',
        id: 'c1',
        heading: 'Hostile figure',
        body: 'Body.',
        figure: '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__pwned = true</script><circle r="4" fill="red"/></svg>',
      }],
    }
    setCurriculum(hostileLesson)
    render(<LessonView cloId={hostileLesson.cloId} />, { wrapper: wrapper() })
    await screen.findByText('Hostile figure')

    expect(document.querySelector('script')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
    // Sanitising is surgical, not a bail-to-nothing -- the safe shape survives.
    expect(document.querySelector('svg circle')).not.toBeNull()
  })

  it('C1: a runnable snippet in a DSAI2201-shaped lesson runs with the union of course and snippet packages', async () => {
    setCurriculum(PACKAGES_LESSON, DSAI_COURSE_PACKAGES)
    render(<LessonView cloId={PACKAGES_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(PACKAGES_LESSON.title)

    mocks.run.mockResolvedValueOnce({ ok: true, results: [], passedCount: 0, totalCount: 0, stdout: '', stderr: '', runtime: 'python' })
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }))
    await waitFor(() => expect(mocks.run).toHaveBeenCalled())

    const request = mocks.run.mock.calls[0][0] as { packages?: string[] }
    expect(new Set(request.packages)).toEqual(new Set([...DSAI_COURSE_PACKAGES, 'seaborn']))
  })

  it('C1: a micro-code check in a DSAI2201-shaped lesson runs its tests with the course packages', async () => {
    setCurriculum(PACKAGES_LESSON, DSAI_COURSE_PACKAGES)
    render(<LessonView cloId={PACKAGES_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText('Write a function.')

    mocks.run.mockResolvedValueOnce({ ok: true, results: [{ testId: 't1', passed: true, actual: '1', expected: '1', stdout: '', stderr: '', durationMs: 1 }], passedCount: 1, totalCount: 1, runtime: 'python' })
    fireEvent.click(screen.getByRole('button', { name: /run tests/i }))
    await waitFor(() => expect(mocks.run).toHaveBeenCalled())

    const request = mocks.run.mock.calls[0][0] as { packages?: string[] }
    expect(request.packages).toEqual(DSAI_COURSE_PACKAGES)
  })

  it('C1: a course with no declared packages (INFS1101-shaped) runs a snippet with an empty package list', async () => {
    setCurriculum(NO_PACKAGES_LESSON)
    render(<LessonView cloId={NO_PACKAGES_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(NO_PACKAGES_LESSON.title)

    mocks.run.mockResolvedValueOnce({ ok: true, results: [], passedCount: 0, totalCount: 0, stdout: '1\n', stderr: '', runtime: 'python' })
    fireEvent.click(screen.getByRole('button', { name: /^run$/i }))
    await waitFor(() => expect(mocks.run).toHaveBeenCalled())

    const request = mocks.run.mock.calls[0][0] as { packages?: string[] }
    expect(request.packages).toEqual([])
  })
})
