import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerState, LessonProgress, UserAchievement } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import Dashboard from './page'
import { AppShell } from '@/components/shell/AppShell'

// sonner's Toaster (mounted by the wellness dock) reads window.matchMedia for OS theme
// detection. Real browsers always have it; jsdom does not, and the dock no longer patches
// it in for production, so the "app shell" tests below must stub it themselves.
beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

const mocks = vi.hoisted(() => ({
  session: vi.fn(), pathname: vi.fn(), course: vi.fn(), loadCourseBundle: vi.fn(),
  supabaseFrom: vi.fn(), warmup: vi.fn(), query: vi.fn(),
}))

// T2.1: every read this screen makes beyond the session store comes from a
// query key `(app)/layout.tsx` already seeded through `QuerySeed` — so
// `useSession` has to honour a selector the way the real store does (T2.1's
// own hooks read `useSession((s) => s.user?.id ?? null)`), not just return
// the whole session unconditionally the way a selector-less mock would.
vi.mock('@/store/session', () => ({ useSession: (selector?: (session: ReturnType<typeof mocks.session>) => unknown) => (selector ? selector(mocks.session()) : mocks.session()) }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname() }))
vi.mock('@/lib/curriculum', () => ({
  course: (code: string) => mocks.course(code),
  loadCourseBundle: (code: string) => mocks.loadCourseBundle(code),
}))
vi.mock('@/lib/runtimes', () => ({ getRuntime: (language: string) => ({ language, warmup: () => mocks.warmup(language) }) }))
// Every hook this screen calls resolves through `createClient` (never a bare
// global `fetch`), so a spy here is what "zero Supabase reads fire from the
// dashboard component on mount" (the brief's own acceptance line) asserts
// against — every value the page shows instead comes from the seeded cache below.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      mocks.supabaseFrom(table)
      return { select: () => ({ eq: () => ({ maybeSingle: () => mocks.query(table), order: () => ({ limit: () => mocks.query(table) }) }) }) }
    },
  }),
}))

function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'learner-one',
    profile: {
      displayName: 'Maya', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.7, theory: 0.3 },
      tone: 'direct', verbosity: 'short',
      motivation: { why: 'Build useful things', beyondCourses: true, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'DEMO101', path: ['DEMO101-1', 'DEMO101-2'],
    nextExerciseIds: ['exercise-b', 'exercise-a', 'exercise-c', 'exercise-d'],
    mastery: {
      'DEMO101-1': { userId: 'learner-one', cloId: 'DEMO101-1', score: 62, chain: 2, patternsPassed: ['loops', 'conditions'], closed: false, lastAttemptAt: '2026-09-05T09:00:00Z' },
    },
    recentMistakes: [],
    streak: { exerciseDays: 4, derotDays: 2, lastExerciseDate: '2026-09-06', lastDerotDate: '2026-09-05' },
    points: 1230, integrityScore: 0, accountStatus: 'active', version: 2, updatedAt: '2026-09-05T09:00:00Z',
    ...overrides,
  }
}

function session(state: LearnerState | null = learnerState(), status = 'active') {
  return {
    user: { id: 'learner-one' },
    profile: { id: 'learner-one', account_status: status, restricted_until: status === 'restricted' ? '2026-09-06T09:00:00Z' : null },
    learnerState: state, setLearnerState: vi.fn(),
  }
}

function courseFixture(overrides: Record<string, unknown> = {}) {
  return { code: 'DEMO101', slug: 'demo', title: 'Programming foundations', language: 'python', runtime: 'browser', level: 1, prerequisites: [], topics: [], cloIds: ['DEMO101-1', 'DEMO101-2'], status: 'live', ...overrides }
}

function exerciseFixture(id: string, cloId = 'DEMO101-1') {
  return { id, cloId, language: 'python', kind: 'code', difficulty: 3, pattern: id, title: `Exercise ${id}`, prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] }
}

