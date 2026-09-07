import type { PropsWithChildren } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { WellnessSlot } from './WellnessSlot'

const mocks = vi.hoisted(() => ({ pathname: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname() }))

// `WellnessSlot` only decides *which* dock to render and with what
// orientation/collapsed/corner -- `Dock`'s own rendering is Dock.test.tsx's
// job, so it is stubbed here to keep this file about routing, not content.
vi.mock('@/components/wellness/Dock', () => ({
  Dock: (props: { orientation: string; collapsed: boolean; corner: string }) => (
    <div data-testid="dock-stub" data-orientation={props.orientation} data-collapsed={String(props.collapsed)} data-corner={props.corner} />
  ),
}))

const db = vi.hoisted(() => ({ prefs: {} as Record<string, unknown> }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { prefs: db.prefs }, error: null }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { user_id: 'learner-one' }, error: null }) }) }) }),
      insert: async () => ({ data: null, error: null }),
    }),
  }),
}))

beforeEach(() => {
  db.prefs = {}
  mocks.pathname.mockReturnValue('/dashboard')
})
afterEach(cleanup)

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
  it('renders nothing for placement "hidden" -- the header re-open glyph is the only way back', async () => {
    db.prefs = { dock: { placement: 'hidden' } }
    render(<WellnessSlot />, { wrapper: wrapper() })
    await vi.waitFor(() => expect(screen.queryByTestId('dock-stub')).toBeNull())
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
})
