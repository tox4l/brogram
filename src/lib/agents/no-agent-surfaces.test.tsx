/**
 * The no-agent-surfaces guard (spec §12 #9, plan T3.4).
 *
 * `callAgent` and `streamAgent` (`src/lib/agents/client.ts`) are the single
 * choke point every one of the seven frozen agent triggers goes through.
 * This file spies on that choke point and proves two things at once, across
 * every screen and interaction v2 shipped:
 *
 *   1. Zero calls fire from a surface that must never call an agent: a
 *      walkthrough (every check kind, right and wrong), a full Arcade run, a
 *      full Playground run, a theme switch, a dock move through all five
 *      placements, a celebration, a level-up, `/courses`, `/course/[code]`
 *      and the dashboard.
 *   2. The seven legitimate triggers still fire, so this file cannot be
 *      satisfied by breaking the product instead of guarding it:
 *      `onboarding-answer`, `plan-refresh`, `attempt-failed`,
 *      `hint-requested`, `attempt-passed`, `bank-miss`, `buddy-message`.
 *
 * WHOEVER ADDS A NEW SCREEN, DRILL, GAME, OR INTERACTION EXTENDS THIS FILE.
 * A new surface with no describe block here is a guarantee with a hole in
 * it — add a block that mounts it end to end and asserts the spies below
 * were never called, exactly like every block already here does.
 */

import type { PropsWithChildren, ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AgentEnvelope, Clo, CourseCode, ExercisePublic, LearnerState, LessonPublic, RunResult,
} from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { QUESTIONS } from '@/lib/onboarding/questions'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { LessonView } from '@/components/lesson/LessonView'
import { ThemeQuickSwitch } from '@/components/shell/ThemeQuickSwitch'
import { THEMES } from '@/lib/theme/themes'
import { Dock } from '@/components/wellness/Dock'
import { BuddyDrawer } from '@/components/buddy/Drawer'
import { useExerciseLoop } from '@/hooks/useExerciseLoop'
import { compileLearnerState } from '@/lib/learner/compile'
import DerotArcadeRunnerPage from '@/app/(app)/derot/arcade/[kind]/page'
import DerotPlayRunnerPage from '@/app/(app)/derot/play/[game]/page'
import type { PlayGameId } from '@/components/derot/play/types'
import CoursesPage from '@/app/(app)/courses/page'
import CoursePage from '@/app/(app)/course/[code]/page'
import Dashboard from '@/app/(app)/dashboard/page'
import Onboarding from '@/app/(app)/onboarding/page'
import { renderHook } from '@testing-library/react'

// ---------------------------------------------------------------------------
// The one spy every describe block below asserts against.
// ---------------------------------------------------------------------------

const agentSpies = vi.hoisted(() => ({ call: vi.fn(), stream: vi.fn() }))
vi.mock('@/lib/agents/client', () => ({ callAgent: agentSpies.call, streamAgent: agentSpies.stream }))

// ---------------------------------------------------------------------------
// Shared infrastructure mocks -- one registration per module for the whole
// file, each flexible enough for every surface below that touches it.
// ---------------------------------------------------------------------------

const nav = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(),
  params: vi.fn(() => ({}) as Record<string, string>),
  searchParams: vi.fn(() => new URLSearchParams()),
  pathname: vi.fn(() => '/dashboard'),
  redirect: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: nav.prefetch }),
  useParams: () => nav.params(),
  useSearchParams: () => nav.searchParams(),
  usePathname: () => nav.pathname(),
  redirect: (...args: unknown[]) => nav.redirect(...args),
}))

const curriculum = vi.hoisted(() => ({
  courses: vi.fn(),
  liveCourses: vi.fn(),
  course: vi.fn(),
  closFor: vi.fn(),
  clo: vi.fn(),
  patternName: vi.fn(),
  loadCourseBundle: vi.fn(),
  loadedBundle: vi.fn(),
  lessonFor: vi.fn(),
  exerciseFrom: vi.fn(),
}))
vi.mock('@/lib/curriculum', () => ({
  BUILD_ID: 'test',
  courses: curriculum.courses,
  liveCourses: curriculum.liveCourses,
  course: curriculum.course,
  closFor: curriculum.closFor,
  clo: curriculum.clo,
  patternName: curriculum.patternName,
  CurriculumLoadError: class CurriculumLoadError extends Error {},
  loadCourseBundle: curriculum.loadCourseBundle,
  loadedBundle: curriculum.loadedBundle,
  lessonFor: curriculum.lessonFor,
  exerciseFrom: curriculum.exerciseFrom,
}))

const runtimeMocks = vi.hoisted(() => ({
  run: vi.fn(),
  warmup: vi.fn(async () => {}),
  abort: vi.fn(),
  progress: vi.fn(() => () => {}),
}))
vi.mock('@/lib/runtimes', () => ({
  getRuntime: (language: string) => ({ language, run: runtimeMocks.run, warmup: runtimeMocks.warmup, abort: runtimeMocks.abort }),
  subscribeRuntimeProgress: runtimeMocks.progress,
  judgeProviderAbsent: () => false,
}))

const soundMocks = vi.hoisted(() => ({ play: vi.fn() }))
vi.mock('@/lib/sound/manager', () => ({ play: soundMocks.play, withInterfaceSounds: (run: () => void) => run() }))

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()
  const toast = vi.fn() as unknown as { (message: string): void; error: ReturnType<typeof vi.fn> }
  ;(toast as unknown as { error: ReturnType<typeof vi.fn> }).error = vi.fn()
  return { ...actual, toast }
})