function bundleFixture() {
  return {
    code: 'DEMO101',
    clos: [
      { id: 'DEMO101-1', course: 'DEMO101', ordinal: 1, outcome: 'Write programs with loops', topics: [], prerequisites: [], patterns: ['a'], assessableInCode: true },
      { id: 'DEMO101-2', course: 'DEMO101', ordinal: 2, outcome: 'Organize code into functions', topics: [], prerequisites: ['DEMO101-1'], patterns: ['a'], assessableInCode: true },
    ],
    exercises: [exerciseFixture('exercise-a'), exerciseFixture('exercise-b'), exerciseFixture('exercise-c'), exerciseFixture('exercise-d')],
    lessons: [],
  }
}

function seededClient(overrides: { attempts?: unknown[]; wellness?: unknown; lessonProgress?: LessonProgress[]; achievements?: UserAchievement[] } = {}): QueryClient {
  const client = makeQueryClient()
  client.setQueryData(qk.attempts('learner-one'), overrides.attempts ?? [])
  client.setQueryData(qk.wellness('learner-one'), overrides.wellness ?? { prefs: { dailyGoal: 3 } })
  client.setQueryData(qk.lessonProgress('learner-one'), overrides.lessonProgress ?? [])
  client.setQueryData(qk.achievements('learner-one'), overrides.achievements ?? [])
  return client
}

function renderDashboard(client: QueryClient = seededClient()) {
  return render(<QueryClientProvider client={client}><Dashboard /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname.mockReturnValue('/dashboard')
  mocks.session.mockReturnValue(session())
  mocks.course.mockReturnValue(courseFixture())
  mocks.loadCourseBundle.mockResolvedValue(bundleFixture())
  // Only the "app shell" describe block below ever reaches this (a fresh,
  // un-seeded QueryClient) -- every "dashboard" test pre-seeds the cache
  // instead and asserts `mocks.supabaseFrom` is never even called.
  mocks.query.mockResolvedValue({ data: null, error: null })
})
afterEach(() => {
  cleanup()
  // A test that throws before its own `vi.useRealTimers()` would otherwise
  // leave fake timers on for every test after it in this file.
  vi.useRealTimers()
})

