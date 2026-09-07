import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// W4FIX-B2: the root-layout half of MotionAttribute's split (see the
// component's own header comment). No QueryClientProvider, no Supabase
// mock -- proving it needs neither is the point: `/` and `/login` mount
// this, not the full `MotionAttribute`, precisely so neither route pays for
// TanStack Query or the Supabase client just to resolve `data-motion`.

// F3 (W4FIX-B2 re-check): the two-writer race. `MotionAttribute` is mocked
// the same way `MotionAttribute.test.tsx` mocks it (real QueryClientProvider,
// mocked Supabase auth/wellness) so this suite can render BOTH writers
// together, exactly as every authenticated route does in practice
// (`MotionAttributeStatic` from the root `Providers`, `MotionAttribute` from
// `(app)/providers.tsx`'s `AppEffects`, nested inside it).
const supabaseMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: supabaseMocks.getUser,
      onAuthStateChange: supabaseMocks.onAuthStateChange,
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: supabaseMocks.maybeSingle,
        }),
      }),
    }),
  }),
}))

class FakeMediaQueryList {
  matches: boolean
  private listeners = new Set<(event: { matches: boolean }) => void>()

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) {
    this.listeners.delete(listener)
  }

  /** Test-only: flips the OS signal and notifies every subscribed
   *  `useSyncExternalStore` listener, the way a real `change` event would. */
  set(matches: boolean) {
    this.matches = matches
    for (const listener of this.listeners) listener({ matches })
  }
}

function installMatchMedia(initial: boolean): FakeMediaQueryList {
  const mql = new FakeMediaQueryList(initial)
  window.matchMedia = ((query: string) => {
    if (query !== '(prefers-reduced-motion: reduce)') throw new Error(`unexpected query: ${query}`)
    return mql as unknown as MediaQueryList
  }) as typeof window.matchMedia
  return mql
}

function mockAuth(userId: string, motion: string) {
  supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: userId } } })
  supabaseMocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  supabaseMocks.maybeSingle.mockResolvedValue({ data: { prefs: { motion } }, error: null })
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient()
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  supabaseMocks.getUser.mockReset()
  supabaseMocks.onAuthStateChange.mockReset()
  supabaseMocks.maybeSingle.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete document.documentElement.dataset.motion
})

describe('MotionAttributeStatic', () => {
  it('writes data-motion="reduced" when the OS asks to reduce motion, with no query client in the tree', async () => {
    installMatchMedia(true)
    const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
    render(<MotionAttributeStatic />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
  })

  it('writes data-motion="full" when the OS reports no preference', async () => {
    installMatchMedia(false)
    const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
    render(<MotionAttributeStatic />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))
  })

  it('renders nothing', async () => {
    installMatchMedia(false)
    const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
    const { container } = render(<MotionAttributeStatic />)
    expect(container.innerHTML).toBe('')
  })

  describe('the two-writer race (F3, W4FIX-B2 re-check)', () => {
    it("an OS motion change mid-session does not override the learner's stored preference", async () => {
      // OS starts by asking to reduce motion, agreeing with the learner's
      // own 'reduced' setting -- so the first write, whichever component
      // makes it, looks correct either way. The bug only shows up once the
      // OS signal disagrees with the stored preference.
      const mql = installMatchMedia(true)
      mockAuth('user-1', 'reduced')
      const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
      const { MotionAttribute } = await import('./MotionAttribute')

      // Mirrors every authenticated route: MotionAttributeStatic mounts
      // from the root `Providers` boundary, MotionAttribute mounts nested
      // inside it from `(app)/providers.tsx`'s `AppEffects`.
      renderWithClient(
        <>
          <MotionAttributeStatic />
          <MotionAttribute />
        </>,
      )

      await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))

      // The OS turns "reduce motion" OFF mid-session (e.g. Windows' battery
      // saver leaving) while the learner's own setting stays 'reduced'.
      // This re-runs MotionAttributeStatic's effect with a new OS-only
      // resolution ('full') -- before the fix, that write went straight
      // through and clobbered the learner's preference. It must bail out
      // instead, because MotionAttribute still claims ownership and its own
      // resolved value ('reduced', from the explicit preference) never
      // changed.
      mql.set(false)
      await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
    })

    it('releases ownership back to the OS-only writer once MotionAttribute unmounts', async () => {
      const mql = installMatchMedia(false)
      mockAuth('user-1', 'reduced')
      const { MotionAttributeStatic } = await import('./MotionAttributeStatic')
      const { MotionAttribute } = await import('./MotionAttribute')

      function Scene({ signedIn }: { signedIn: boolean }) {
        return (
          <>
            <MotionAttributeStatic />
            {signedIn ? <MotionAttribute /> : null}
          </>
        )
      }

      // The same `QueryClientProvider` element (and the same `client`) must
      // stay at the root across both renders, or `rerender` unmounts the
      // WHOLE tree (root element type change) rather than just the
      // conditional `MotionAttribute` branch inside `Scene` -- which would
      // remount `MotionAttributeStatic` too and defeat the point of this
      // test (it needs to observe Static staying mounted throughout).
      const client = new QueryClient()
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <Scene signedIn />
        </QueryClientProvider>,
      )
      await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))

      // MotionAttribute unmounts (e.g. signing out, leaving (app)). Its
      // release re-asserts its own last value once more, so the attribute
      // does not silently jump to whatever MotionAttributeStatic's own
      // effect last computed while it was suppressed.
      rerender(
        <QueryClientProvider client={client}>
          <Scene signedIn={false} />
        </QueryClientProvider>,
      )
      expect(document.documentElement.dataset.motion).toBe('reduced')

      // Ownership is now free: the OS-only writer resumes on the next OS
      // change, exactly as it should once nobody is signed in.
      mql.set(true)
      await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
      mql.set(false)
      await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))
    })
  })
})