const themeMocks = vi.hoisted(() => ({ theme: vi.fn(() => 'midnight' as string | undefined), setTheme: vi.fn() }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: themeMocks.theme(), setTheme: themeMocks.setTheme }) }))

vi.mock('@/components/shell/useSecondTick', () => ({
  useSecondTick: () => 0,
  isTickReady: () => false,
  nowOrNull: () => null,
}))

vi.mock('@/components/exercise/Editor', () => ({
  Editor: ({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string }) => (
    <textarea aria-label={label ?? 'Code editor'} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
}))

// `@/components/derot` (DrillRunner and its six per-kind children) and the
// six `@/components/derot/play/*` games are deliberately left UNMOCKED here
// (fix round 1, F1): the Arcade and Playground blocks below drive the real
// components, not stand-ins, exactly per the review criterion that every
// listed surface is genuinely exercised, not merely rendered.

// The Celebration surface: same partial mocks `rewards.test.tsx` already
// proved necessary for this component to mount cleanly under jsdom.
const gsapMocks = vi.hoisted(() => ({ to: vi.fn(), set: vi.fn(), fromTo: vi.fn(), killTweensOf: vi.fn() }))
vi.mock('gsap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gsap')>()
  return { ...actual, gsap: { ...actual.gsap, to: gsapMocks.to, set: gsapMocks.set, fromTo: gsapMocks.fromTo, killTweensOf: gsapMocks.killTweensOf } }
})
vi.mock('canvas-confetti', () => ({ default: vi.fn() }))

// getQueryClient (the module-level singleton `useExerciseLoop` invalidates
// through) is overridden; `makeQueryClient` -- used throughout this file to
// build a real, per-test `QueryClient` for `<QueryClientProvider>` -- stays real.
// `getQueryClient()` is the browser singleton non-component call sites (the
// exercise loop, a lesson's progress writer) bind to; giving it a real,
// fully-functional `QueryClient` here (rather than a hand-rolled partial
// stub) is what lets `useOptimistic`'s non-component twin (`optimistic()`,
// `src/lib/query/optimistic.ts`) run for real without throwing on
// `cancelQueries`/`getQueryData`/`removeQueries`. `makeQueryClient` itself
// stays real.
vi.mock('@/lib/query/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/query/client')>()
  const singleton = actual.makeQueryClient()
  return { ...actual, getQueryClient: () => singleton }
})

// ---------------------------------------------------------------------------
// A single fake Supabase, table-dispatched. Every table any surface below
// touches is handled here so `createClient()` is mocked exactly once for
// the whole file.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  wellnessRow: null as Row | null,
  lessonProgressRows: [] as Row[],
  lessonUpsertShouldFail: false,
  drillsRows: [] as Row[],
  buddyRows: [] as Row[],
  rpcError: null as { code?: string; message?: string } | null,
  rpcData: [] as unknown[],
  rpcSpy: vi.fn(),
  integrityInsertSpy: vi.fn(),
}))

/** The generic read-modify-write builder every `learner_state`/`attempts`/
 *  `mastery`/`exercises_public` consumer in the app uses (mirrors the proven
 *  shape in `useExerciseLoop.test.tsx`, trimmed of that file's own
 *  race-condition-only bookkeeping). */
function genericTable(table: string) {
  let action: 'read' | 'insert' | 'upsert' | 'update' = 'read'
  let payload: Row | Row[] | undefined
  let single = false
  let limit = Infinity
  const filters: Array<(row: Row) => boolean> = []
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return builder },
    in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return builder },
    or: (condition: string) => {
      const raw = condition.split('last_attempt_at.lte.')[1]
      const timestamp = raw?.replace(/^"|"$/g, '')
      filters.push((row) => row.last_attempt_at == null || String(row.last_attempt_at) <= (timestamp ?? ''))
      return builder
    },
    order: () => builder,
    limit: (count: number) => { limit = count; return builder },
    maybeSingle: () => { single = true; return builder },
    single: () => { single = true; return builder },
    insert: (value: Row | Row[]) => { action = 'insert'; payload = value; return builder },
    upsert: (value: Row | Row[], options?: { ignoreDuplicates?: boolean }) => { action = options?.ignoreDuplicates ? 'insert' : 'upsert'; payload = value; return builder },
    update: (value: Row) => { action = 'update'; payload = value; return builder },
    then: (resolve: (result: { data: Row | Row[] | null; error: { message: string } | null }) => unknown) => (async () => {
      const rows = (db.tables[table] ??= [])
      let found = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, limit)
      if (action === 'insert' || action === 'upsert') {
        const batch = Array.isArray(payload) ? payload : [payload!]
        found = batch.map((value) => {
          const old = rows.find((row) =>
            table === 'attempts' ? row.id === value.id
              : table === 'mastery' ? row.user_id === value.user_id && row.clo_id === value.clo_id
                : row.user_id === value.user_id)
          if (old) { if (action === 'upsert' && table !== 'attempts') Object.assign(old, value); return old }
          rows.push({ ...value })
          return rows[rows.length - 1]
        })
      } else if (action === 'update') {
        found.forEach((row) => Object.assign(row, payload))
      }
      return resolve({ data: single ? found[0] ?? null : found, error: null })
    })(),
  }
  return builder
}

function wellnessTable() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: db.wellnessRow, error: null }),
    update: (payload: Row) => ({
      eq: () => ({
        select: () => ({
          maybeSingle: async () => {
            if (!db.wellnessRow) return { data: null, error: null }
            db.wellnessRow = { ...db.wellnessRow, ...payload }
            return { data: { user_id: 'x' }, error: null }
          },
        }),
      }),
    }),
    insert: async (value: Row) => { db.wellnessRow = { ...value }; return { data: null, error: null } },
  }
  return builder
}

