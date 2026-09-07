import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { setReminderPending, resetReminderBadgeForTests } from '@/lib/wellness/reminderBadge'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { resetWellnessPrefsWriterForTests, useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'
import { DockControl } from './DockControl'

// Stateful, like SoundToggle.test.tsx: this component's write invalidates its
// TanStack Query key on settle, which triggers a real refetch through this
// same mock.
const db = vi.hoisted(() => ({ row: null as { prefs?: unknown } | null }))
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { mocks.select(table); return { data: db.row, error: null } },
        }),
      }),
      update: (patch: { prefs?: unknown }) => ({
        eq: (column: string, value: string) => ({
          select: () => ({
            maybeSingle: async () => {
              mocks.update(table, patch, column, value)
              if (!db.row) return { data: null, error: null }
              db.row = { ...db.row, ...patch }
              return { data: { user_id: value }, error: null }
            },
          }),
        }),
      }),
      insert: async (payload: { user_id: string; prefs: unknown }) => {
        mocks.insert(table, payload)
        db.row = { prefs: payload.prefs }
        return { data: null, error: null }
      },
    }),
  }),
}))

beforeEach(() => {
  db.row = { prefs: { dock: { placement: 'hidden', collapsed: false, compactOnExercise: true, corner: 'br' } } }
  try { sessionStorage.clear() } catch { /* jsdom always has sessionStorage */ }
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetReminderBadgeForTests()
  // Fix round 2, F1: this component now shares `prefsMutation.ts`'s
  // module-level (per-user, not per-hook-instance) writer with every other
  // prefs control -- without this, a click's still-pending 400ms debounce
  // timer (several tests below click and return before it fires) would leak
  // into a later, unrelated test that reuses `'learner-one'`.
  resetWellnessPrefsWriterForTests()
})

function wrapper(userId: string | null) {
  const client = makeQueryClient()
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: userId ? ({ id: userId } as User) : null, profile: null, learnerState: null }}>
          {children}
        </SessionProvider>
      </QueryClientProvider>
    )
  }
}

