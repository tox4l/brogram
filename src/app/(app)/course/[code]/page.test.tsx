import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearnerState } from '@/lib/contracts'
import { makeQueryClient } from '@/lib/query/client'
import CoursePage from './page'

const mocks = vi.hoisted(() => ({
  params: vi.fn(),
  session: vi.fn(),
  course: vi.fn(),
  loadCourseBundle: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
  supabaseFrom: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: () => mocks.params(),
  useRouter: () => ({ prefetch: mocks.prefetch, push: mocks.push }),
}))
vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('@/lib/curriculum', () => ({
  course: (code: string) => mocks.course(code),
  loadCourseBundle: (code: string) => mocks.loadCourseBundle(code),
}))
// Every hook in this tree that could read the network goes through `createClient`
// (never a bare global `fetch`), so a spy here is what "no Supabase read fires on
// mount" (the brief's own acceptance line) actually asserts against.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: mocks.supabaseFrom }) }))

function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'learner-one',
    profile: {
      displayName: 'Maya', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'direct', verbosity: 'short',
      motivation: { why: 'Build things', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'DEMO101', path: ['DEMO101-1', 'DEMO101-2'], nextExerciseIds: ['E-1', 'E-2', 'E-3'],
    mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-05T00:00:00Z',
    ...overrides,
  }
}

function courseFixture(overrides: Record<string, unknown> = {}) {
  return {
    code: 'DEMO101', slug: 'demo', title: 'Demo Course', language: 'python', runtime: 'browser',
    level: 1, prerequisites: [], topics: [], cloIds: ['DEMO101-1', 'DEMO101-2'], status: 'live',
    ...overrides,
  }
}

function exerciseFixture(id: string) {
  return { id, cloId: 'DEMO101-1', language: 'python', kind: 'code', difficulty: 3, pattern: 'a', title: `Exercise ${id}`, prompt: '', starterCode: '', tests: [], origin: 'seed', tags: [] }
}

function bundleFixture() {
  return {
    code: 'DEMO101',
    clos: [
      { id: 'DEMO101-1', course: 'DEMO101', ordinal: 1, outcome: 'First skill', topics: [], prerequisites: [], patterns: ['a'], assessableInCode: true },
      { id: 'DEMO101-2', course: 'DEMO101', ordinal: 2, outcome: 'Second skill', topics: [], prerequisites: ['DEMO101-1'], patterns: ['a'], assessableInCode: true },
    ],
    exercises: [exerciseFixture('E-1'), exerciseFixture('E-2'), exerciseFixture('E-3')],
    lessons: [],
  }
}

function renderPage() {
  const client = makeQueryClient()
  return render(<QueryClientProvider client={client}><CoursePage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.params.mockReturnValue({ code: 'DEMO101' })
  mocks.session.mockReturnValue({ learnerState: learnerState() })
  mocks.course.mockReturnValue(courseFixture())
  mocks.loadCourseBundle.mockResolvedValue(bundleFixture())
})
afterEach(cleanup)

describe('course home', () => {
  it('opens on the path map, next-up stack and flat list built from the static bundle plus the seeded learner state -- zero Supabase round trips', async () => {
    renderPage()
    expect(await screen.findByText('Demo Course')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your path' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Skill path' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Next up' })).toBeTruthy()
    expect(screen.getByText('Every skill in this course')).toBeTruthy()
    expect(mocks.supabaseFrom).not.toHaveBeenCalled()
  })

  it('never renders a wall of locked nodes for a learner whose only course carries a cross-course prerequisite', async () => {
    mocks.course.mockReturnValue(courseFixture({ code: 'INFS1201' }))
    mocks.params.mockReturnValue({ code: 'INFS1201' })
    mocks.loadCourseBundle.mockResolvedValue({
      code: 'INFS1201',
      clos: [{ id: 'INFS1201-1', course: 'INFS1201', ordinal: 1, outcome: 'Only skill', topics: [], prerequisites: ['INFS1101-4'], patterns: ['a'], assessableInCode: true }],
      exercises: [exerciseFixture('E-1')],
      lessons: [],
    })
    mocks.session.mockReturnValue({ learnerState: learnerState({ currentCourse: 'INFS1201', path: ['INFS1201-1'] }) })
    renderPage()
    await screen.findByText('Demo Course')
    expect(screen.queryByRole('link', { name: /^Only skill — locked/ })).toBeNull()
  })

  it('says so, with a way back, when the course code does not exist', () => {
    mocks.course.mockReturnValue(null)
    renderPage()
    expect(screen.getByText('This course could not be found')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to courses/ }).getAttribute('href')).toBe('/courses')
    expect(mocks.supabaseFrom).not.toHaveBeenCalled()
  })

  it('says so, honestly, for a coming-soon course instead of an empty map', () => {
    mocks.course.mockReturnValue(courseFixture({ status: 'coming-soon' }))
    renderPage()
    expect(screen.getByText('Demo Course is not open yet')).toBeTruthy()
  })

  it('shows a real loading shape, then recovers through retry once the bundle fails to load', async () => {
    let reject: (error: Error) => void = () => {}
    mocks.loadCourseBundle.mockReturnValue(new Promise((_resolve, r) => { reject = r }))
    renderPage()
    expect(screen.getByRole('status').textContent).toContain('Opening Demo Course')

    await act(async () => reject(new Error('offline')))
    await screen.findByRole('alert')

    mocks.loadCourseBundle.mockResolvedValue(bundleFixture())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Every skill in this course')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('falls back to ordinal order and a locally-picked stack when viewing a course other than the current one', async () => {
    mocks.session.mockReturnValue({ learnerState: learnerState({ currentCourse: 'OTHER', path: [], nextExerciseIds: [] }) })
    renderPage()
    await screen.findByText('Demo Course')
    const region = screen.getByRole('region', { name: 'Next up' })
    expect(region.querySelectorAll('a').length).toBeGreaterThan(0)
    expect(mocks.supabaseFrom).not.toHaveBeenCalled()
  })
})