function lessonProgressTable() {
  return {
    select: () => ({ eq: async () => ({ data: db.lessonProgressRows, error: null }) }),
    upsert: async (payload: Row) => {
      if (db.lessonUpsertShouldFail) return { error: new Error('relation "lesson_progress" does not exist') }
      db.lessonProgressRows = [...db.lessonProgressRows.filter((row) => row.lesson_id !== payload.lesson_id), payload]
      return { error: null }
    },
  }
}

function drillsTable() {
  return { select: () => ({ eq: (_col: string, value: string) => Promise.resolve({ data: db.drillsRows.filter((row) => row.kind === value), error: null }) }) }
}

function buddyMessagesTable() {
  let action: 'select' | 'insert' = 'select'
  let payload: Row | undefined
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: (value: Row) => { action = 'insert'; payload = value; return builder },
    then: (resolve: (result: { data: Row[] | null; error: null }) => unknown) => {
      if (action === 'insert') {
        db.buddyRows.push({ id: `row-${db.buddyRows.length}`, role: payload!.role, content: String(payload!.content), created_at: new Date(Date.now() + db.buddyRows.length).toISOString() })
        return Promise.resolve(resolve({ data: null, error: null }))
      }
      const descending = [...db.buddyRows].reverse().slice(0, 50)
      return Promise.resolve(resolve({ data: descending, error: null }))
    },
  }
  return builder
}

function integrityEventsTable() {
  return { insert: (payload: Row) => { db.integrityInsertSpy(payload); return Promise.resolve({ error: null }) } }
}

function supabaseFrom(table: string) {
  switch (table) {
    case 'exercises_public':
    case 'attempts':
    case 'mastery':
    case 'learner_state':
      return genericTable(table)
    case 'wellness':
      return wellnessTable()
    case 'lesson_progress':
      return lessonProgressTable()
    case 'drills':
      return drillsTable()
    case 'buddy_messages':
      return buddyMessagesTable()
    case 'integrity_events':
      return integrityEventsTable()
    default:
      throw new Error(`no-agent-surfaces.test.tsx: unexpected table "${table}"`)
  }
}

function supabaseRpc(name: string, payload?: unknown) {
  db.rpcSpy(name, payload)
  return Promise.resolve(db.rpcError ? { data: null, error: db.rpcError } : { data: db.rpcData, error: null })
}

const supa = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: supa.from, rpc: supa.rpc }) }))

// ---------------------------------------------------------------------------
// Global test environment polyfills every surface below needs at least once.
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { latitude: 24.4667, longitude: 54.3667, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition))
  Object.defineProperty(window.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
})

const observerSpy = vi.fn()
class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: ReadonlyArray<number> = []
  constructor(private callback: IntersectionObserverCallback) { observerSpy() }
  observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this) }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.tables = {}
  db.wellnessRow = { prefs: {} }
  db.lessonProgressRows = []
  db.lessonUpsertShouldFail = false
  db.drillsRows = []
  db.buddyRows = []
  db.rpcError = null
  db.rpcData = []
  supa.from.mockImplementation(supabaseFrom)
  supa.rpc.mockImplementation(supabaseRpc)
  nav.params.mockReturnValue({})
  nav.searchParams.mockReturnValue(new URLSearchParams())
  nav.pathname.mockReturnValue('/dashboard')
  curriculum.courses.mockReturnValue([])
  curriculum.liveCourses.mockReturnValue([])
  curriculum.course.mockReturnValue(null)
  curriculum.closFor.mockReturnValue([])
  curriculum.clo.mockReturnValue(null)
  curriculum.exerciseFrom.mockReturnValue(null)
  curriculum.lessonFor.mockReturnValue(null)
  curriculum.loadedBundle.mockReturnValue(null)
  curriculum.patternName.mockImplementation((id: string) => id)
  runtimeMocks.warmup.mockResolvedValue(undefined)
  runtimeMocks.progress.mockImplementation(() => () => {})
  ;(globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver = FakeIntersectionObserver
  observerSpy.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.localStorage.clear()
  try { window.sessionStorage.clear() } catch { /* jsdom always has sessionStorage */ }
})

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function baseLearnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'student',
    profile: {
      displayName: 'Maya', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: null, path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-06T00:00:00Z',
    ...overrides,
  }
}

function withSession(initial: Partial<{ userId: string; learnerState: LearnerState | null }> = {}) {
  const userId = initial.userId ?? 'student'
  const state: LearnerState | null = 'learnerState' in initial ? (initial.learnerState ?? null) : baseLearnerState({ userId })
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <SessionProvider initialState={{ user: { id: userId } as import('@supabase/supabase-js').User, profile: { id: userId, account_status: 'active', restricted_until: null }, learnerState: state }}>
        {children}
      </SessionProvider>
    )
  }
}

function withProviders(sessionInit: Partial<{ userId: string; learnerState: LearnerState | null }> = {}, client: QueryClient = makeQueryClient()) {
  const SessionWrapper = withSession(sessionInit)
  return { client, Wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}><SessionWrapper>{children}</SessionWrapper></QueryClientProvider> }
}

function renderWith(ui: ReactElement, Wrapper: (props: PropsWithChildren) => ReactElement) {
  return render(ui, { wrapper: Wrapper })
}

function noAgentCalls() {
  expect(agentSpies.call).not.toHaveBeenCalled()
  expect(agentSpies.stream).not.toHaveBeenCalled()
}

