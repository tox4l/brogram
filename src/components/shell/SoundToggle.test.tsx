import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { resetWellnessPrefsWriterForTests } from '@/app/(app)/account/prefsMutation'
import { SoundToggle } from './SoundToggle'

// A stateful fake `wellness` table (rather than a fixed mockResolvedValue) is
// necessary here, unlike the plain-Supabase mocks elsewhere in this repo:
// this component's write path invalidates its TanStack Query key on settle
// (src/lib/query/optimistic.ts), which triggers a real refetch through this
// same mock. A static "always return the original row" mock would make that
// refetch clobber the just-applied optimistic value with stale data — an
// artifact of the mock, not of production, where the refetch would correctly
// return the row the write just produced.
const db = vi.hoisted(() => ({ row: null as { prefs: unknown } | null }))
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  setEnabled: vi.fn(),
  hydrate: vi.fn(),
}))

vi.mock('@/lib/sound/manager', () => ({ setEnabled: mocks.setEnabled, hydrateSoundFromPrefs: mocks.hydrate }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            mocks.select(table)
            return { data: db.row, error: null }
          },
        }),
      }),
      update: (patch: { prefs: unknown }) => ({
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
  db.row = { prefs: {} }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // X3 fix: this now shares the module-level writer in `prefsMutation.ts`
  // (keyed only by user id) with every other `wellness.prefs` writer -- an
  // unflushed debounce timer left pending by one test would otherwise fire
  // mid a later, unrelated test that reuses the same 'learner-one' id.
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

describe('SoundToggle', () => {
  it('defaults to on before any signed-in prefs load', () => {
    render(<SoundToggle />, { wrapper: wrapper(null) })
    const button = screen.getByRole('button', { name: /mute sound/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('hydrates the sound manager from resolved prefs on load (I8)', async () => {
    db.row = { prefs: { sound: { enabled: false, volume: 0.4, interface: true } } }
    render(<SoundToggle />, { wrapper: wrapper('learner-one') })
    await screen.findByRole('button', { name: /unmute sound/i })

    expect(mocks.hydrate).toHaveBeenCalledWith(expect.objectContaining({ sound: { enabled: false, volume: 0.4, interface: true } }))
  })

  it('clicking flips aria-pressed/label and syncs the sound manager immediately', async () => {
    render(<SoundToggle />, { wrapper: wrapper('learner-one') })
    const button = await screen.findByRole('button', { name: /mute sound/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(button)

    // Immediate: does not wait on the optimistic-cache round trip.
    expect(mocks.setEnabled).toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.getByRole('button', { name: /unmute sound/i }).getAttribute('aria-pressed')).toBe('false'))
  })

  it('persists only prefsPatch (I9) to wellness.prefs via update, not upsert, and not the full resolved object', async () => {
    db.row = { prefs: { theme: 'amber' } }
    render(<SoundToggle />, { wrapper: wrapper('learner-one') })
    const button = await screen.findByRole('button', { name: /mute sound/i })
    fireEvent.click(button)

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(
        'wellness',
        expect.objectContaining({ prefs: { theme: 'amber', sound: { enabled: false, volume: 0.6, interface: false } } }),
        'user_id',
        'learner-one',
      )
    })
    // A patch, not a full WellnessPrefs — dock/prayerReminders/etc never appear
    // because they still equal their defaults (prefsPatch, src/lib/wellness/prefs.ts).
    const written = mocks.update.mock.calls.at(-1)?.[1] as { prefs: Record<string, unknown> }
    expect(written.prefs).not.toHaveProperty('dock')
    expect(written.prefs).not.toHaveProperty('prayerReminders')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('falls back to insert when the update reports no row', async () => {
    db.row = null
    render(<SoundToggle />, { wrapper: wrapper('learner-one') })
    const button = await screen.findByRole('button', { name: /mute sound/i })
    fireEvent.click(button)

    await waitFor(() => expect(mocks.insert).toHaveBeenCalled())
    expect(mocks.insert).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ user_id: 'learner-one', prefs: expect.objectContaining({ sound: expect.objectContaining({ enabled: false }) }) }),
    )
  })

  it('never throws when the wellness fetch fails, and still toggles locally', async () => {
    mocks.select.mockImplementationOnce(() => { throw new Error('offline') })
    render(<SoundToggle />, { wrapper: wrapper('learner-one') })
    const button = await screen.findByRole('button', { name: /mute sound/i })
    expect(() => fireEvent.click(button)).not.toThrow()
    // The manager gate still flips immediately even though persistence failed.
    expect(mocks.setEnabled).toHaveBeenCalledWith(false)
  })

  it('does not persist when signed out, but still toggles the local/manager state', () => {
    render(<SoundToggle />, { wrapper: wrapper(null) })
    const button = screen.getByRole('button', { name: /mute sound/i })
    fireEvent.click(button)

    expect(mocks.setEnabled).toHaveBeenCalledWith(false)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
