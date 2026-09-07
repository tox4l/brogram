import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MotionPreference } from '@/lib/contracts'

// C1: the regression this suite exists to catch -- `data-motion` must carry
// the RESOLVED preference (`useReducedMotion(prefs.motion)`), not the raw
// `(prefers-reduced-motion: reduce)` signal, or a learner who sets
// `wellness.prefs.motion = 'reduced'` on an OS reporting no preference gets
// `data-motion="full"`, a no-op against `globals.css`'s
// `:root[data-motion='reduced']` kill switch.
//
// `createClient` (Supabase) is mocked rather than `@/lib/query/hooks` --
// `MotionAttribute` deliberately reads auth state independent of
// `SessionContext` (see its own header comment for why) and this suite
// exercises that real path, with a real `QueryClientProvider` in the tree.

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
}

function installMatchMedia(initial: boolean) {
  const mql = new FakeMediaQueryList(initial)
  window.matchMedia = ((query: string) => {
    if (query !== '(prefers-reduced-motion: reduce)') throw new Error(`unexpected query: ${query}`)
    return mql as unknown as MediaQueryList
  }) as typeof window.matchMedia
}

/** `userId: null` models a signed-out learner: `getUser` resolves no user
 *  and the `wellness` select is never expected to run. */
function mockAuth(userId: string | null, motion?: MotionPreference) {
  supabaseMocks.getUser.mockResolvedValue({ data: { user: userId ? { id: userId } : null } })
  supabaseMocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  supabaseMocks.maybeSingle.mockResolvedValue({ data: motion === undefined ? null : { prefs: { motion } }, error: null })
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

describe('MotionAttribute', () => {
  it("C1: prefs.motion='reduced' on an OS reporting no preference still writes data-motion='reduced'", async () => {
    installMatchMedia(false)
    mockAuth('user-1', 'reduced')
    const { MotionAttribute } = await import('./MotionAttribute')
    renderWithClient(<MotionAttribute />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
  })

  it("C1: prefs.motion='full' on an OS asking to reduce still writes data-motion='full' -- the in-app override wins", async () => {
    installMatchMedia(true)
    mockAuth('user-1', 'full')
    const { MotionAttribute } = await import('./MotionAttribute')
    renderWithClient(<MotionAttribute />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))
  })

  it("a signed-out learner (no auth user) defers to the OS signal -- reduce on", async () => {
    installMatchMedia(true)
    mockAuth(null)
    const { MotionAttribute } = await import('./MotionAttribute')
    renderWithClient(<MotionAttribute />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'))
    expect(supabaseMocks.maybeSingle).not.toHaveBeenCalled()
  })

  it("prefs.motion='system' with no OS preference writes data-motion='full'", async () => {
    installMatchMedia(false)
    mockAuth('user-1', 'system')
    const { MotionAttribute } = await import('./MotionAttribute')
    renderWithClient(<MotionAttribute />)
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('full'))
  })

  it('renders nothing', async () => {
    installMatchMedia(false)
    mockAuth(null)
    const { MotionAttribute } = await import('./MotionAttribute')
    const { container } = renderWithClient(<MotionAttribute />)
    expect(container.innerHTML).toBe('')
  })
})
