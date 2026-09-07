import type { PropsWithChildren } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider, useTheme } from 'next-themes'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { resetWellnessPrefsWriterForTests } from '@/app/(app)/account/prefsMutation'
import { THEME_SEED_MARKER_KEY } from './themes'
import { useThemeSync } from './useThemeSync'

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

function installMatchMedia() {
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

beforeEach(() => {
  installMatchMedia()
  vi.useFakeTimers()
  db.row = { prefs: {} }
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
  vi.resetAllMocks()
  resetWellnessPrefsWriterForTests()
})

const STORAGE_KEY = 'theme-sync-test'

function wrapper(userId: string, localTheme: string, initialPrefs: { theme?: unknown } | undefined) {
  const client = makeQueryClient()
  if (initialPrefs !== undefined) client.setQueryData(qk.wellness(userId), { prefs: initialPrefs })
  window.localStorage.setItem(STORAGE_KEY, localTheme)
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: { id: userId } as User, profile: null, learnerState: null }}>
          <ThemeProvider
            attribute="data-theme"
            themes={['midnight', 'amber', 'eclipse', 'paper', 'arcade']}
            defaultTheme={localTheme}
            enableSystem={false}
            storageKey={STORAGE_KEY}
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    )
  }
}

function useHarness(userId: string) {
  const themeApi = useTheme()
  useThemeSync(userId)
  return themeApi
}

describe('useThemeSync', () => {
  it('a stored theme that differs from the local one wins and is applied locally', async () => {
    const { result } = renderHook(() => useHarness('learner-one'), {
      wrapper: wrapper('learner-one', 'midnight', { theme: 'arcade' }),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.theme).toBe('arcade')
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('a stored theme identical to the local one changes nothing and writes nothing', async () => {
    renderHook(() => useHarness('learner-one'), {
      wrapper: wrapper('learner-one', 'amber', { theme: 'amber' }),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('a row with no stored theme keeps the local choice and writes it back', async () => {
    renderHook(() => useHarness('learner-one'), {
      wrapper: wrapper('learner-one', 'eclipse', {}),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.update).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ prefs: expect.objectContaining({ theme: 'eclipse' }) }),
      'user_id',
      'learner-one',
    )
  })

  // G2 (W2FIX-G fix round, wave 2 review section 6): before this fix, an
  // OS-seeded palette nobody had chosen was written to the server as though
  // it were a decision on the very first sign-in, then overrode a second
  // device's own seed the next time this hook ran there. `seedInitialTheme`
  // marks exactly what it wrote; a local theme that still equals that mark
  // must never round-trip.
  it('G2: a local theme that still equals its own unconfirmed OS seed writes nothing back, even with no stored theme at all', async () => {
    window.localStorage.setItem(THEME_SEED_MARKER_KEY, 'paper')
    renderHook(() => useHarness('learner-one'), {
      wrapper: wrapper('learner-one', 'paper', {}),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  // G2, other direction: once the marker is gone (a real pick clears it --
  // `ThemeQuickSwitch.tsx`, `account/page.tsx`), the exact same local value
  // is treated as a real choice and does round-trip. The un-marked 'eclipse'
  // case above already covers this; this one proves the marker itself, not
  // just its absence, is what gates the skip -- a stale mark left over from a
  // theme the learner has since moved away from must not suppress anything.
  it('G2: a local theme that differs from a stale seed marker (an unrelated device once seeded a different palette) still writes back', async () => {
    window.localStorage.setItem(THEME_SEED_MARKER_KEY, 'midnight')
    renderHook(() => useHarness('learner-one'), {
      wrapper: wrapper('learner-one', 'eclipse', {}),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.update).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ prefs: expect.objectContaining({ theme: 'eclipse' }) }),
      'user_id',
      'learner-one',
    )
  })

  // G3 (interim mitigation only -- the real gap needs `prefs.ts`, outside
  // this lane's owned paths; see the header comment above `useThemeSync`).
  // Before this, every learner sitting on the seeded default fired a full
  // select+update+settle-invalidate+refetch of `qk.wellness` on every cold
  // load, to store a patch `prefsPatch` would immediately strip back out.
  it('G3: a local theme equal to DEFAULT_WELLNESS.theme writes nothing back, even when nothing marks it as an unconfirmed seed', async () => {
    renderHook(() => useHarness('learner-one'), {
      wrapper: wrapper('learner-one', 'midnight', {}),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('an unresolved wellness row (still loading) does neither -- no premature write before the server has been heard from', () => {
    renderHook(() => useHarness('learner-one'), {
      wrapper: wrapper('learner-one', 'paper', undefined),
    })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('runs at most once per signed-in user: a second resolved row after the first reconcile does not re-fire', async () => {
    const client = makeQueryClient()
    client.setQueryData(qk.wellness('learner-one'), { prefs: { theme: 'arcade' } })
    window.localStorage.setItem(STORAGE_KEY, 'midnight')
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={client}>
          <SessionProvider initialState={{ user: { id: 'learner-one' } as User, profile: null, learnerState: null }}>
            <ThemeProvider attribute="data-theme" themes={['midnight', 'amber', 'eclipse', 'paper', 'arcade']}
              defaultTheme="midnight" enableSystem={false} storageKey={STORAGE_KEY} disableTransitionOnChange>
              {children}
            </ThemeProvider>
          </SessionProvider>
        </QueryClientProvider>
      )
    }
    const { result } = renderHook(() => useHarness('learner-one'), { wrapper: Wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.theme).toBe('arcade')

    // A later, different server row (e.g. another device's write landing) --
    // this hook only reconciles once at sign-in, so the learner's own
    // in-session pick (not simulated here) is never fought by a stale refetch.
    act(() => { client.setQueryData(qk.wellness('learner-one'), { prefs: { theme: 'amber' } }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.theme).toBe('arcade')
  })
})
