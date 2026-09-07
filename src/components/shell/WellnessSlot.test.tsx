import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { resetReminderBadgeForTests } from '@/lib/wellness/reminderBadge'
import { resetDockPrefsCacheForTests } from '@/lib/wellness/dock'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { WellnessSlot } from './WellnessSlot'

const mocks = vi.hoisted(() => ({ pathname: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname() }))

// `WellnessSlot` only decides *which* dock to render and with what
// orientation/collapsed/corner -- `Dock`'s own rendering is Dock.test.tsx's
// job, so it is stubbed here to keep this file about routing, not content.
vi.mock('@/components/wellness/Dock', () => ({
  Dock: (props: { orientation: string; collapsed: boolean; onToggleCollapse: () => void; corner: string }) => (
    <div data-testid="dock-stub" data-orientation={props.orientation} data-collapsed={String(props.collapsed)} data-corner={props.corner}>
      <button type="button" onClick={props.onToggleCollapse}>toggle</button>
    </div>
  ),
}))

const db = vi.hoisted(() => ({ prefs: {} as Record<string, unknown> }))
// Stateful (like Dock.test.tsx / SoundToggle.test.tsx): `useDockPrefsMutation`'s
// debounced write eventually settles and invalidates the query, which
// refetches through this same mock -- a static mock would revert the
// optimistic value to stale data the instant that refetch lands.
const mocks_supabase = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { prefs: db.prefs }, error: null }) }) }),
      update: (patch: { prefs?: Record<string, unknown> }) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              mocks_supabase.update(patch)
              if (patch.prefs) db.prefs = patch.prefs
              return { data: { user_id: 'learner-one' }, error: null }
            },
          }),
        }),
      }),
      insert: async () => ({ data: null, error: null }),
    }),
  }),
}))

beforeEach(() => {
  db.prefs = {}
  mocks_supabase.update.mockClear()
  mocks.pathname.mockReturnValue('/dashboard')
})
afterEach(() => {
  cleanup()
  resetReminderBadgeForTests()
  resetDockPrefsCacheForTests()
})

function wrapper() {
  const client = makeQueryClient()
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: { id: 'learner-one' } as User, profile: null, learnerState: null }}>
          {children}
        </SessionProvider>
      </QueryClientProvider>
    )
  }
}

