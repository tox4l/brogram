import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerState } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import Dashboard from './page'
import { AppShell } from '@/components/shell/AppShell'

// sonner's Toaster (mounted by the wellness rail) reads window.matchMedia for OS theme
// detection. Real browsers always have it; jsdom does not, and Rail.tsx no longer patches
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

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), pathname: vi.fn() }))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: () => mocks.query(table, columns, column, value),
          order: () => mocks.query(table, columns, column, value),
          // exercises_public reads only the verified bank: eq('verified', true).in('id', ids).
          in: (inColumn: string, inValue: string[]) => {
            expect([column, value]).toEqual(['verified', true])
            return mocks.query(table, columns, inColumn, inValue)
          },
        }),
      }),
    }),
  }),
}))

function learnerState(): LearnerState {
  return {
    userId: 'learner-one',
    profile: {
      displayName: 'Maya', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.7, theory: 0.3 },
      tone: 'direct', verbosity: 'short',
      motivation: { why: 'Build useful things', beyondCourses: true, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'course-internal', path: ['clo-internal'],
    nextExerciseIds: ['exercise-b', 'exercise-a', 'exercise-c', 'exercise-d'],
    mastery: {
      'clo-internal': {
        userId: 'learner-one', cloId: 'clo-internal', score: 62, chain: 2,
        patternsPassed: ['loops', 'conditions'], closed: false, lastAttemptAt: '2026-09-05T09:00:00Z',
      },
    },
    recentMistakes: [],
    streak: { exerciseDays: 4, derotDays: 2, lastExerciseDate: '2026-09-05', lastDerotDate: '2026-09-05' },
    points: 1230, integrityScore: 0, accountStatus: 'active', version: 2, updatedAt: '2026-09-05T09:00:00Z',
  }
}

function session(state: LearnerState | null = learnerState(), status = 'active') {
  return {
    user: { id: 'learner-one' },
    profile: { id: 'learner-one', account_status: status, restricted_until: status === 'restricted' ? '2026-09-06T09:00:00Z' : null },
    learnerState: state, setLearnerState: vi.fn(),
  }
}

function successfulQuery(table: string) {
  if (table === 'courses') return Promise.resolve({ data: { code: 'course-internal', title: 'Programming foundations', language: 'python' }, error: null })
  if (table === 'clos') return Promise.resolve({ data: [
    { id: 'clo-internal', ordinal: 1, outcome: 'Write programs with loops', draft: false },
    { id: 'clo-new', ordinal: 2, outcome: 'Organize code into functions', draft: false },
  ], error: null })
  if (table === 'exercises_public') return Promise.resolve({ data: [
    { id: 'exercise-a', title: 'Count the vowels', difficulty: 1, language: 'python', clo_id: 'clo-internal' },
    { id: 'exercise-b', title: 'Find the largest number', difficulty: 2, language: 'python', clo_id: 'clo-internal' },
    { id: 'exercise-c', title: 'Trace the loop', difficulty: 3, language: 'python', clo_id: 'clo-internal' },
    { id: 'exercise-d', title: 'An exercise for later', difficulty: 4, language: 'python', clo_id: 'clo-new' },
  ], error: null })
  if (table === 'wellness') return Promise.resolve({ data: null, error: null })
  if (table === 'buddy_messages') return Promise.resolve({ data: [], error: null })
  throw new Error(`Unexpected table: ${table}`)
}

beforeEach(() => {
  mocks.pathname.mockReturnValue('/dashboard')
  mocks.session.mockReturnValue(session())
  mocks.query.mockImplementation(successfulQuery)
})
afterEach(cleanup)

describe('dashboard', () => {
  it('shows the saved plan in planner order, scores, both streaks, and mastery for every course outcome', async () => {
    render(<Dashboard />)
    await screen.findByText('Programming foundations')
    const next = screen.getByRole('region', { name: 'Next exercises' })
    expect(within(next).getAllByRole('link').map((link) => link.getAttribute('href')))
      .toEqual(['/exercise/exercise-b', '/exercise/exercise-a', '/exercise/exercise-c'])
    expect(screen.queryByText('An exercise for later')).toBeNull()
    expect(screen.getByText('1,230')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Exercise streak' }).textContent).toContain('4 days')
    expect(screen.getByRole('group', { name: 'De-rot streak' }).textContent).toContain('2 days')
    expect(screen.getByRole('progressbar', { name: 'Write programs with loops' }).getAttribute('aria-valuenow')).toBe('62')
    expect(screen.getByRole('progressbar', { name: 'Organize code into functions' }).getAttribute('aria-valuenow')).toBe('0')
    expect(screen.queryByText('course-internal')).toBeNull()
    expect(screen.queryByText('clo-internal')).toBeNull()
    // T1.6: switching courses moves to its own route; the Profiler never runs again.
    expect(screen.getByRole('link', { name: 'Change course' }).getAttribute('href')).toBe('/courses')
    expect(screen.getByRole('link', { name: 'Try a de-rot drill' }).getAttribute('href')).toBe('/derot')
  })

  it('shows the persisted Planner focus line under the current course, falling back when none is saved', async () => {
    render(<Dashboard />)
    await screen.findByText('Programming foundations')
    // `learnerState()` never sets `focus` (it is not part of the frozen LearnerState
    // contract), so the same sentence the Planner falls back to itself should show.
    expect(screen.getByText('Your next exercises are still being prepared.')).toBeTruthy()
    cleanup()

    // `focus` rides along as an extra jsonb key; a persisted one takes priority.
    const withFocus = { ...learnerState(), focus: 'Start with the basics.' }
    mocks.session.mockReturnValue(session(withFocus))
    render(<Dashboard />)
    await screen.findByText('Programming foundations')
    expect(screen.getByText('Start with the basics.')).toBeTruthy()
    expect(screen.queryByText('Your next exercises are still being prepared.')).toBeNull()
  })

  it('renders a muted marker beside a draft outcome instead of hiding it', async () => {
    mocks.query.mockImplementation((table: string) => table === 'clos'
      ? Promise.resolve({ data: [
        { id: 'clo-internal', ordinal: 1, outcome: 'Write programs with loops', draft: true },
        { id: 'clo-new', ordinal: 2, outcome: 'Organize code into functions', draft: false },
      ], error: null })
      : successfulQuery(table))
    render(<Dashboard />)
    await screen.findByText('Write programs with loops')
    expect(screen.getByText('Draft outcome')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Write programs with loops' })).toBeTruthy()
  })

  it('offers an actionable start when no learner state exists without inventing progress', () => {
    mocks.session.mockReturnValue(session(null))
    render(<Dashboard />)
    expect(screen.getByRole('link', { name: 'Choose a course' }).getAttribute('href')).toBe('/onboarding')
    expect(screen.getByText('Your next exercises start here.')).toBeTruthy()
    expect(screen.getByText('Your outcomes will appear here.')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Exercise streak' }).textContent).toContain('0 days')
    expect(screen.getByRole('group', { name: 'De-rot streak' }).textContent).toContain('0 days')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('keeps recommended exercise details but removes exercise navigation for restricted accounts', async () => {
    mocks.session.mockReturnValue(session(learnerState(), 'restricted'))
    render(<Dashboard />)
    await screen.findByText('Find the largest number')
    expect(within(screen.getByRole('region', { name: 'Next exercises' })).queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('Exercises are paused while your account is restricted.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Try a de-rot drill' })).toBeTruthy()
  })

  it('keeps saved progress visible during metadata loading and recovers from errors with retry', async () => {
    mocks.query.mockResolvedValue({ data: null, error: { message: 'Connection lost' } })
    render(<Dashboard />)
    expect(screen.getByRole('status').textContent).toContain('Loading your course and exercise details')
    expect(screen.getByText('1,230')).toBeTruthy()
    await screen.findByRole('alert')
    mocks.query.mockImplementation(successfulQuery)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Programming foundations')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('hides stale course details and ignores an old request when the learner switches courses', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    const oldCourse = new Promise((resolve) => { resolveOld = resolve })
    mocks.query.mockImplementation((table: string, _columns: string, _column: string, value: string) => {
      if (table === 'courses' && value === 'course-internal') return oldCourse
      if (table === 'courses') return Promise.resolve({ data: { code: 'other-course', title: 'Working with data', language: 'sql' }, error: null })
      return successfulQuery(table)
    })
    const view = render(<Dashboard />)
    const nextState = learnerState()
    nextState.currentCourse = 'other-course'
    mocks.session.mockReturnValue(session(nextState))
    view.rerender(<Dashboard />)
    await screen.findByText('Working with data')
    await act(async () => { resolveOld({ data: { code: 'course-internal', title: 'Stale course title', language: 'python' }, error: null }) })
    expect(screen.queryByText('Stale course title')).toBeNull()
    expect(screen.getByText('Working with data')).toBeTruthy()
  })

  it('explains missing exercise rows and points to course setup instead of linking to a missing exercise', async () => {
    mocks.query.mockImplementation((table: string) => table === 'exercises_public'
      ? Promise.resolve({ data: [], error: null }) : successfulQuery(table))
    render(<Dashboard />)
    await screen.findByText('These exercises are no longer available.')
    // T1.6: switching courses moves to its own route; the Profiler never runs again.
    expect(within(screen.getByRole('region', { name: 'Next exercises' })).getByRole('link', { name: 'Review your course' }).getAttribute('href')).toBe('/courses')
  })
})

// `AppShell`'s header now also mounts `SoundToggle`, `ThemeQuickSwitch` and
// `DockControl` (T0.7) -- each reads `useWellness()` (needs a QueryClient in
// context) and/or `next-themes`' `useTheme()` (needs a `ThemeProvider`),
// neither of which this suite's plain `render(<AppShell>...)` supplied
// before. In the real app both come from the root layout's `<Providers>`;
// here they are supplied directly, matching how `SoundToggle.test.tsx` and
// `ThemeQuickSwitch.test.tsx` wrap those components in isolation.
function renderShell(children: ReactNode) {
  const client = makeQueryClient()
  return render(
    <ThemeProvider attribute="data-theme" themes={['midnight', 'amber', 'paper', 'arcade']} defaultTheme="midnight" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('app shell', () => {
  it('keeps the exercise root wellness strip compact', () => {
    mocks.pathname.mockReturnValue('/exercise')
    renderShell(<AppShell><h1>Choose an exercise</h1></AppShell>)
    // The compact strip renders the same water/stretch controls inline instead of the
    // full rail's labelled buttons and headings.
    expect(screen.queryByText('Water & stretch')).toBeNull()
    expect(screen.queryByText('Log water')).toBeNull()
    expect(screen.getByText('Water')).toBeTruthy()
    expect(screen.getByText('Stretch')).toBeTruthy()
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