describe('DockControl', () => {
  it('renders nothing while the dock has a real placement -- hidden is not the default state', async () => {
    db.row = { prefs: { dock: { placement: 'right', collapsed: false, compactOnExercise: true, corner: 'br' } } }
    render(<DockControl />, { wrapper: wrapper('learner-one') })
    await waitFor(() => expect(mocks.select).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /show wellness dock/i })).toBeNull()
  })

  it('is the only way back once placement is "hidden" -- never a dead end', async () => {
    render(<DockControl />, { wrapper: wrapper('learner-one') })
    expect(await screen.findByRole('button', { name: /show wellness dock/i })).toBeTruthy()
  })

  it('restores the previously remembered placement, not a hardcoded default, on click', async () => {
    sessionStorage.setItem('brogram:dock:last-placement', 'left')
    render(<DockControl />, { wrapper: wrapper('learner-one') })
    const button = await screen.findByRole('button', { name: /show wellness dock/i })
    fireEvent.click(button)
    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(
        'wellness',
        expect.objectContaining({ prefs: expect.objectContaining({ dock: expect.objectContaining({ placement: 'left' }) }) }),
        'user_id',
        'learner-one',
      )
    })
  })

  it('falls back to "right" when nothing was ever remembered this session', async () => {
    render(<DockControl />, { wrapper: wrapper('learner-one') })
    const button = await screen.findByRole('button', { name: /show wellness dock/i })
    fireEvent.click(button)
    // Every other dock field in the seeded row already matches
    // `DEFAULT_WELLNESS.dock`, so restoring to 'right' (also the default)
    // makes the whole `dock` sub-object equal the default -- `prefsPatch`
    // correctly omits it rather than writing a redundant key back.
    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(
        'wellness',
        expect.objectContaining({ prefs: expect.not.objectContaining({ dock: expect.objectContaining({ placement: 'hidden' }) }) }),
        'user_id',
        'learner-one',
      )
    })
    expect(resolveWellnessPrefs(db.row?.prefs).dock.placement).toBe('right')
  })

  it('C3: shows a badge when a reminder is pending while the dock is hidden, and clears it on click', async () => {
    render(<DockControl />, { wrapper: wrapper('learner-one') })
    await screen.findByRole('button', { name: /show wellness dock/i })
    expect(screen.queryByTestId('dock-badge')).toBeNull()

    setReminderPending('prayer', true)
    await waitFor(() => expect(screen.getByTestId('dock-badge')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /show wellness dock/i }))
    await waitFor(() => expect(screen.queryByTestId('dock-badge')).toBeNull())
  })

  /**
   * F1 (fix round 2): before this round, `DockControl` kept its own
   * independent writer on `wellness.prefs`, entirely blind to the shared
   * queue's debounce/pending state (`useWellnessPrefsMutation`,
   * `account/prefsMutation.ts`) every other control -- the Account page's
   * daily-goal stepper among them -- routes through. Two consequences, both
   * real: a goal change queued moments before the learner reopened the dock
   * could be silently lost server-side (this control's own one-shot write
   * would land first, then the goal write's *own* flush would read a row
   * that had already moved -- or vice versa, depending on which settled
   * last), and neither writer's `hasPendingPrefsWrite` guard could see the
   * other's in-flight state at all.
   *
   * Reproduces this with a second, real caller of `useWellnessPrefsMutation`
   * standing in for that other control (exactly the shape
   * `useDockPrefs.test.tsx`'s `C1` case already proves at the hook level,
   * here proven through the actual `DockControl` component): queue a
   * daily-goal change, then click the dock's re-open glyph well inside the
   * same 400ms debounce window, and confirm the single resulting network
   * write carries *both* changes -- proof the two controls now share one
   * queue instead of racing two.
   */
  it('F1: reopening the dock while a daily-goal write from another control is still debouncing does not clobber either change', async () => {
    db.row = {
      prefs: {
        dailyGoal: 3,
        dock: { placement: 'hidden', collapsed: false, compactOnExercise: true, corner: 'br' },
      },
    }
    const client = makeQueryClient()
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={client}>
          <SessionProvider initialState={{ user: { id: 'learner-one' } as User, profile: null, learnerState: null }}>
            {children}
          </SessionProvider>
        </QueryClientProvider>
      )
    }

    // Real timers while `useWellness()` resolves and the component finds its
    // first paint -- same as every other case in this file.
    render(<DockControl />, { wrapper: Wrapper })
    const button = await screen.findByRole('button', { name: /show wellness dock/i })

    // Stands in for the Account page's own daily-goal control, sharing
    // `DockControl`'s user id -- both go through the same module-level
    // writer keyed by user id, whichever component instance calls it.
    const { result: otherControl } = renderHook(() => useWellnessPrefsMutation('learner-one'), { wrapper: Wrapper })

    // Fake timers only from here: the query has already settled, so nothing
    // left needs real time -- only the shared 400ms debounce, which this
    // needs to control precisely.
    vi.useFakeTimers()
    try {
      act(() => { otherControl.current.mutate((current) => ({ dailyGoal: (current.dailyGoal ?? 3) + 1 })) })

      // Well inside the 400ms debounce, the learner reopens the dock.
      await act(async () => { await vi.advanceTimersByTimeAsync(200) })
      fireEvent.click(button)

      await act(async () => { await vi.advanceTimersByTimeAsync(400) })

      expect(mocks.update).toHaveBeenCalledTimes(1)
      const written = mocks.update.mock.calls[0][1] as { prefs: { dailyGoal?: number; dock?: { placement?: string } } }
      expect(written.prefs.dailyGoal).toBe(4)
      // `dock` restored to 'right' with every other field already default
      // makes the whole sub-object equal the default -- `prefsPatch` omits
      // it from the written delta (same as the "falls back to right" case
      // above), which `resolveWellnessPrefs` fills back in from defaults on
      // read. What matters here is that it is 'right', not 'hidden': the
      // dock write was not lost underneath the goal write in the same patch.
      expect(resolveWellnessPrefs(written.prefs).dock.placement).toBe('right')
      const persisted = resolveWellnessPrefs(db.row?.prefs)
      expect(persisted.dailyGoal).toBe(4)
      expect(persisted.dock.placement).toBe('right')
    } finally {
      vi.useRealTimers()
    }
  })
})