describe('WellnessSlot', () => {
  it('C3: mounts a headless dock (no visible chrome, reminder engine keeps running) for placement "hidden"', async () => {
    db.prefs = { dock: { placement: 'hidden' } }
    render(<WellnessSlot />, { wrapper: wrapper() })
    await vi.waitFor(() => expect(screen.getByTestId('dock-stub').dataset.orientation).toBe('headless'))
    // The header's `DockControl` is the only visible way back -- this stub
    // itself renders no visible chrome (Dock.test.tsx covers that directly).
  })

  it('renders a vertical dock for placement "right" (the default)', async () => {
    render(<WellnessSlot />, { wrapper: wrapper() })
    const stub = await screen.findByTestId('dock-stub')
    expect(stub.dataset.orientation).toBe('vertical')
    expect(stub.dataset.collapsed).toBe('false')
  })

  it('renders a vertical dock for placement "left" too -- same orientation, mirrored by ShellLayout', async () => {
    db.prefs = { dock: { placement: 'left' } }
    render(<WellnessSlot />, { wrapper: wrapper() })
    const stub = await screen.findByTestId('dock-stub')
    expect(stub.dataset.orientation).toBe('vertical')
  })

  it('renders a horizontal dock for placement "top"', async () => {
    db.prefs = { dock: { placement: 'top' } }
    render(<WellnessSlot />, { wrapper: wrapper() })
    // The default ('right', before the query resolves) also renders a
    // dock-stub, so wait for the orientation the resolved placement implies.
    await vi.waitFor(() => expect(screen.getByTestId('dock-stub').dataset.orientation).toBe('horizontal'))
  })

  it('portals a pill dock into document.body for placement "float", carrying the stored corner', async () => {
    db.prefs = { dock: { placement: 'float', corner: 'tl' } }
    render(<WellnessSlot />, { wrapper: wrapper() })
    await vi.waitFor(() => expect(screen.getByTestId('dock-stub').dataset.orientation).toBe('pill'))
    const stub = screen.getByTestId('dock-stub')
    expect(stub.dataset.corner).toBe('tl')
    expect(document.body.contains(stub)).toBe(true)
  })

  it('R6.3: collapses on the exercise route when compactOnExercise is on, without changing placement away from "left"', async () => {
    db.prefs = { dock: { placement: 'left' } }
    mocks.pathname.mockReturnValue('/exercise/one')
    render(<WellnessSlot />, { wrapper: wrapper() })
    const stub = await screen.findByTestId('dock-stub')
    expect(stub.dataset.orientation).toBe('vertical')
    expect(stub.dataset.collapsed).toBe('true')
  })

  it('R6.3: stays expanded on the exercise route once compactOnExercise is turned off', async () => {
    db.prefs = { dock: { placement: 'right', compactOnExercise: false } }
    mocks.pathname.mockReturnValue('/exercise/one')
    render(<WellnessSlot />, { wrapper: wrapper() })
    // The default (compactOnExercise: true, before the query resolves) starts
    // collapsed on this route; wait for the resolved preference to expand it.
    await vi.waitFor(() => expect(screen.getByTestId('dock-stub').dataset.collapsed).toBe('false'))
  })

  it('R6.3: also collapses on the lesson route', async () => {
    mocks.pathname.mockReturnValue('/lesson/INFS1101-3')
    render(<WellnessSlot />, { wrapper: wrapper() })
    const stub = await screen.findByTestId('dock-stub')
    expect(stub.dataset.collapsed).toBe('true')
  })

  it('I5: collapse survives a remount, through the real (debounced) write path', async () => {
    db.prefs = { dock: { placement: 'right' } } // collapsed: false
    mocks.pathname.mockReturnValue('/dashboard')
    const { unmount } = render(<WellnessSlot />, { wrapper: wrapper() })
    const stub = await screen.findByTestId('dock-stub')
    await vi.waitFor(() => expect(stub.dataset.collapsed).toBe('false'))

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
    await vi.waitFor(() => expect(screen.getByTestId('dock-stub').dataset.collapsed).toBe('true'))
    // Wait for the 400ms-debounced network write (I2) to actually land.
    await vi.waitFor(() => expect(resolveWellnessPrefs(db.prefs).dock.collapsed).toBe(true), { timeout: 2000 })

    unmount()
    render(<WellnessSlot />, { wrapper: wrapper() })
    const remounted = await screen.findByTestId('dock-stub')
    await vi.waitFor(() => expect(remounted.dataset.collapsed).toBe('true'))
  })

  describe('I1: the route-forced expand control never corrupts the stored preference', () => {
    it('toggles a session-only override on /exercise instead of writing dock.collapsed, and expands', async () => {
      db.prefs = { dock: { placement: 'right' } } // collapsed: false stored -- the route alone forces it
      mocks.pathname.mockReturnValue('/exercise/one')
      render(<WellnessSlot />, { wrapper: wrapper() })
      const stub = await screen.findByTestId('dock-stub')
      await vi.waitFor(() => expect(stub.dataset.collapsed).toBe('true'))

      fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
      expect(stub.dataset.collapsed).toBe('false')
      // Never wrote to the stored preference: still 'right', not collapsed by choice.
      expect(mocks_supabase.update).not.toHaveBeenCalled()
    })

    it('resets the session override on navigation, so a later route sees the route-forced collapse again', async () => {
      db.prefs = { dock: { placement: 'right' } }
      mocks.pathname.mockReturnValue('/exercise/one')
      const { rerender } = render(<WellnessSlot />, { wrapper: wrapper() })
      const stub = await screen.findByTestId('dock-stub')
      await vi.waitFor(() => expect(stub.dataset.collapsed).toBe('true'))
      fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
      expect(stub.dataset.collapsed).toBe('false')

      mocks.pathname.mockReturnValue('/exercise/two')
      rerender(<WellnessSlot />)
      expect(screen.getByTestId('dock-stub').dataset.collapsed).toBe('true')
    })

    it('uses the normal persisted toggle (not a session override) when the stored preference itself is collapsed', async () => {
      // Off any focus route, so `effectiveCollapsed` is driven only by the
      // stored `collapsed` flag -- isolating this from the route's own
      // (separate) `compactOnExercise` force, which is covered above.
      db.prefs = { dock: { placement: 'right', collapsed: true } }
      mocks.pathname.mockReturnValue('/dashboard')
      render(<WellnessSlot />, { wrapper: wrapper() })
      const stub = await screen.findByTestId('dock-stub')
      await vi.waitFor(() => expect(stub.dataset.collapsed).toBe('true'))

      fireEvent.click(screen.getByRole('button', { name: 'toggle' }))
      // The optimistic cache write lands immediately (the network write is
      // debounced, I2), reflecting the *stored* preference actually changing.
      await vi.waitFor(() => expect(screen.getByTestId('dock-stub').dataset.collapsed).toBe('false'))
    })
  })
})
