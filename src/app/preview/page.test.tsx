import type { ReactElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryProvider } from '@/components/shell/QueryProvider'

// sonner's Toaster (mounted by the wellness rail) reads window.matchMedia for OS theme
// detection. Real browsers always have it; jsdom does not.
beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
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
})

const mocks = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error('NOT_FOUND') }) }))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  usePathname: () => '/preview',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Every screen here reads Supabase; this generic thenable chain always resolves
// empty so the wellness rail and buddy drawer hit their real fetch-failed paths
// without making a network call or hanging the test.
function chain(): unknown {
  const node = {
    select: () => chain(),
    eq: () => chain(),
    order: () => chain(),
    update: () => chain(),
    insert: () => chain(),
    limit: () => chain(),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return node
}
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => chain() }) }))

// The CodeMirror-backed Editor is exercised on its own in Editor.test.tsx; stubbing it
// here keeps this gallery-wide render test fast and independent of CodeMirror internals.
vi.mock('@/components/exercise/Editor', () => ({ Editor: () => <div data-testid="editor-stub" /> }))
// ReportPages recomputes every derived report number from fixture history; ReportPages.test.tsx
// and derive.test.ts already cover it, so this test only needs to know the section mounted it.
vi.mock('@/components/report', () => ({
  ReportPages: () => <div data-testid="report-pages-stub" />,
  DownloadReportButton: () => <button type="button">Download PDF</button>,
  REPORT_PAGE_WIDTH_PX: 794,
  REPORT_PAGE_HEIGHT_PX: 1123,
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in tests')))
  const getCurrentPosition = vi.fn()
  Object.defineProperty(window.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('preview layout gate', () => {
  it('calls notFound outside development', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { default: PreviewLayout } = await import('./layout')
    expect(() => PreviewLayout({ children: <p>content</p> })).toThrow('NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })

  it('renders children in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { default: PreviewLayout } = await import('./layout')
    const result = PreviewLayout({ children: <p>content</p> }) as ReactElement
    render(result)
    expect(screen.getByText('content')).toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})

describe('preview page', () => {
  it('renders every gallery section heading', async () => {
    const { default: PreviewPage } = await import('./page')
    // F1 (W4FIX-B2 re-check): `PreviewPage` always renders nested inside
    // `src/app/preview/layout.tsx`'s own `<QueryProvider>` in production --
    // wrapping it here too matches that, and matters for the no-alert
    // assertion below: without it, every `useQuery`/`useQueryClient` call in
    // the gallery (the shell header controls, the wellness dock, the buddy
    // drawer) throws "No QueryClient set", and `Section.tsx`'s own
    // `SectionErrorBoundary` catches it and renders "This section could not
    // render: ..." in that section's place -- the exact regression this
    // assertion exists to catch.
    render(<QueryProvider><PreviewPage /></QueryProvider>)

    // The buddy drawer's own section opens by default, and the underlying Drawer
    // primitive marks the rest of the page aria-hidden while it is open (correct
    // modal behavior), so heading lookups below must include hidden elements.
    const heading = (name: string) => screen.getByRole('heading', { name, hidden: true })

    expect(screen.getByText('BroGram UI preview', { exact: false })).toBeTruthy()
    expect(heading('Login')).toBeTruthy()
    expect(heading('Shell and dashboard')).toBeTruthy()
    expect(heading('Onboarding')).toBeTruthy()
    expect(heading('Exercise screen')).toBeTruthy()
    expect(heading('De-rot')).toBeTruthy()
    expect(heading('Reports')).toBeTruthy()
    expect(heading('Admin')).toBeTruthy()
    expect(heading('Wellness and buddy')).toBeTruthy()

    // A representative fixture-driven element from a couple of sections, to
    // confirm data actually reached the real components rather than the page
    // only rendering empty shells.
    expect(screen.getByText('First late train')).toBeTruthy()
    expect(screen.getByTestId('report-pages-stub')).toBeTruthy()

    // F1 (W4FIX-B2 re-check): every `useQuery`/`useQueryClient` call on this
    // page (the buddy drawer, the shell dashboard section) needs a
    // `QueryClientProvider` above it. Before `layout.tsx` supplied one, each
    // threw "No QueryClient set" and React rendered a `role="alert"` error
    // boundary in that section's place instead -- a failure the heading
    // assertions above never catch, since a heading can render fine while
    // the content beneath it is an alert box. This is the one assertion
    // that would have caught it.
    expect(screen.queryAllByRole('alert', { hidden: true }).map((node) => node.textContent).join()).not.toMatch(/could not render/)
  })
})
