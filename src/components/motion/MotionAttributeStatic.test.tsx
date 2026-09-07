import { act, cleanup, render, waitFor } from '@testing-library/react'
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

  // N1 (W4FIX-B2 re-check, round 2): the two rules a source-scan guard
  // cannot enforce, so they are written out here instead --
  //   1. A negative assertion never goes inside `waitFor`. `waitFor` proves
  //      a value ARRIVES; it evaluates its callback once, synchronously,
  //      before any flush, so it can return on a stale pre-update value and
  //      never observe a later clobber. A claim that "X never happens"
  //      needs a real flush (`act(async () => ...)`) followed by a direct,
  //      un-wrapped `expect`.
  //   2. The opening wait in a race test must be for a value only the
  //      component under test can produce. The race case below starts the
  //      OS at "not reducing" specifically so the opening
  //      `waitFor('reduced')` cannot be satisfied by `MotionAttributeStatic`
  //      own OS-only write (which would write 'full') -- only the
  //      prefs-aware `MotionAttribute`, once its wellness query resolves,
  //      can produce 'reduced' here. Starting the OS already agreeing with
  //      the stored preference (the previous version of this test) lets the
  //      opening wait pass before the query has resolved at all, which is
  //      exactly the vacuous shape the re-check found: 5/5 green with the
  //      whole claim mechanism deleted.
  describe('the two-writer race (F3, W4FIX-B2 re-check)', () => {
    it("an OS motion change mid-session does not override the learner's stored preference", async () => {
      // OS starts NOT reducing -- disagreeing with the learner's stored
      // 'reduced' setting, so the opening wait below is discriminating (see
      // rule 2 above): only the prefs-aware writer, once its query
      // resolves, can produce 'reduced' while the OS itself says 'full'.
      const mql = installMatchMedia(false)
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

      // Discriminating (rule 2): with the OS quiet, only the prefs-aware
      // writer can produce 'reduced', so this cannot pass until the
      // wellness query has resolved.
      await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))

      // The OS toggles "reduce motion" ON then OFF mid-session (e.g.
      // Windows' battery saver flipping) while the learner's own setting
      // stays 'reduced'. Each `mql.set()` re-runs MotionAttributeStatic's
      // effect with a new OS-only resolution -- before the fix, the final
      // 'full' write went straight through and clobbered the learner's
      // preference. It must bail out instead, because MotionAttribute
      // still claims ownership and its own resolved value ('reduced', from
      // the explicit preference) never changed.
      await act(async () => { mql.set(true); await Promise.resolve() })
      await act(async () => { mql.set(false); await Promise.resolve() })

      // Direct assertion, not `waitFor` (rule 1): this is a negative claim
      // ("the clobber never lands"), and `waitFor` evaluating once
      // synchronously against an already-stale value would let a real
      // clobber slip past unnoticed. The two `act(async () => ...)` calls
      // above are real flushes -- the store update, the re-render and the
      // passive effects all drain before this line runs -- so this sees the
      // settled value.
      expect(document.documentElement.dataset.motion).toBe('reduced')
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
      // change. The discriminating assertion is the flip to 'full' below --
      // OS-false differs from 'reduced', the last prefs-aware write, so it
      // can only pass if MotionAttributeStatic is genuinely back in
      // control (a still-claimed writer would leave the attribute stuck at
      // 'reduced'). `mql.set(true)` first is not itself asserted on: it
      // exists only to give the fake media query list a real, COMMITTED
      // state transition to notify listeners with, each in its own `act()`
      // -- two bare `mql.set()` calls back to back, with no flush between
      // them, let React coalesce both notifications into one check of
      // `getSnapshot()` after both have already run (false -> true -> false
      // nets out to the same value the last render already cached), which
      // bails out with no re-render at all and leaves the effect never
      // re-running.
      act(() => { mql.set(true) })
      act(() => { mql.set(false) })
      await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))
    })
  })
})
