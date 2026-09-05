import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerState } from '@/lib/contracts'
import Dashboard from './page'
import { AppShell } from '@/components/shell/AppShell'

const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), pathname: vi.fn() }))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => mocks.query(table, columns, column, value),
          order: () => mocks.query(table, columns, column, value),
        }),
        in: (column: string, value: string[]) => mocks.query(table, columns, column, value),
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
    { id: 'clo-internal', ordinal: 1, outcome: 'Write programs with loops' },
    { id: 'clo-new', ordinal: 2, outcome: 'Organize code into functions' },
  ], error: null })
  if (table === 'exercises_public') return Promise.resolve({ data: [
    { id: 'exercise-a', title: 'Count the vowels', difficulty: 1, language: 'python', clo_id: 'clo-internal' },
    { id: 'exercise-b', title: 'Find the largest number', difficulty: 2, language: 'python', clo_id: 'clo-internal' },
    { id: 'exercise-c', title: 'Trace the loop', difficulty: 3, language: 'python', clo_id: 'clo-internal' },
    { id: 'exercise-d', title: 'An exercise for later', difficulty: 4, language: 'python', clo_id: 'clo-new' },
  ], error: null })
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
    expect(screen.getByRole('link', { name: 'Change course' }).getAttribute('href')).toBe('/onboarding')
    expect(screen.getByRole('link', { name: 'Try a de-rot drill' }).getAttribute('href')).toBe('/derot')
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
    expect(within(screen.getByRole('region', { name: 'Next exercises' })).getByRole('link', { name: 'Review your course' }).getAttribute('href')).toBe('/onboarding')
  })
})

describe('app shell', () => {
  it('keeps the exercise root wellness strip compact', () => {
    mocks.pathname.mockReturnValue('/exercise')
    render(<AppShell><h1>Choose an exercise</h1></AppShell>)
    expect(screen.queryByText('Keep a little balance.')).toBeNull()
    expect(screen.getByText(/Take a breath between exercises/)).toBeTruthy()
  })

  it('offers accessible navigation, a wellness slot, and a contextual Buddy dialog', async () => {
    render(<AppShell><h1>Dashboard content</h1></AppShell>)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Courses' }).getAttribute('href')).toBe('/dashboard#course')
    expect(within(nav).getByRole('link', { name: 'De-rot' }).getAttribute('href')).toBe('/derot')
    expect(within(nav).getByRole('link', { name: 'Reports' }).getAttribute('href')).toBe('/reports')
    expect(screen.getByRole('complementary', { name: 'Wellness' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Buddy' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Your coding Buddy' })).toBeTruthy())
    expect(screen.getByText(/4-day exercise streak/)).toBeTruthy()
    expect(screen.getByText(/Buddy chat is not available yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
