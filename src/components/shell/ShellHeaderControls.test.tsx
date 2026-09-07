import type { PropsWithChildren } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { resetWellnessPrefsWriterForTests } from '@/app/(app)/account/prefsMutation'
import { THEME_STORAGE_KEY, THEMES } from '@/lib/theme/themes'
import { ShellHeaderControls } from './ShellHeaderControls'

/**
 * G8 (W2FIX-G fix round, wave 2 review): `useThemeSync(userId)` (X5's read
 * half) is called from exactly one production mount point -- here, line 27
 * -- and nothing in the tree exercised it through this component before this
 * file existed. `useThemeSync.test.tsx` proves the hook itself works through
 * a bespoke harness; it cannot catch someone deleting the one-line call
 * below as dead-looking code (no JSX, easy to mistake for unused). `tsc`,
 * `eslint` and every other test stay green if that happens -- this file is
 * the one that does not.
 *
 * The four sibling controls are stubbed: what is under test is that
 * `ShellHeaderControls` still wires the reconcile hook up, not any of their
 * own behaviour (each already has its own test file).
 */
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('./DockControl', () => ({ DockControl: () => null }))
vi.mock('./SoundToggle', () => ({ SoundToggle: () => null }))
vi.mock('./ThemeQuickSwitch', () => ({ ThemeQuickSwitch: () => null }))
vi.mock('./BuddyButton', () => ({ BuddyButton: () => null }))

const db = vi.hoisted(() => ({ row: null as { prefs?: unknown } | null }))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: db.row, error: null }),
        }),
      }),
    }),
  }),
}))

// next-themes registers a `matchMedia` listener unconditionally on mount
// (even with `enableSystem={false}`); jsdom has no `matchMedia` at all
// (same stand-in `ThemeQuickSwitch.test.tsx` already needs for the same
// reason).
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
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  resetWellnessPrefsWriterForTests()
})

function wrapper(userId: string) {
  const client = makeQueryClient()
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: { id: userId } as User, profile: null, learnerState: null }}>
          <ThemeProvider
            attribute="data-theme"
            themes={THEMES.map((entry) => entry.id)}
            defaultTheme="midnight"
            enableSystem={false}
            storageKey={THEME_STORAGE_KEY}
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    )
  }
}

describe('ShellHeaderControls', () => {
  it('G8: mounts useThemeSync, reconciling a stored theme onto the document root against a differing local theme', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'midnight')
    db.row = { prefs: { theme: 'arcade' } }

    render(<ShellHeaderControls />, { wrapper: wrapper('learner-one') })

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('arcade'))
  })
})
