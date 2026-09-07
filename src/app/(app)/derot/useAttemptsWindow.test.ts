import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearQueryClient, getQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { useKeepAttemptsResident } from './useAttemptsWindow'

// This hook binds explicitly to `getQueryClient()` (the real module-level
// browser singleton), not a client resolved through React context -- exactly
// like `arcade/[kind]/page.tsx` and `play/[game]/page.tsx` already do for
// `invalidateQueries`/`getQueryData` -- so no `QueryClientProvider` wrapper
// is needed here, and none is provided in production by either de-rot route
// itself (it comes once, ambiently, from `(app)/layout.tsx`).
afterEach(() => {
  cleanup()
  clearQueryClient()
})

const FIVE_MINUTES_AND_A_BIT = 5 * 60 * 1000 + 1_000

describe('useKeepAttemptsResident', () => {
  it('control case: with no observer at all, a seeded attempts row IS garbage-collected after the default five-minute gcTime -- proves the hazard this hook exists to close', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      getQueryClient().setQueryData(qk.attempts('u1'), [{ id: 'a1' }])
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES_AND_A_BIT)
      expect(getQueryClient().getQueryData(qk.attempts('u1'))).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a row seeded before this hook ever mounts resident past the default five-minute gcTime, with no other observer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const seeded = [{ id: 'a1' }]
      // Seeded before the observer attaches, exactly like `QuerySeed`'s
      // server-side hydration lands before any client component mounts.
      getQueryClient().setQueryData(qk.attempts('u1'), seeded)
      renderHook(() => useKeepAttemptsResident('u1'))
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES_AND_A_BIT)
      expect(getQueryClient().getQueryData(qk.attempts('u1'))).toEqual(seeded)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never calls queryFn -- registers a real observer with zero network requests', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const queryFnSpy = vi.fn()
      getQueryClient().setQueryDefaults(qk.attempts('u1'), { queryFn: queryFnSpy })
      renderHook(() => useKeepAttemptsResident('u1'))
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES_AND_A_BIT)
      expect(queryFnSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('once mounted, the row stays resident even after this hook unmounts (TanStack\'s own Removable.updateGcTime takes the max gcTime a query has ever seen -- this observer\'s Infinity sticks for the life of the client, a stronger guarantee, not a bug)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const seeded = [{ id: 'a1' }]
      getQueryClient().setQueryData(qk.attempts('u1'), seeded)
      const { unmount } = renderHook(() => useKeepAttemptsResident('u1'))
      unmount()
      await vi.advanceTimersByTimeAsync(FIVE_MINUTES_AND_A_BIT)
      expect(getQueryClient().getQueryData(qk.attempts('u1'))).toEqual(seeded)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keys off the empty-string fallback when userId is null, matching LessonView.tsx, without throwing', () => {
    expect(() => renderHook(() => useKeepAttemptsResident(null))).not.toThrow()
  })

  it('never throws when rendered with no QueryClientProvider ambient in the tree (matches how the de-rot pages mount it)', () => {
    // The exact regression this shape guards against: a prior `useQuery`-based
    // draft of this hook resolved its client through React context
    // (`useQueryClient()`), which threw "No QueryClient set" for any harness
    // that renders a de-rot page without wrapping it in a `QueryClientProvider`
    // (e.g. src/lib/agents/no-agent-surfaces.test.tsx's Arcade/Playground
    // blocks, which mount the real page with only a `SessionProvider`).
    expect(() => renderHook(() => useKeepAttemptsResident('u1'))).not.toThrow()
  })
})