// =============================================================================
// 1. A walkthrough, every check kind answered both right and wrong.
// =============================================================================

describe('surface: lesson walkthrough', () => {
  const ALL_KINDS_LESSON: LessonPublic = {
    id: 'SURF101-1', cloId: 'SURF101-1', course: 'SURF101', language: 'python', version: 1,
    title: 'Every check kind', hook: 'One of each.', estimatedMinutes: 5, draft: false, tags: [], exitLine: 'Done.',
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
  } as unknown as LessonPublic

  function checkSection(promptText: string): HTMLElement {
    const prompt = screen.getByText(promptText)
    const section = prompt.closest('section')
    if (!section) throw new Error(`no <section> ancestor for prompt "${promptText}"`)
    return section as HTMLElement
  }

  beforeEach(() => {
    curriculum.clo.mockReturnValue({ id: ALL_KINDS_LESSON.cloId, course: ALL_KINDS_LESSON.course as CourseCode, ordinal: 1, outcome: 'x', topics: [], prerequisites: [], patterns: [], assessableInCode: true })
    curriculum.course.mockReturnValue({ code: ALL_KINDS_LESSON.course as CourseCode, slug: 'surf', title: ALL_KINDS_LESSON.course, language: ALL_KINDS_LESSON.language, runtime: 'browser', level: 1, prerequisites: [], topics: [], cloIds: [ALL_KINDS_LESSON.cloId], status: 'live' })
    curriculum.loadCourseBundle.mockResolvedValue({ code: ALL_KINDS_LESSON.course, clos: [], exercises: [], lessons: [ALL_KINDS_LESSON] })
    curriculum.lessonFor.mockReturnValue(ALL_KINDS_LESSON)
  })

  it('never calls an agent across a full open-to-complete run, every check kind answered wrong then right', async () => {
    renderWith(<LessonView cloId={ALL_KINDS_LESSON.cloId} />, withProviders().Wrapper)
    await screen.findByText(ALL_KINDS_LESSON.title)

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
    runtimeMocks.run.mockResolvedValueOnce({ ok: false, results: [{ testId: 't1', passed: false, actual: '0', expected: '1', stdout: '', stderr: '', durationMs: 1 }], passedCount: 0, totalCount: 1, runtime: 'python' })
    fireEvent.click(within(micro).getByRole('button', { name: /run tests/i }))
    await within(micro).findByText('Not yet')
    runtimeMocks.run.mockResolvedValueOnce({ ok: true, results: [{ testId: 't1', passed: true, actual: '1', expected: '1', stdout: '', stderr: '', durationMs: 1 }], passedCount: 1, totalCount: 1, runtime: 'python' })
    fireEvent.click(within(micro).getByRole('button', { name: /run tests/i }))
    await within(micro).findByText('Right')

    fireEvent.click(screen.getByRole('button', { name: /let's go/i }))
    await screen.findByRole('link', { name: /back to your path/i })

    noAgentCalls()
  })
})

// =============================================================================
// 2. An Arcade run, start to finish.
// =============================================================================

describe('surface: de-rot Arcade', () => {
  // Real PredictOutput mounts (fix round 1, F1) -- six distinct items so a
  // six-item run never repeats one, each identified by its own rendered
  // snippet so `answerCurrent` can find the right answer for whichever item
  // the run model actually served next.
  const PREDICT_FIXTURES = [
    { id: 'd1', snippet: 'print(1)', expected: '1' },
    { id: 'd2', snippet: 'print(2)', expected: '2' },
    { id: 'd3', snippet: 'print(3)', expected: '3' },
    { id: 'd4', snippet: 'print(4)', expected: '4' },
    { id: 'd5', snippet: 'print(5)', expected: '5' },
    { id: 'd6', snippet: 'print(6)', expected: '6' },
  ]

  function drillRow(fixture: (typeof PREDICT_FIXTURES)[number]): Row {
    return {
      id: fixture.id, kind: 'predict-output', difficulty: 3, time_limit_s: 60,
      payload: { language: 'python', snippet: fixture.snippet, expectedOutput: fixture.expected },
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-06T12:00:00.000Z'))
    nav.params.mockReturnValue({ kind: 'predict-output' })
    db.drillsRows = PREDICT_FIXTURES.map(drillRow)
    db.wellnessRow = { drill_results: [] }
  })

  async function answerCurrent() {
    const textarea = await screen.findByPlaceholderText(/type the exact output/i)
    const snippet = document.querySelector('pre code')?.textContent ?? ''
    const fixture = PREDICT_FIXTURES.find((entry) => entry.snippet === snippet)
    if (!fixture) throw new Error(`no fixture for the rendered snippet "${snippet}"`)
    fireEvent.change(textarea, { target: { value: fixture.expected } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await new Promise((resolve) => setTimeout(resolve, 650))
  }

  it('runs a full six-item Arcade run through the real PredictOutput drill without ever calling an agent', async () => {
    renderWith(<DerotArcadeRunnerPage />, withSession())
    for (let i = 0; i < 6; i++) await answerCurrent()
    await waitFor(() => expect(screen.getAllByText(/run complete/i).length).toBeGreaterThan(0))
    noAgentCalls()
  }, 15000)
})

// =============================================================================
// 3. A Playground run, start to finish.
// =============================================================================

describe('surface: de-rot Playground', () => {
  it('runs a full follow-the-dot Playground game to completion through the real game component, without ever calling an agent', async () => {
    // Only `Date` is faked here (matching the Arcade block above), never
    // `setTimeout`/`setInterval`: the 3-2-1 start and the game's own 100ms
    // countdown tick stay on REAL timers, so testing-library's own
    // `findBy`/`waitFor` polling keeps working. Jumping the frozen clock
    // forward by the game's own time limit is what makes the next real
    // countdown tick see the run as expired, instead of waiting 75 real
    // seconds for it.
    vi.useFakeTimers({ toFake: ['Date'] })
    const startedAt = new Date('2026-09-06T12:00:00.000Z')
    vi.setSystemTime(startedAt)
    nav.params.mockReturnValue({ game: 'follow-the-dot' })
    db.wellnessRow = { prefs: {}, drill_results: [] }

    renderWith(<DerotPlayRunnerPage />, withSession())
    await screen.findByText('Follow the Dot')
    // The real 3-2-1 start (700ms x3 + 500ms of real waiting).
    const area = await screen.findByTestId('follow-the-dot-area', {}, { timeout: 5000 })

    // A real interaction: track the pointer inside the play area a few times.
    fireEvent.pointerMove(area, { clientX: 160, clientY: 160 })
    fireEvent.pointerMove(area, { clientX: 150, clientY: 170 })

    // Expire the game's own 75s countdown (PLAY_TIME_LIMIT_S['follow-the-dot'])
    // by jumping the frozen clock forward -- the next real 100ms tick notices.
    vi.setSystemTime(new Date(startedAt.getTime() + 75_000))

    await waitFor(() => expect(db.rpcSpy).toHaveBeenCalled(), { timeout: 5000 })
    noAgentCalls()
  }, 15000)

  it('mounts each of the other five real Playground games and exercises the real Quit control on each, without ever calling an agent', async () => {
    // Reduced motion (fix round 1, F1) skips the 3-2-1 start instantly on every one of these five
    // games -- none of them substitutes a different surface under reduced motion the way Follow the
    // Dot does, so this is a real mount of each real component, not a workaround.
    db.wellnessRow = { prefs: { motion: 'reduced' }, drill_results: [] }
    const otherGames: PlayGameId[] = ['color-nback', 'reaction', 'rhythm', 'breathe', 'memory-grid']

    for (const game of otherGames) {
      nav.params.mockReturnValue({ game })
      const { unmount } = renderWith(<DerotPlayRunnerPage />, withSession())
      const quit = await screen.findByRole('button', { name: 'Quit' }, { timeout: 5000 })
      fireEvent.click(quit)
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/derot'))
      unmount()
      nav.push.mockClear()
    }

    noAgentCalls()
  }, 20000)
})

// =============================================================================
// 4. A theme switch.
// =============================================================================

describe('surface: theme switch', () => {
  it('cycles through every available theme without ever calling an agent', () => {
    render(<ThemeQuickSwitch />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose theme' }))
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBe(THEMES.length)
    for (const radio of radios) fireEvent.click(radio)
    noAgentCalls()
  })

  // Fix round 1, F3: `next-themes` is mocked at the top of this file, so the
  // test above only proves ThemeQuickSwitch's own click handler runs, never
  // the applied-theme path downstream of it. This one test un-mocks
  // `next-themes` for real (a fresh module graph via resetModules, matching
  // the celebration block's own established pattern below) and wraps the
  // real component in the real `ThemeProvider`, so a callAgent planted
  // anywhere downstream of an actually-applied theme would be caught too.
  it('applies the chosen theme for real -- next-themes unmocked -- and still calls no agent', async () => {
    vi.resetModules()
    vi.doUnmock('next-themes')
    const { ThemeProvider } = await import('next-themes')
    const { ThemeQuickSwitch: RealThemeQuickSwitch } = await import('@/components/shell/ThemeQuickSwitch')
    const { THEMES: realThemes, THEME_STORAGE_KEY } = await import('@/lib/theme/themes')

    render(
      <ThemeProvider
        attribute="data-theme"
        themes={realThemes.map((entry) => entry.id)}
        defaultTheme="midnight"
        enableSystem={false}
        storageKey={THEME_STORAGE_KEY}
        disableTransitionOnChange
      >
        <RealThemeQuickSwitch />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose theme' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('amber'))
    noAgentCalls()

    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-switching')
  })
})

// =============================================================================
// 5. A dock move through all five placements.
// =============================================================================

describe('surface: wellness dock placement', () => {
  it('moves the dock through every placement it offers without ever calling an agent', async () => {
    const { Wrapper } = withProviders()
    renderWith(<Dock orientation="vertical" collapsed={false} onToggleCollapse={() => {}} corner="br" onCornerChange={() => {}} />, Wrapper)
    fireEvent.click(screen.getByText('Settings'))
    const select = screen.getByLabelText('Dock position') as HTMLSelectElement
    // Derived from the select's own rendered options (fix round 1, F2), the
    // same discipline the theme block already applies with THEMES.length --
    // a renamed placement id can never make this loop silently move nothing.
    const values = Array.from(select.options).map((option) => option.value)
    expect(values).toHaveLength(5)
    for (const value of values) {
      fireEvent.change(select, { target: { value } })
      await waitFor(() => expect(select.value).toBe(value))
    }
    noAgentCalls()
  })
})

// =============================================================================
// 6. A celebration and a level-up.
// =============================================================================

describe('surface: celebration and level-up', () => {
  async function freshCelebration() {
    vi.resetModules()
    const queueModule = await import('@/lib/rewards/useCelebration')
    const { Celebration } = await import('@/components/rewards/Celebration')
    return { Celebration, celebrate: queueModule.celebrate, levelUpDetail: queueModule.levelUpDetail }
  }

  it('a routine pass celebration renders and fires no agent call', async () => {
    const { Celebration, celebrate } = await freshCelebration()
    render(<Celebration />)
    act(() => celebrate('pass'))
    expect(document.querySelectorAll('.pointer-events-auto').length).toBeGreaterThan(0)
    noAgentCalls()
  })

  it('a level-up celebration renders and fires no agent call', async () => {
    const { Celebration, celebrate, levelUpDetail } = await freshCelebration()
    render(<Celebration />)
    const detail = levelUpDetail(0, 5000)
    expect(detail).not.toBeNull()
    act(() => celebrate('level-up', detail!))
    expect(document.querySelectorAll('.pointer-events-auto').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Level 5/).length).toBeGreaterThan(0)
    noAgentCalls()
  })
})

// =============================================================================
// 7 & plan-refresh. `/courses` renders with zero calls; switching a course
// fires exactly one `plan-refresh`.
// =============================================================================

describe('surface: /courses render, trigger: plan-refresh', () => {
  const COURSE_ONE = { code: 'C1', slug: 'course-one', title: 'Course One', language: 'python', runtime: 'browser', level: 1, prerequisites: [], topics: [], cloIds: ['C1-1'], status: 'live' }
  const CLOS_C1: Clo[] = [{ id: 'C1-1', course: 'C1', ordinal: 1, outcome: 'First outcome', topics: [], prerequisites: [], patterns: [], assessableInCode: true }]
  const EXERCISES_C1: ExercisePublic[] = [{ id: 'e1', cloId: 'C1-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'guard', title: 'Ex1', prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] }]
  const BUNDLE_C1 = { code: 'C1', clos: CLOS_C1, lessons: [], exercises: EXERCISES_C1 }

  beforeEach(() => {
    curriculum.liveCourses.mockReturnValue([COURSE_ONE])
    curriculum.closFor.mockImplementation((code: string) => (code === 'C1' ? CLOS_C1 : []))
    curriculum.loadedBundle.mockImplementation((code: string) => (code === 'C1' ? BUNDLE_C1 : null))
    curriculum.loadCourseBundle.mockImplementation(async (code: string) => (code === 'C1' ? BUNDLE_C1 : { code, clos: [], lessons: [], exercises: [] }))
    db.tables.learner_state = [{ user_id: 'student', state: baseLearnerState(), version: 1 }]
  })

  it('renders every live course as a link with zero agent calls', () => {
    const { client, Wrapper } = withProviders()
    client.setQueryData(qk.learnerState('student'), baseLearnerState())
    renderWith(<CoursesPage />, Wrapper)
    expect(screen.getByRole('link', { name: /Course One/ })).toBeTruthy()
    noAgentCalls()
  })

  it('fires exactly one plan-refresh call on switching to a course', async () => {
    agentSpies.call.mockResolvedValue({ ok: true, agent: 'planner', reply: { path: ['C1-1'], nextExerciseIds: ['e1'], focus: '' }, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } } as AgentEnvelope<unknown>)
    const { client, Wrapper } = withProviders()
    client.setQueryData(qk.learnerState('student'), baseLearnerState())
    renderWith(<CoursesPage />, Wrapper)

    fireEvent.click(screen.getByRole('link', { name: /Course One/ }))
    await waitFor(() => expect(db.tables.learner_state.find((row) => row.user_id === 'student')?.state).toMatchObject({ currentCourse: 'C1' }))

    expect(agentSpies.call).toHaveBeenCalledTimes(1)
    expect(agentSpies.call).toHaveBeenCalledWith(expect.objectContaining({ agent: 'planner', trigger: 'plan-refresh' }))
    expect(agentSpies.stream).not.toHaveBeenCalled()
  })
})

// =============================================================================
// 8. `/course/[code]` render.
// =============================================================================

describe('surface: /course/[code] render', () => {
  it('renders a course home with zero agent calls', async () => {
    nav.params.mockReturnValue({ code: 'DEMO101' })
    curriculum.course.mockReturnValue({ code: 'DEMO101', slug: 'demo', title: 'Demo Course', language: 'python', runtime: 'browser', level: 1, prerequisites: [], topics: [], cloIds: ['DEMO101-1'], status: 'live' })
    curriculum.loadCourseBundle.mockResolvedValue({
      code: 'DEMO101',
      clos: [{ id: 'DEMO101-1', course: 'DEMO101', ordinal: 1, outcome: 'First skill', topics: [], prerequisites: [], patterns: ['a'], assessableInCode: true }],
      exercises: [{ id: 'E-1', cloId: 'DEMO101-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'a', title: 'Exercise 1', prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] }],
      lessons: [],
    })
    const { Wrapper } = withProviders({ learnerState: baseLearnerState({ currentCourse: 'DEMO101', path: ['DEMO101-1'], nextExerciseIds: ['E-1'] }) })
    renderWith(<CoursePage />, Wrapper)
    await screen.findByText('Demo Course')
    noAgentCalls()
  })
})

// =============================================================================
// 9. Dashboard render.
// =============================================================================

describe('surface: dashboard render', () => {
  it('renders "Today" from the session store and seeded cache with zero agent calls', async () => {
    curriculum.course.mockReturnValue({ code: 'DEMO101', slug: 'demo', title: 'Demo Course', language: 'python', runtime: 'browser', level: 1, prerequisites: [], topics: [], cloIds: ['DEMO101-1'], status: 'live' })
    curriculum.loadCourseBundle.mockResolvedValue({
      code: 'DEMO101',
      clos: [{ id: 'DEMO101-1', course: 'DEMO101', ordinal: 1, outcome: 'First skill', topics: [], prerequisites: [], patterns: ['a'], assessableInCode: true }],
      exercises: [],
      lessons: [],
    })
    const learnerState = baseLearnerState({ currentCourse: 'DEMO101', path: ['DEMO101-1'], nextExerciseIds: [] })
    const { client, Wrapper } = withProviders({ learnerState })
    client.setQueryData(qk.attempts('student'), [])
    client.setQueryData(qk.wellness('student'), { prefs: { dailyGoal: 3 } })
    client.setQueryData(qk.lessonProgress('student'), [])
    client.setQueryData(qk.achievements('student'), [])
    client.setQueryData(qk.activityDays('student'), [])
    renderWith(<Dashboard />, Wrapper)
    await screen.findByText('Demo Course')
    noAgentCalls()
  })
})

// =============================================================================
// Trigger: onboarding-answer.
// =============================================================================

describe('surface & trigger: onboarding (onboarding-answer)', () => {
  beforeEach(() => {
    db.tables.learner_state = [{ user_id: 'student', state: baseLearnerState({ profile: { ...baseLearnerState().profile, onboardingComplete: false } }), version: 4 }]
  })

  async function answerFirstFive() {
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[i].options[0].label }))
      await screen.findByText(QUESTIONS[i + 1].text)
    }
  }

  it('answers questions one through five with zero agent calls, then fires exactly one onboarding-answer Profiler call on the sixth', async () => {
    agentSpies.call.mockResolvedValue({ ok: true, agent: 'profiler', reply: { nextQuestion: null, done: true, profileDelta: {} }, fallback: true, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } } as AgentEnvelope<unknown>)
    const { Wrapper } = withProviders({ learnerState: baseLearnerState({ profile: { ...baseLearnerState().profile, onboardingComplete: false } }) })
    renderWith(<Onboarding />, Wrapper)

    await answerFirstFive()
    expect(agentSpies.call).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: QUESTIONS[5].options[0].label }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/courses'))
    await waitFor(() => expect(agentSpies.call).toHaveBeenCalledTimes(1))
    expect(agentSpies.call).toHaveBeenCalledWith(expect.objectContaining({ agent: 'profiler', trigger: 'onboarding-answer' }))
    expect(agentSpies.stream).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Triggers: attempt-failed, hint-requested, attempt-passed, bank-miss --
// every one of them lives inside `useExerciseLoop`.
// =============================================================================

describe('surface & triggers: exercise loop (attempt-failed, hint-requested, attempt-passed, bank-miss)', () => {
  const current: ExercisePublic = { id: 'e1', cloId: 'c1', language: 'javascript', kind: 'code', difficulty: 3, pattern: 'scan', title: 'Find a value', prompt: 'Return the requested value.', starterCode: 'function solve() {}', origin: 'seed', tags: [], tests: [{ id: 't1', input: '[]', expected: '1', hidden: false }] }
  const candidate: ExercisePublic = { ...current, id: 'e2', pattern: 'reduce', title: 'Count the values' }
  const clo: Clo = { id: 'c1', course: 'course1', ordinal: 1, outcome: 'Use collections', topics: [], prerequisites: [], patterns: ['scan', 'reduce', 'partition'], assessableInCode: true, draft: false } as Clo
  const diagnosis = { intent: 'You were finding a value.', rootCause: 'The result is absent.', mistakeLabel: 'missing-return', fixPlan: ['Read the return path.', 'Return the value.', 'Run the tests again.'] }
  const hint = { hint: 'Check the return path.', planStep: 2 }
  const review = { improvements: ['Name the result clearly.', 'Keep the return path short.'] as [string, string], quality: 90, praise: 'You followed the data.' }
  const envelope = (agent: string, reply: unknown): AgentEnvelope<unknown> => ({ ok: true, agent: agent as never, reply, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } })
  const rowOf = (e: ExercisePublic): Row => ({ ...e, clo_id: e.cloId, starter_code: e.starterCode, verified: true })

  function resultOf(ok: boolean, tests = current.tests): RunResult {
    return { ok, results: tests.map((test) => ({ testId: test.id, passed: ok, actual: ok ? test.expected : 'undefined', expected: test.expected, stdout: '', stderr: '', durationMs: 2, ...(ok ? {} : { failureKind: 'wrong-answer' as const }) })), passedCount: ok ? tests.length : 0, totalCount: tests.length, runtime: 'browser' }
  }

  function setup(userId = 'student') {
    return renderHook(() => useExerciseLoop('e1'), { wrapper: withSession({ userId }) })
  }
  async function loaded() {
    const hook = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    return hook
  }

  beforeEach(() => {
    db.tables = {
      exercises_public: [rowOf(current), rowOf(candidate)],
      attempts: [],
      mastery: [],
      learner_state: [{ user_id: 'student', state: { ...compileLearnerState({ id: 'student' }, [], [], [], null), version: 1 }, version: 1 }],
    }
    curriculum.exerciseFrom.mockReturnValue(null)
    curriculum.clo.mockReturnValue(clo)
    curriculum.closFor.mockReturnValue([clo])
    curriculum.course.mockReturnValue({ code: 'course1', slug: 'course1', title: 'Course 1', language: 'javascript', runtime: 'browser', level: 1, prerequisites: [], topics: [], cloIds: ['c1'], status: 'live' })
    runtimeMocks.run.mockImplementation(async (req: { code: string; tests: unknown[] }) =>
      req.tests.length === 0 ? { ...resultOf(true, []), stdout: 'free output' } : resultOf(req.code.includes('fixed') || req.code.includes('reference'), req.tests as typeof current.tests))
    agentSpies.stream.mockImplementation(async (req: { agent: string }, onPartial: (p: unknown) => void) => {
      onPartial(req.agent === 'diagnoser' ? { rootCause: 'Unvalidated partial.' } : { hint: 'Partial hint.' })
      return envelope(req.agent, req.agent === 'diagnoser' ? diagnosis : hint)
    })
    agentSpies.call.mockImplementation(async (req: { agent: string }) => envelope(req.agent, req.agent === 'reviewer' ? review : { path: ['c1'], nextExerciseIds: ['e2'], focus: 'Continue.' }))
  })

  it('a wrong submit fires attempt-failed on the diagnoser (streamAgent) and nothing else', async () => {
    const hook = await loaded()
    act(() => hook.result.current.setCode('wrong'))
    await act(async () => { await hook.result.current.submit() })
    expect(agentSpies.stream).toHaveBeenCalledWith(expect.objectContaining({ agent: 'diagnoser', trigger: 'attempt-failed' }), expect.any(Function))
    expect(agentSpies.call).not.toHaveBeenCalled()
  })

  it('requesting a hint after a failure fires hint-requested on the coach (streamAgent)', async () => {
    const hook = await loaded()
    act(() => hook.result.current.setCode('wrong'))
    await act(async () => { await hook.result.current.submit() })
    act(() => hook.result.current.setCode('edited'))
    await act(async () => { await hook.result.current.requestHint() })
    expect(agentSpies.stream).toHaveBeenCalledWith(expect.objectContaining({ agent: 'coach', trigger: 'hint-requested' }), expect.any(Function))
  })

  it('a correct submit fires attempt-passed on the reviewer (callAgent)', async () => {
    const hook = await loaded()
    act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(agentSpies.call).toHaveBeenCalledWith(expect.objectContaining({ agent: 'reviewer', trigger: 'attempt-passed' }))
  })

  it('an exhausted bank fires bank-miss on the author (callAgent) while queuing the next rep', async () => {
    db.tables.exercises_public = [rowOf({ ...current, difficulty: 1 })]
    db.tables.attempts = [{ id: 'old', user_id: 'student', exercise_id: 'e2', passed: true, hint_count: 0, created_at: '2026-09-04T10:00:00Z' }]
    // exercises_public still needs the candidate row present so `exampleIds` (two distinct
    // examples on the CLO) can be built, but excluded from selection by the prior attempt above.
    db.tables.exercises_public.push(rowOf(candidate))
    const generated = { ...candidate, id: 'generated', referenceSolution: 'reference' }
    agentSpies.call.mockImplementation(async (req: { agent: string }) => envelope(req.agent, req.agent === 'reviewer' ? review : { exercise: generated }))
    const verify = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', verify)
    const hook = await loaded()
    act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    const authorCall = agentSpies.call.mock.calls.find((call: unknown[]) => (call[0] as { agent: string }).agent === 'author')?.[0]
    expect(authorCall).toMatchObject({ agent: 'author', trigger: 'bank-miss' })
    vi.unstubAllGlobals()
  })
})

// =============================================================================
// Trigger: buddy-message.
// =============================================================================

describe('surface & trigger: buddy drawer (buddy-message)', () => {
  it('sending a message fires exactly one buddy-message call on streamAgent', async () => {
    agentSpies.stream.mockResolvedValue({ ok: true, agent: 'buddy', reply: { onTopic: true, reply: 'Try checking your loop bounds.' }, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } } as AgentEnvelope<unknown>)
    nav.pathname.mockReturnValue('/dashboard')
    const { Wrapper } = withProviders({ learnerState: baseLearnerState({ currentCourse: 'course1' }) })
    renderWith(<BuddyDrawer open onOpenChange={() => {}} />, Wrapper)

    const textarea = await screen.findByLabelText('Message your Buddy')
    fireEvent.change(textarea, { target: { value: 'Why does my loop never end?' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(agentSpies.stream).toHaveBeenCalledTimes(1))
    expect(agentSpies.stream).toHaveBeenCalledWith(expect.objectContaining({ agent: 'buddy', trigger: 'buddy-message' }), expect.any(Function))
    expect(agentSpies.call).not.toHaveBeenCalled()
  })
})

// =============================================================================
// Static guard (fix round 1, F1 point 2): every describe block above proves
// its OWN surface calls no agent, but none of that stops a brand-new surface
// from shipping with no describe block here at all -- the header comment
// asks the next author to extend this file, it cannot enforce it. This is
// the one assertion a new surface cannot walk past: the choke point
// (`@/lib/agents/client`) may only ever be imported by the four modules that
// already hold the seven frozen triggers. A fifth importer fails this test
// immediately, before anyone has to remember to add a describe block for it.
// =============================================================================

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const SRC_DIR = join(ROOT, 'src')

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walkSourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

describe('static guard: @/lib/agents/client has exactly four importers', () => {
  it('the frozen choke point is imported only by the four modules that hold the seven triggers', () => {
    const importPattern = /from ['"]@\/lib\/agents\/client['"]/
    const importers = walkSourceFiles(SRC_DIR)
      .filter((file) => importPattern.test(readFileSync(file, 'utf8')))
      .map((file) => `src${file.slice(SRC_DIR.length)}`.split(sep).join('/'))
      .sort()

    expect(importers).toEqual([
      'src/app/(app)/courses/lib.ts',
      'src/app/(app)/onboarding/page.tsx',
      'src/components/buddy/Drawer.tsx',
      'src/hooks/useExerciseLoop.ts',
    ])
  })
})
