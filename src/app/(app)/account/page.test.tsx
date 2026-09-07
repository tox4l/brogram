import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import type { LearnerState } from '@/lib/contracts'
import AccountPage from './page'

function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'learner-1',
    profile: {
      displayName: 'Ada', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: 'grades', beyondCourses: false, depth: 'pass', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'INFS1101', path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const db = vi.hoisted(() => ({
  wellness: { prefs: {} } as { prefs: unknown },
  learnerState: { state: null as LearnerState | null, version: 1 },
}))
const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signOut: vi.fn(),
  wellnessSelect: vi.fn(),
  wellnessUpdate: vi.fn(),
  wellnessInsert: vi.fn(),
  learnerStateUpdate: vi.fn(),
  setTheme: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'midnight', setTheme: mocks.setTheme }) }))
vi.mock('@/components/account/IntegrityPanel', () => ({
  IntegrityPanel: () => <div data-testid="integrity-panel">Integrity panel</div>,
}))
vi.mock('@/store/session', () => ({
  useSession: (selector?: (session: { user: { id: string; email: string } }) => unknown) => {
    const session = { user: { id: 'learner-1', email: 'learner@example.test' } }
    return selector ? selector(session) : session
  },
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
    from: (table: string) => {
      if (table === 'wellness') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => { mocks.wellnessSelect(); return { data: db.wellness, error: null } },
            }),
          }),
          update: (patch: { prefs: unknown }) => ({
            eq: (_column: string, value: string) => ({
              select: () => ({
                maybeSingle: async () => {
                  mocks.wellnessUpdate(patch)
                  db.wellness = { ...db.wellness, ...patch }
                  return { data: { user_id: value }, error: null }
                },
              }),
            }),
          }),
          insert: async (payload: { prefs: unknown }) => {
            mocks.wellnessInsert(payload)
            db.wellness = { prefs: payload.prefs }
            return { data: null, error: null }
          },
        }
      }
      if (table === 'learner_state') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: db.learnerState, error: null }),
            }),
          }),
          update: (payload: { state: LearnerState; version: number }) => ({
            eq: () => ({
              eq: (_column: string, expectedVersion: number) => ({
                select: () => ({
                  maybeSingle: async () => {
                    mocks.learnerStateUpdate(payload)
                    if (db.learnerState.version !== expectedVersion) return { data: null, error: null }
                    db.learnerState = { state: payload.state, version: payload.version }
                    return { data: { version: payload.version }, error: null }
                  },
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in this test: ${table}`)
    },
  }),
}))

beforeEach(() => {
  db.wellness = { prefs: {} }
  db.learnerState = { state: learnerState(), version: 1 }
  mocks.updateUser.mockResolvedValue({ data: {}, error: null })
  mocks.signOut.mockResolvedValue({ error: null })
  // jsdom's real `location.href` setter attempts an actual navigation (and
  // throws, "not implemented") -- the sign-out test replaces the whole
  // object with a plain, writable stand-in it can read back afterwards.
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function wrapper() {
  const client = makeQueryClient()
  // Seed the cache the same way `QuerySeed` does in production (both keys
  // are `staleTime: Infinity`, so a seeded value is never refetched) --
  // without this, `useWellness()`/`useLearnerState()`'s own initial fetch
  // can resolve *after* a test's synchronous optimistic write and clobber it
  // back to the mock's server-side default, an artifact of the test's timing
  // rather than of production, where the layout always seeds first.
  client.setQueryData(qk.wellness('learner-1'), db.wellness)
  client.setQueryData(qk.learnerState('learner-1'), learnerState())
  return { Wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>, client }
}

async function fillAndSubmit(password: string, confirmPassword: string) {
  render(<AccountPage />, { wrapper: wrapper().Wrapper })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmPassword } })
  fireEvent.click(screen.getByRole('button', { name: /change password/i }))
}

describe('Account page', () => {
  it('shows the signed-in email', () => {
    render(<AccountPage />, { wrapper: wrapper().Wrapper })
    expect(screen.getByText('learner@example.test')).toBeTruthy()
  })

  it('shows a mismatch message and never calls updateUser when the passwords differ', async () => {
    await fillAndSubmit('longenough1', 'longenough2')
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/i)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('shows a length message and never calls updateUser when the password is too short', async () => {
    await fillAndSubmit('short1', 'short1')
    expect(screen.getByRole('alert').textContent).toMatch(/at least 8 characters/i)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('calls updateUser once and shows the confirmation on success', async () => {
    await fillAndSubmit('longenough1', 'longenough1')
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/password changed/i))
    expect(mocks.updateUser).toHaveBeenCalledTimes(1)
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'longenough1' })
  })

  it('shows the Supabase error on failure and does not show the success message', async () => {
    mocks.updateUser.mockResolvedValue({ data: null, error: { message: 'Session expired' } })
    await fillAndSubmit('longenough1', 'longenough1')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Session expired'))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('signs out and hard-navigates to /login', async () => {
    render(<AccountPage />, { wrapper: wrapper().Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
    expect(window.location.href).toBe('/login')
  })

  it('mounts the Integrity panel', () => {
    render(<AccountPage />, { wrapper: wrapper().Wrapper })
    expect(screen.getByTestId('integrity-panel')).toBeTruthy()
  })

  it('shows the no-signals diagnostics message before anything is recorded', () => {
    render(<AccountPage />, { wrapper: wrapper().Wrapper })
    expect(screen.getByText('No signals recorded yet this session.')).toBeTruthy()
  })

  describe('Make it yours', () => {
    it('applies a theme immediately on click', () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))
      expect(mocks.setTheme).toHaveBeenCalledWith('amber')
    })

    it('a sound toggle updates the UI before the mutation resolves, and never reverts when it rejects', async () => {
      mocks.wellnessSelect.mockImplementationOnce(() => { throw new Error('offline') })
      render(<AccountPage />, { wrapper: wrapper().Wrapper })

      // Sound defaults on (DEFAULT_WELLNESS.sound.enabled) -- clicking mutes it.
      const toggle = screen.getByRole('switch', { name: 'Sound on' })
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      fireEvent.click(toggle)

      // Immediate: the cache is applied synchronously, well before the
      // network call settles -- `mutate()` never awaits it.
      expect(mocks.wellnessUpdate).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Sound on' }).getAttribute('aria-checked')).toBe('false'))

      await waitFor(() => expect(mocks.wellnessSelect).toHaveBeenCalled())
      // The write-through failed, and the toggle still reads off -- no revert.
      expect(screen.getByRole('switch', { name: 'Sound on' }).getAttribute('aria-checked')).toBe('false')
    })

    it('debounces the sound write-through into one call after repeated interaction', async () => {
      vi.useFakeTimers()
      try {
        render(<AccountPage />, { wrapper: wrapper().Wrapper })
        const toggle = screen.getByRole('switch', { name: 'Sound on' })
        fireEvent.click(toggle)
        fireEvent.click(toggle)
        expect(mocks.wellnessUpdate).not.toHaveBeenCalled()
        await act(async () => { await vi.advanceTimersByTimeAsync(400) })
        expect(mocks.wellnessUpdate).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('changes the dock placement', async () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      fireEvent.click(screen.getByRole('radio', { name: 'Left' }))
      await waitFor(() => expect(mocks.wellnessUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ prefs: expect.objectContaining({ dock: expect.objectContaining({ placement: 'left' }) }) }),
      ))
    })

    it('steps the daily goal up and down within 1 to 10', async () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      expect(screen.getByTestId('daily-goal-value').textContent).toBe('3')
      fireEvent.click(screen.getByRole('button', { name: 'Increase daily goal' }))
      await waitFor(() => expect(screen.getByTestId('daily-goal-value').textContent).toBe('4'))
      fireEvent.click(screen.getByRole('button', { name: 'Decrease daily goal' }))
      fireEvent.click(screen.getByRole('button', { name: 'Decrease daily goal' }))
      await waitFor(() => expect(screen.getByTestId('daily-goal-value').textContent).toBe('2'))
    })
  })

  describe('How the Bro talks', () => {
    it('changes tone via the learner_state profile, version-guarded', async () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      await screen.findByRole('radio', { name: 'Direct' })
      fireEvent.click(screen.getByRole('radio', { name: 'Direct' }))
      await waitFor(() => expect(mocks.learnerStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ state: expect.objectContaining({ profile: expect.objectContaining({ tone: 'direct' }) }), version: 2 }),
      ))
    })

    it('toggles beyond-courses', async () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      const toggle = await screen.findByRole('switch', { name: 'Go beyond the course curriculum when it helps' })
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      fireEvent.click(toggle)
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Go beyond the course curriculum when it helps' }).getAttribute('aria-checked')).toBe('true'))
    })
  })
})
