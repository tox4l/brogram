import type { PropsWithChildren } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { ShellLayout } from './ShellLayout'

// jsdom never computes actual CSS grid layout (no real box model), so a test
// asserting "the wide column is on the left" would pass even if `main` and
// `aside` were assigned to the wrong tracks by an unaccounted extra grid
// item -- exactly what happened here (a live capture on a fresh account
// showed `main` squeezed into the dock's 17.5rem track and `aside` wrapped
// onto a second row, because `<Toaster/>` -- an ordinary, non-positioned
// `<section>` while no toast is showing -- was a third, uncounted child of
// the `display:grid` container). What jsdom *can* verify, and what actually
// catches that class of bug, is the real regression guard: the grid
// container's direct children are exactly the elements the template
// document above says they are, in that exact order, with no extra sibling
// -- so `main` always lands in the first auto-placement slot and `aside` (or
// the portal target) in the second, never a third item nobody accounted for.

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

  // T4.5 fix round (review finding I2): the rail's first label baseline must
  // land within 2px of the page H1 baseline. Both start at the same
  // container top (the shared `py-6`), but the rail's first line (a
  // `text-small` heading) sits ~9-13px above where an H1's first baseline
  // falls, so the rail needs its own top offset to compensate -- pinned here
  // as a class assertion; the real geometry is asserted in e2e/measure.spec.ts.
  it('gives the left rail an lg:pt-3 offset so its first label baseline approaches the page H1 baseline', async () => {
    render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('left') })
    const aside = await screen.findByRole('complementary', { name: 'Wellness' })
    expect(aside.className).toMatch(/\blg:pt-3\b/)
  })

  it('gives the right rail an lg:pt-3 offset so its first label baseline approaches the page H1 baseline', async () => {
    render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('right') })
    const aside = await screen.findByRole('complementary', { name: 'Wellness' })
    expect(aside.className).toMatch(/\blg:pt-3\b/)
  })

  // R6.3 / I4: the v1 rail special-cased the exercise route directly inside
  // this component ("dock leads, compact strip", `usePathname()`-driven).
  // That assertion is gone because the mechanism it pinned is gone: this
  // component no longer reads the route at all (see the header comment) --
  // route-driven collapse now lives one level down, in `WellnessSlot`
  // (`effectiveCollapsed`, its own R6.3 tests) and is exercised end to end in
  // `dashboard/page.test.tsx`. What replaces the old guarantee here is the
  // negative: the grid stays keyed on placement alone, on the exercise route
  // exactly as everywhere else.
  it('R6.3: the exercise route has no effect on the grid -- placement is the only input', async () => {
    // No `usePathname()` mock is set up at all in this file (unlike
    // `WellnessSlot.test.tsx`) because this component genuinely never calls
    // it; the assertion here is that the grid comes out keyed on placement
    // regardless -- there is no route-shaped input for it to react to.
    render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('left') })

    const grid = await vi.waitFor(() => {
      const el = screen.getByRole('main').parentElement
      expect(el?.className).toContain('lg:grid-cols-[17.5rem_minmax(0,1fr)]')
      return el
    })
    const aside = screen.getByRole('complementary', { name: 'Wellness' })
    expect(aside.className).toContain('order-first')
    expect(grid?.className).not.toContain('lg:grid-cols-[minmax(0,1fr)_17.5rem]')
  })

  // Fix round 4 (the fresh-account /derot regression): `<Toaster/>` must
  // never be a child of the grid container -- one per placement, asserting
  // both the computed grid template and exactly which elements occupy the
  // grid's own children, in what order, with nothing extra.
  describe('grid item count -- no unaccounted grid item can steal main\'s track', () => {
    function directChildTags(grid: Element | null): string[] {
      return grid ? [...grid.children].map((child) => child.tagName) : []
    }

    it('right: grid children are exactly [main, aside], main first (the wide 1fr track)', async () => {
      render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('right') })
      const grid = await vi.waitFor(() => {
        const el = screen.getByRole('main').parentElement
        expect(el?.className).toContain('lg:grid-cols-[minmax(0,1fr)_17.5rem]')
        return el
      })
      expect(directChildTags(grid)).toEqual(['MAIN', 'ASIDE'])
    })

    it('left: grid children are exactly [main, aside] in the DOM (order-first is CSS-only), the 17.5rem track', async () => {
      render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('left') })
      const grid = await vi.waitFor(() => {
        const el = screen.getByRole('main').parentElement
        expect(el?.className).toContain('lg:grid-cols-[17.5rem_minmax(0,1fr)]')
        return el
      })
      expect(directChildTags(grid)).toEqual(['MAIN', 'ASIDE'])
    })

    it('top: grid children are exactly [aside, main], the strip before main in document order', async () => {
      render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('top') })
      const grid = await vi.waitFor(() => {
        const el = screen.getByRole('main').parentElement
        expect(el?.className).not.toContain('lg:grid-cols-')
        return el
      })
      expect(directChildTags(grid)).toEqual(['ASIDE', 'MAIN'])
    })

    it('float: grid children are exactly [main, dock] -- ShellLayout renders whatever `dock` is verbatim; making it an actual portal (so it is not really a grid child in production) is WellnessSlot\'s job, not this component\'s', async () => {
      render(<ShellLayout dock={<div>Floating dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('float') })
      const grid = await vi.waitFor(() => {
        const el = screen.getByRole('main').parentElement
        expect(el?.className).not.toContain('lg:grid-cols-')
        return el
      })
      expect(directChildTags(grid)).toEqual(['MAIN', 'DIV'])
    })

    it('hidden: grid children are exactly [main] -- nothing else, dock renders nothing here', async () => {
      render(<ShellLayout dock={null}><p>Content</p></ShellLayout>, { wrapper: wrapper('hidden') })
      const grid = await vi.waitFor(() => {
        const el = screen.getByRole('main').parentElement
        expect(el?.className).not.toContain('lg:grid-cols-')
        return el
      })
      expect(directChildTags(grid)).toEqual(['MAIN'])
    })

    it('the toast host is never a child of the grid container, in any placement', async () => {
      render(<ShellLayout dock={<div>Dock</div>}><p>Content</p></ShellLayout>, { wrapper: wrapper('right') })
      const grid = await vi.waitFor(() => {
        const el = screen.getByRole('main').parentElement
        expect(el?.className).toContain('lg:grid-cols-')
        return el
      })
      const toastHost = screen.getByLabelText(/Notifications/i)
      expect(grid?.contains(toastHost)).toBe(false)
    })
  })
})
