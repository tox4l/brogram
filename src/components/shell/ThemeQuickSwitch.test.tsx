import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { resetWellnessPrefsWriterForTests } from '@/app/(app)/account/prefsMutation'
import { THEME_SEED_MARKER_KEY } from '@/lib/theme/themes'
import { ThemeQuickSwitch } from './ThemeQuickSwitch'

const STORAGE_KEY = 'brogram:theme'
const USER_ID = 'learner-one'

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

// next-themes registers a `matchMedia` listener unconditionally on mount
// (even with `enableSystem={false}`), and `useReducedMotion` reads it too.
// jsdom has no `matchMedia` at all, so every test needs a stand-in; tests
// that care about reduced motion swap in a query-aware version.
function installMatchMedia(reducedMotion = false) {
  window.matchMedia = ((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** X5/V4 (wave 2 review): the quick-switch now reads `useWellness()` (for
 *  the resolved motion preference) and writes through `useWellnessPrefsMutation`
 *  (for the theme choice) -- both need a QueryClient and a signed-in session
 *  in context, matching how `SoundToggle.test.tsx` and `DockControl.test.tsx`
 *  already wrap the sibling controls that share those same two hooks. */
function renderSwitch(initialPrefs: Record<string, unknown> = {}) {
  const client = makeQueryClient()
  db.row = { prefs: initialPrefs }
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: { id: USER_ID } as User, profile: null, learnerState: null }}>
          <ThemeProvider
            attribute="data-theme"
            themes={['midnight', 'amber', 'eclipse', 'paper', 'arcade']}
            defaultTheme="midnight"
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
  return { client, ...render(<ThemeQuickSwitch />, { wrapper: Wrapper }) }
}

beforeEach(() => {
  installMatchMedia()
  vi.useFakeTimers()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  resetWellnessPrefsWriterForTests()
})

describe('ThemeQuickSwitch', () => {
  it('opens on the trigger and exposes a radiogroup of all five themes', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    const group = screen.getByRole('radiogroup', { name: /theme/i })
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
    expect(screen.getByRole('radio', { name: 'Midnight' }).getAttribute('aria-checked')).toBe('true')
  })

  // T4.5 (wave 4 plan, "Tests it adds"): a bounding-box proxy for the 44px
  // header control -- see SoundToggle.test.tsx's identical note.
  it('carries the 44px header-control size class', () => {
    renderSwitch()
    expect(screen.getByRole('button', { name: /choose theme/i }).className).toMatch(/\bsize-11\b/)
  })

  it('keyboard-only traversal cycles through all five and selects each one', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))

    let activeRadio = screen.getByRole('radio', { name: 'Midnight' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')

    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Amber' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber')

    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Eclipse' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('eclipse')

    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Folio' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper')

    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Arcade' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')

    // Wraps back around to Midnight.
    fireEvent.keyDown(activeRadio, { key: 'ArrowRight' })
    activeRadio = screen.getByRole('radio', { name: 'Midnight' })
    expect(activeRadio.getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
  })

  it('ArrowLeft moves to the previous theme', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Midnight' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Arcade' }).getAttribute('aria-checked')).toBe('true')
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')
  })

  it('choosing a theme writes data-theme on <html> and persists it to storage', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Folio' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('paper')
  })

  it('the choice survives a remount', () => {
    const first = renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber')
    first.unmount()

    renderSwitch()
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber')
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    expect(screen.getByRole('radio', { name: 'Amber' }).getAttribute('aria-checked')).toBe('true')
  })

  it('does not call document.startViewTransition under reduced motion', () => {
    installMatchMedia(true)
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return {} as ViewTransition
    })
    document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition

    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Arcade' }))

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')
  })

  it('calls document.startViewTransition when motion is not reduced', () => {
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return {} as ViewTransition
    })
    document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition

    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Arcade' }))

    expect(startViewTransition).toHaveBeenCalledTimes(1)
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')
  })

  it('I4: the attribute is already applied *inside* the startViewTransition callback (flushSync), not only after it returns', () => {
    // next-themes applies `data-theme` in a passive effect, which without
    // `flushSync` would not have run yet at the instant this mock's
    // callback() returns -- only later, once outer `act()` flushes it. This
    // records the attribute synchronously right there, before anything else
    // can flush, which is exactly the window a real browser uses to
    // snapshot the "new" frame for the transition. A bare
    // `document.startViewTransition(() => setTheme(id))` (no `flushSync`)
    // would observe the OLD theme here; this is the regression I4 fixes.
    let attributeWhenCallbackReturns: string | null | undefined
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      attributeWhenCallbackReturns = document.documentElement.getAttribute('data-theme')
      return {} as ViewTransition
    })
    document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition

    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
    fireEvent.click(screen.getByRole('radio', { name: 'Arcade' }))

    expect(attributeWhenCallbackReturns).toBe('arcade')
  })

  // V4/A11Y-03 (wave 2 review): a bare `useReducedMotion()` used to ignore
  // an in-app motion preference on an OS that reports no preference either
  // way -- exactly the case the review's fix names.
  it("V4: reads the learner's own motion preference, not only the OS media query -- Reduced in prefs wins even when the OS asks for full motion", async () => {
    installMatchMedia(false) // OS: no preference (full motion)
    const startViewTransition = vi.fn((callback: () => void) => {
      callback()
      return {} as ViewTransition
    })
    document.startViewTransition = startViewTransition as unknown as typeof document.startViewTransition

    renderSwitch({ motion: 'reduced' })
    // Let the wellness fetch resolve so `motionPref` reflects the seeded
    // row (`reduced`), not the pre-fetch default (`system`).
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Arcade' }))

    expect(startViewTransition).not.toHaveBeenCalled()
    expect(document.documentElement.getAttribute('data-theme')).toBe('arcade')
  })

  // X5 (wave 2 review): the theme picked here follows the learner across
  // devices via `wellness.prefs.theme`, the same single writer every other
  // prefs control uses.
  it('X5: writes the chosen theme through to wellness.prefs, debounced like every other prefs control', async () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Eclipse' }))

    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(mocks.update).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ prefs: expect.objectContaining({ theme: 'eclipse' }) }),
      'user_id',
      USER_ID,
    )
  })

  // T4.5 fix round (review finding M5): five tiles in a plain two-column
  // grid render as 2+2+1 with a visibly empty cell, on the spec's own
  // "most important control in the wave." The last tile now spans both
  // columns so the final row is a deliberate full-width fifth choice.
  it('M5: the fifth swatch spans both columns so the last row has no empty cell', () => {
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    expect(screen.getByRole('radio', { name: 'Arcade' }).className).toMatch(/\blast:col-span-2\b/)
  })

  // G2 (W2FIX-G fix round, wave 2 review section 6): a real pick from here
  // is no longer an unconfirmed device seed -- the marker `seedInitialTheme`
  // wrote must be cleared, or `useThemeSync`'s write-back skip would go on
  // suppressing this exact choice on some other device's next reconcile.
  it('G2: clears the OS-seed marker on a real pick', () => {
    window.localStorage.setItem(THEME_SEED_MARKER_KEY, 'midnight')
    renderSwitch()
    fireEvent.click(screen.getByRole('button', { name: /choose theme/i }))
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }))
    expect(window.localStorage.getItem(THEME_SEED_MARKER_KEY)).toBeNull()
  })
})

interface ViewTransition {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition: () => void
}
