import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import type { LearnerState } from '@/lib/contracts'
import { THEME_SEED_MARKER_KEY } from '@/lib/theme/themes'
import { resetWellnessPrefsWriterForTests } from './prefsMutation'
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
  useTheme: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('next-themes', () => ({ useTheme: () => mocks.useTheme() }))
vi.mock('@/components/account/IntegrityPanel', () => ({
  IntegrityPanel: ({ crossedAt }: { crossedAt?: number | null }) => (
    <div data-testid="integrity-panel" data-crossed-at={String(crossedAt)}>Integrity panel</div>
  ),
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
  mocks.useTheme.mockReturnValue({ theme: 'midnight', setTheme: mocks.setTheme })
  // jsdom's real `location.href` setter attempts an actual navigation (and
  // throws, "not implemented") -- the sign-out test replaces the whole
  // object with a plain, writable stand-in it can read back afterwards.
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetWellnessPrefsWriterForTests()
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

  it('mounts the Integrity panel once, with no threshold named (I1, fix round 1)', () => {
    render(<AccountPage />, { wrapper: wrapper().Wrapper })
    const panels = screen.getAllByTestId('integrity-panel')
    // Exactly one mount, not wrapped in a second heading/id of its own --
    // IntegrityPanel supplies its own <h2 id="integrity-heading">, so a
    // `Section` wrapper around it would duplicate both the text and the id.
    expect(panels).toHaveLength(1)
    expect(panels[0].getAttribute('data-crossed-at')).toBe('null')
    expect(screen.queryByText('Integrity explained')).toBeNull()
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

    // T4.5 fix round (review finding M5): five tiles in a `sm:grid-cols-4`
    // grid render as 4+1, an orphan tile on the spec's own "most important
    // control in the wave." The 34rem/544px column comfortably holds five.
    it('M5: the theme grid renders five swatches on one row from sm up (sm:grid-cols-5)', () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      const group = screen.getByRole('radiogroup', { name: 'Theme' })
      expect(group.className).toMatch(/\bsm:grid-cols-5\b/)
    })

    // X5 (wave 2 review): the picker used to only ever call `setTheme` --
    // the choice never left this device. It now writes through the same
    // single `wellness.prefs` writer every other control on this page uses.
    it('X5: writes the chosen theme through to wellness.prefs', async () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))
      await waitFor(() => expect(mocks.wellnessUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ prefs: expect.objectContaining({ theme: 'amber' }) }),
      ))
    })

    // G2 (W2FIX-G fix round, wave 2 review section 6): a real pick from here
    // is no longer an unconfirmed device seed -- the marker `seedInitialTheme`
    // wrote must be cleared, or `useThemeSync`'s write-back skip would go on
    // suppressing this exact choice on some other device's next reconcile.
    it('G2: clears the OS-seed marker on a real pick', () => {
      window.localStorage.setItem(THEME_SEED_MARKER_KEY, 'midnight')
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))
      expect(window.localStorage.getItem(THEME_SEED_MARKER_KEY)).toBeNull()
    })

    // I2, fix round 1: `next-themes` reports `theme: undefined` on the
    // server render and the first client render, before it hydrates from
    // storage/the DOM attribute. The old code fell back to 'midnight' in
    // that window, ringing the Midnight swatch no matter what was actually
    // applied, and made Midnight itself unclickable (its own "already
    // active" early-return fired on the false match).
    it('rings no swatch while the resolved theme is unknown, and every swatch -- Midnight included -- stays clickable', () => {
      mocks.useTheme.mockReturnValue({ theme: undefined, setTheme: mocks.setTheme })
      render(<AccountPage />, { wrapper: wrapper().Wrapper })

      for (const name of ['Midnight', 'Amber', 'Eclipse', 'Folio', 'Arcade']) {
        expect(screen.getByRole('radio', { name }).getAttribute('aria-checked')).toBe('false')
      }

      fireEvent.click(screen.getByRole('radio', { name: 'Midnight' }))
      expect(mocks.setTheme).toHaveBeenCalledWith('midnight')
    })

    it('rings the swatch that matches the actually-applied theme once resolved', () => {
      mocks.useTheme.mockReturnValue({ theme: 'arcade', setTheme: mocks.setTheme })
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      expect(screen.getByRole('radio', { name: 'Arcade' }).getAttribute('aria-checked')).toBe('true')
      expect(screen.getByRole('radio', { name: 'Midnight' }).getAttribute('aria-checked')).toBe('false')
    })

    // I3, fix round 1: every radiogroup needs a roving-tabindex + arrow-key
    // model (WAI-ARIA's radiogroup pattern), not a plain button per option.
    it('moves focus and selection with ArrowRight across the theme grid, wrapping at the end', () => {
      mocks.useTheme.mockReturnValue({ theme: 'arcade', setTheme: mocks.setTheme })
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      const arcade = screen.getByRole('radio', { name: 'Arcade' })
      expect(arcade.getAttribute('tabindex')).toBe('0')
      expect(screen.getByRole('radio', { name: 'Midnight' }).getAttribute('tabindex')).toBe('-1')

      arcade.focus()
      fireEvent.keyDown(arcade, { key: 'ArrowRight' })
      // Arcade is the last theme -- wraps back to the first, Midnight.
      expect(mocks.setTheme).toHaveBeenCalledWith('midnight')
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Midnight' }))
    })

    // T4.5 (wave 4 plan, "Tests it adds"): a keyboard traversal test of the
    // five-swatch radiogroup -- the ArrowRight-wrap test above already
    // covers arrow-key roving across all five (Midnight..Arcade come from
    // the same THEMES registry); this closes the Home/End half of the
    // WAI-ARIA radiogroup pattern specifically on the theme grid.
    it('jumps to the first and last theme swatch with Home and End', () => {
      mocks.useTheme.mockReturnValue({ theme: 'eclipse', setTheme: mocks.setTheme })
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      const eclipse = screen.getByRole('radio', { name: 'Eclipse' })
      eclipse.focus()

      fireEvent.keyDown(eclipse, { key: 'End' })
      expect(mocks.setTheme).toHaveBeenCalledWith('arcade')
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Arcade' }))

      fireEvent.keyDown(screen.getByRole('radio', { name: 'Arcade' }), { key: 'Home' })
      expect(mocks.setTheme).toHaveBeenCalledWith('midnight')
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Midnight' }))
    })

    it('moves a RadioPills group with ArrowRight/ArrowLeft and jumps with Home/End', async () => {
      render(<AccountPage />, { wrapper: wrapper().Wrapper })
      const supportive = await screen.findByRole('radio', { name: 'Supportive' })
      supportive.focus()

      fireEvent.keyDown(supportive, { key: 'ArrowRight' })
      await waitFor(() => expect(mocks.learnerStateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ state: expect.objectContaining({ profile: expect.objectContaining({ tone: 'tough-love' }) }) }),
      ))
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tough love' }))

      fireEvent.keyDown(screen.getByRole('radio', { name: 'Tough love' }), { key: 'Home' })
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Playful' }))
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
