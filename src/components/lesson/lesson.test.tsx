import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import type { CourseCode, LessonPublic } from '@/lib/contracts'
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

const mocks = vi.hoisted(() => ({
  clo: vi.fn(),
  lessonFor: vi.fn(),
  loadCourseBundle: vi.fn(),
  getRuntime: vi.fn(),
  run: vi.fn(),
  callAgent: vi.fn(),
  streamAgent: vi.fn(),
  play: vi.fn(),
}))

const db = vi.hoisted(() => ({
  wellnessPrefs: {} as unknown,
  lessonProgressRows: [] as Record<string, unknown>[],
  upsertCalls: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/curriculum', () => ({
  clo: mocks.clo,
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
            db.lessonProgressRows = [...db.lessonProgressRows.filter((row) => row.lesson_id !== payload.lesson_id), payload]
            return { error: null }
          },
        }
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

function setCurriculum(lesson: LessonPublic) {
  mocks.clo.mockReturnValue({ id: lesson.cloId, course: lesson.course as CourseCode, ordinal: 1, outcome: 'x', topics: [], prerequisites: [], patterns: [], assessableInCode: true })
  mocks.loadCourseBundle.mockResolvedValue({ code: lesson.course, clos: [], exercises: [], lessons: [lesson] })
  mocks.lessonFor.mockReturnValue(lesson)
}

function wrapper(userId = 'learner-1') {
  const client = makeQueryClient()
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: { id: userId } as User, profile: null, learnerState: null }}>
          {children}
        </SessionProvider>
      </QueryClientProvider>
    )
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
  mocks.getRuntime.mockReturnValue({ run: mocks.run, warmup: vi.fn(), abort: vi.fn(), language: 'python' })
  observerSpy.mockClear();
  (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver = FakeIntersectionObserver
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

  it('announces the verdict through an aria-live region, right after which the reveal follows in DOM order', async () => {
    setCurriculum(ALL_KINDS_LESSON)
    render(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, { wrapper: wrapper() })
    await screen.findByText(ALL_KINDS_LESSON.title)

    const section = checkSection('What prints?')
    const textbox = within(section).getByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'wrong' } })
    fireEvent.click(within(section).getByRole('button', { name: /check answer/i }))

    const live = await within(section).findByText('Not yet')
    const liveRegion = live.closest('[aria-live]')
    expect(liveRegion).not.toBeNull()
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite')

    const hint = within(section).getByText('Add them.')
    // The hint must not be injected above the learner's position -- it comes
    // after the live region in document order.
    const position = liveRegion!.compareDocumentPosition(hint)
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
})