describe('dashboard', () => {
  it('renders "Today" entirely from the session store and the layout-seeded cache -- zero Supabase round trips', async () => {
    renderDashboard()
    expect(await screen.findByText('Programming foundations')).toBeTruthy()
    expect(screen.getByText('Pick up where you left off')).toBeTruthy()
    expect(screen.getByText(/You were 2 of 3 into Write programs with loops/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Exercise streak' }).textContent).toContain('4 days')
    expect(screen.getByText('1,230')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Next up' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Level \d+/ })).toBeTruthy()
    expect(mocks.supabaseFrom).not.toHaveBeenCalled()
  })

  it('links the resume card to the course home and to /courses, matching the dashboard-links follow-up from T1.6', async () => {
    renderDashboard()
    await screen.findByText('Programming foundations')
    expect(screen.getByRole('link', { name: /Open your course/ }).getAttribute('href')).toBe('/course/DEMO101')
    expect(screen.getByRole('link', { name: 'Change course' }).getAttribute('href')).toBe('/courses')
    expect(screen.getByRole('link', { name: 'Try a de-rot drill' }).getAttribute('href')).toBe('/derot')
  })

  it('offers an actionable "Pick a course" start when no course is chosen, without inventing progress', () => {
    mocks.session.mockReturnValue(session(learnerState({ currentCourse: null, path: [], nextExerciseIds: [] })))
    renderDashboard()
    expect(screen.getByRole('link', { name: /Choose a course/ }).getAttribute('href')).toBe('/onboarding')
    expect(screen.getByRole('group', { name: 'Exercise streak' }).textContent).toContain('4 days')
    expect(screen.queryByText('Pick up where you left off')).toBeNull()
  })

  it('shows the walkthrough-in-flight resume line when a lesson_progress row is started for the current skill', async () => {
    const client = seededClient({ lessonProgress: [{ userId: 'learner-one', lessonId: 'DEMO101-1', cloId: 'DEMO101-1', status: 'started', blockIndex: 1, checksPassed: 0, checksFailed: 0, lessonVersion: 1, startedAt: '2026-09-05T00:00:00Z', completedAt: null, updatedAt: '2026-09-05T00:00:00Z' }] })
    renderDashboard(client)
    await screen.findByText('Continue the walkthrough')
    expect(screen.getByText(/You were partway through Write programs with loops/)).toBeTruthy()
  })

  it('reports today\'s goal progress from the seeded attempts and wellness rows', async () => {
    const client = seededClient({
      attempts: [{ id: 'a1', userId: 'learner-one', exerciseId: 'exercise-a', code: '', results: [], passed: true, durationMs: 100, hintCount: 0, createdAt: new Date().toISOString() }],
      wellness: { prefs: { dailyGoal: 2 } },
    })
    renderDashboard(client)
    await screen.findByText('Programming foundations')
    expect(screen.getByText('1 / 2')).toBeTruthy()
  })

  it('shows the empty-trophies line when nothing is unlocked yet, and real trophies once some are', async () => {
    renderDashboard()
    await screen.findByText('Programming foundations')
    expect(screen.getByText('Nothing on the shelf yet. First pass puts something here.')).toBeTruthy()
    cleanup()

    const client = seededClient({ achievements: [{ userId: 'learner-one', achievementId: 'first-blood', unlockedAt: '2026-09-05T00:00:00Z' }] })
    renderDashboard(client)
    await screen.findByText('Programming foundations')
    expect(screen.getByText('First Blood')).toBeTruthy()
    expect(screen.queryByText('Nothing on the shelf yet. First pass puts something here.')).toBeNull()
  })

  it('warns of an at-risk streak late in the day with no rep counted yet today', async () => {
    // Fakes only `Date` (`toFake: ['Date']`) -- faking `setTimeout` too would
    // freeze `findByText`'s own polling, which runs on real timers here.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-06T19:00:00Z'))
    mocks.session.mockReturnValue(session(learnerState({ streak: { exerciseDays: 4, derotDays: 2, lastExerciseDate: '2026-09-05', lastDerotDate: '2026-09-05' } })))
    renderDashboard()
    await screen.findByText('Programming foundations')
    expect(screen.getByText('Streak at risk')).toBeTruthy()
  })

  it('blocks exercise links for a restricted account but keeps de-rot and the course link open', async () => {
    mocks.session.mockReturnValue(session(learnerState(), 'restricted'))
    renderDashboard()
    await screen.findByText('Programming foundations')
    expect(within(screen.getByRole('region', { name: 'Next up' })).queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText(/Walkthroughs and De-rot stay open/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Try a de-rot drill' })).toBeTruthy()
  })

  it('recovers with retry when the static curriculum bundle fails to load, keeping the seeded streak and points visible', async () => {
    mocks.loadCourseBundle.mockRejectedValue(new Error('offline'))
    renderDashboard()
    await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByRole('group', { name: 'Exercise streak' }).textContent).toContain('4 days')
    mocks.loadCourseBundle.mockResolvedValue(bundleFixture())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Pick up where you left off')
  })

  it('warms the runtime for the top next-up card\'s language at idle (spec 5.4), scoped to this route only', async () => {
    renderDashboard()
    await screen.findByText('Programming foundations')
    await waitFor(() => expect(mocks.warmup).toHaveBeenCalledWith('python'))
  })
})

// `AppShell`'s header also mounts `SoundToggle`, `ThemeQuickSwitch` and
// `DockControl` (T0.7) -- each reads `useWellness()` (needs a QueryClient in
// context) and/or `next-themes`' `useTheme()` (needs a `ThemeProvider`),
// neither of which this suite's plain `render(<AppShell>...)` supplied
// before. In the real app both come from the root layout's `<Providers>`;
// here they are supplied directly, matching how `SoundToggle.test.tsx` and
// `ThemeQuickSwitch.test.tsx` wrap those components in isolation.
function renderShell(children: ReactNode, client: QueryClient = makeQueryClient()) {
  return render(
    <ThemeProvider attribute="data-theme" themes={['midnight', 'amber', 'paper', 'arcade']} defaultTheme="midnight" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('app shell', () => {
  it('paints the learner\'s stored dock placement on the very first render, from the layout-seeded cache -- never the default-then-reflow the T2.4 review caught', () => {
    // Mirrors exactly what `(app)/layout.tsx` seeds through `QuerySeed`: the
    // wellness row, already resolved through `resolveWellnessPrefs`, in the
    // cache before this component ever mounts -- no `waitFor`, because there
    // is nothing to wait for.
    const client = seededClient({ wellness: { prefs: { dock: { placement: 'left', collapsed: false, compactOnExercise: true, corner: 'br' } } } })
    renderShell(<AppShell><h1>Dashboard content</h1></AppShell>, client)
    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    // `left` renders through `ShellLayout`'s left-rail template, ordered
    // before `main` -- checking for the reflow means checking this on the
    // very first synchronous render, not after a `findBy`.
    expect(aside.className).toContain('lg:order-first')
    expect(screen.queryByRole('button', { name: /show wellness dock/i })).toBeNull()
  })

  it('R6.3: never overrides the wellness dock\'s placement on the exercise route, only its collapse state', () => {
    mocks.pathname.mockReturnValue('/exercise')
    renderShell(<AppShell><h1>Choose an exercise</h1></AppShell>)
    // Placement stays the default right rail (`role="complementary"`, not
    // hidden or moved); `compactOnExercise` is on by default, so the content
    // collapses to the icon-only rail here instead of a horizontal strip --
    // the v1 "always a compact strip" rule this test used to pin is gone.
    expect(screen.getByRole('complementary', { name: 'Wellness' })).toBeTruthy()
    expect(screen.getByLabelText('Wellness, collapsed')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Wellness' })).toBeNull()
  })

  it('R6.3: expands the dock on the exercise route once compactOnExercise is turned off, still in its own placement', async () => {
    mocks.pathname.mockReturnValue('/exercise')
    mocks.query.mockReturnValue(Promise.resolve({ data: { prefs: { dock: { placement: 'right', compactOnExercise: false } } }, error: null }))
    renderShell(<AppShell><h1>Choose an exercise</h1></AppShell>)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Wellness' })).toBeTruthy())
    expect(screen.queryByLabelText('Wellness, collapsed')).toBeNull()
  })

  it('offers accessible navigation, a wellness slot, and a contextual Buddy dialog', async () => {
    renderShell(<AppShell><h1>Dashboard content</h1></AppShell>)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    // "Courses" now points at /courses (T1.6's route) rather than the old
    // dashboard-anchor link, and the reports nav item reads "Progress".
    expect(within(nav).getByRole('link', { name: 'Courses' }).getAttribute('href')).toBe('/courses')
    expect(within(nav).getByRole('link', { name: 'De-rot' }).getAttribute('href')).toBe('/derot')
    expect(within(nav).getByRole('link', { name: 'Progress' }).getAttribute('href')).toBe('/reports')
    expect(screen.getByRole('complementary', { name: 'Wellness' })).toBeTruthy()
    // The header's right-hand cluster (ShellHeaderControls, T0.7): the sound
    // toggle and theme quick-switch are always present; the dock re-open
    // glyph stays hidden because the default dock placement is not 'hidden'.
    expect(screen.getByRole('button', { name: /mute sound/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /choose theme/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /show wellness dock/i })).toBeNull()
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('href')).toBe('/account')
    fireEvent.click(screen.getByRole('button', { name: 'Buddy' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Your coding Buddy' })).toBeTruthy())
    expect(screen.getByText('Ask about the code you are stuck on, or why a pattern keeps failing.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('marks Courses current on the route it now links to', () => {
    mocks.pathname.mockReturnValue('/courses')
    renderShell(<AppShell><h1>Courses content</h1></AppShell>)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Courses' }).getAttribute('aria-current')).toBe('page')
  })
})
