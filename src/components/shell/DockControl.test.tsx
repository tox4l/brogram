import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { setReminderPending, resetReminderBadgeForTests } from '@/lib/wellness/reminderBadge'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
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
})
