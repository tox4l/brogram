import type { PropsWithChildren } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { ShellLayout } from './ShellLayout'

// `ShellLayout` reads `wellness.prefs.dock.placement` itself (T2.4: placement
// is a real layout decision, so the grid has to know it), through the same
// `useWellness()` query every other dock-aware component reads.
const db = vi.hoisted(() => ({ prefs: {} as Record<string, unknown> }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { prefs: db.prefs }, error: null }) }) }),
    }),
  }),
}))

beforeEach(() => { db.prefs = {} })
afterEach(cleanup)

function wrapper(placement?: string) {
  if (placement) db.prefs = { dock: { placement } }
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

describe('ShellLayout', () => {
  it('renders the skip-link target and the dock slot', async () => {
    render(
      <ShellLayout dock={<div>Wellness dock</div>}>
        <h1>Dashboard content</h1>
      </ShellLayout>,
      { wrapper: wrapper() },
    )

    const main = screen.getByRole('main')
    expect(main.id).toBe('main-content')
    expect(main.tabIndex).toBe(-1)
    expect(screen.getByText('Dashboard content')).toBeTruthy()

    const aside = await screen.findByRole('complementary', { name: 'Wellness' })
    expect(aside).toBeTruthy()
    expect(screen.getByText('Wellness dock')).toBeTruthy()
  })

  it('defaults to the right-rail, 280px grid before any placement preference loads', () => {
    render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper() })

    const grid = screen.getByRole('main').parentElement
    expect(grid?.className).toContain('lg:grid-cols-[minmax(0,1fr)_17.5rem]')
    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    expect(aside.className).not.toContain('order-first')
  })

  it('mirrors the rail to the left column for placement "left", without touching the route', async () => {
    render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('left') })

    const grid = await vi.waitFor(() => {
      const el = screen.getByRole('main').parentElement
      expect(el?.className).toContain('lg:grid-cols-[17.5rem_minmax(0,1fr)]')
      return el
    })
    expect(grid?.className).not.toContain('lg:grid-cols-[minmax(0,1fr)_17.5rem]')
    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    expect(aside.className).toContain('order-first')
  })

  it('switches to a full-width stacked strip above main for placement "top"', async () => {
    render(<ShellLayout dock={<div>Top dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('top') })

    // The default ('right', before the query resolves) also renders `dock` --
    // inside its own aside -- so waiting on text alone would pass instantly
    // against the stale default. Wait on the structural signal instead: the
    // grid template actually switching away from a column layout.
    const grid = await vi.waitFor(() => {
      const el = screen.getByRole('main').parentElement
      expect(el?.className).not.toContain('lg:grid-cols-')
      return el
    })
    expect(grid?.className).toContain('gap-4')
    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    expect(screen.getByText('Top dock')).toBeTruthy()
    // The strip sits above `main` in document order.
    expect(aside.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('takes the dock out of the grid entirely for placement "float" -- no aside landmark, main fills the row', async () => {
    render(<ShellLayout dock={<div>Floating dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('float') })

    await vi.waitFor(() => expect(screen.queryByRole('complementary', { name: 'Wellness' })).toBeNull())
    expect(screen.getByText('Floating dock')).toBeTruthy()
    const grid = screen.getByRole('main').parentElement
    expect(grid?.className).not.toContain('lg:grid-cols-')
  })

  it('renders nothing extra for placement "hidden" beyond whatever the dock slot itself renders', async () => {
    render(<ShellLayout dock={null}><p>Content</p></ShellLayout>, { wrapper: wrapper('hidden') })

    await vi.waitFor(() => expect(screen.queryByRole('complementary', { name: 'Wellness' })).toBeNull())
    expect(screen.getByText('Content')).toBeTruthy()
  })
})
