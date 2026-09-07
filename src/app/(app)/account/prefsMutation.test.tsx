import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { hasPendingPrefsWrite, resetWellnessPrefsWriterForTests, useWellnessPrefsMutation } from './prefsMutation'

const db = vi.hoisted(() => ({ row: null as { prefs?: unknown } | null, selectGate: null as Promise<void> | null }))
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn(), toast: vi.fn() }))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          // `db.selectGate`, when set, holds the read open until the test
          // releases it -- how the in-flight-write tests below observe
          // `hasPendingPrefsWrite` true for the network round trip itself,
          // not just the pre-flush debounce window.
          maybeSingle: async () => { mocks.select(table); if (db.selectGate) await db.selectGate; return { data: db.row, error: null } },
        }),
      }),
      update: (patch: { prefs?: unknown }) => ({
        eq: (column: string, value: string) => ({
          select: () => ({
            maybeSingle: async () => {
              mocks.update(table, patch, column, value)
              if (!db.row) return { data: null, error: null }
              db.row = { ...db.row, ...patch }
              return { data: { user_id: value }, error: null }
            },
          }),
        }),
      }),
      insert: async (payload: { user_id: string; prefs: unknown }) => {
        mocks.insert(table, payload)
        db.row = { prefs: payload.prefs }
        return { data: null, error: null }
      },
    }),
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  db.row = { prefs: {} }
  db.selectGate = null
})
afterEach(() => {
  vi.useRealTimers()
  // `resetAllMocks` (not `clearAllMocks`): a couple of cases above set a
  // persistent `mockImplementation` (not `...Once`) on `mocks.select` to
  // simulate a run of failures, which `clearAllMocks` would leave in place
  // for every test after it -- the network-round-trip case below needs
  // `mocks.select` to actually succeed.
  vi.resetAllMocks()
  // The module-level writer store (module-level so every component instance
  // shares one queue in production, see prefsMutation.ts's doc comment)
  // would otherwise leak pending/timer/failure state across test cases.
  resetWellnessPrefsWriterForTests()
})

function wrapper() {
  const client = makeQueryClient()
  return { Wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>, client }
}

describe('useWellnessPrefsMutation', () => {
  it('applies the change to the query cache before the network call resolves', () => {
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate((current) => ({ dailyGoal: (current.dailyGoal ?? 3) + 1 })) })

    const cached = client.getQueryData<{ prefs: unknown }>(qk.wellness('learner-1'))
    expect((cached?.prefs as { dailyGoal?: number })?.dailyGoal).toBe(4)
    // Zero network wait: nothing has been sent yet -- it is debounced.
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('debounces the write-through at 400ms, coalescing a burst into one round trip', async () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ dailyGoal: 5 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    act(() => { result.current.mutate(() => ({ dailyGoal: 6 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(mocks.update).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith('wellness', expect.objectContaining({ prefs: expect.objectContaining({ dailyGoal: 6 }) }), 'user_id', 'learner-1')
  })

  it('merges two different fields on the same nested object across a debounce window, one-level deep', async () => {
    db.row = { prefs: { sound: { enabled: true, volume: 0.6, interface: false } } }
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate((current) => ({ sound: { ...current.sound, enabled: false } })) })
    act(() => { result.current.mutate((current) => ({ sound: { ...current.sound, volume: 0.3 } })) })

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const written = mocks.update.mock.calls[0][1] as { prefs: { sound?: Record<string, unknown> } }
    expect(written.prefs.sound).toEqual({ enabled: false, volume: 0.3, interface: false })
  })

  it('never reverts the cached value when the write-through rejects', async () => {
    mocks.select.mockImplementationOnce(() => { throw new Error('offline') })
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ dailyGoal: 7 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.select).toHaveBeenCalled()

    const cached = client.getQueryData<{ prefs: unknown }>(qk.wellness('learner-1'))
    expect((cached?.prefs as { dailyGoal?: number })?.dailyGoal).toBe(7)
  })

  it('toasts only after repeated consecutive failures, not the first', async () => {
    mocks.select.mockImplementation(() => { throw new Error('offline') })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ dailyGoal: 8 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(mocks.toast).not.toHaveBeenCalled()

    act(() => { result.current.mutate(() => ({ dailyGoal: 9 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.select).toHaveBeenCalledTimes(2)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('does nothing when signed out beyond applying the change locally', () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation(null), { wrapper: Wrapper })
    expect(() => act(() => { result.current.mutate(() => ({ dailyGoal: 2 })) })).not.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

/**
 * X3's guard: `Dock.useRowMutation` (water/pomodoro row columns) shares
 * `qk.wellness` with this writer but is not itself a prefs write -- it must
 * skip its own settle-invalidate while this queue still has an unflushed or
 * in-flight prefs change, or its refetch lands the server's stale prefs
 * snapshot back over a change the learner just made (the flipped-toggle
 * scenario X3 traces).
 */
describe('hasPendingPrefsWrite', () => {
  it('is false for a user with no writer at all', () => {
    expect(hasPendingPrefsWrite('nobody')).toBe(false)
  })

  it('is true the instant a change is queued, before the debounce fires', () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })
    expect(hasPendingPrefsWrite('learner-1')).toBe(false)
    act(() => { result.current.mutate(() => ({ dailyGoal: 4 })) })
    expect(hasPendingPrefsWrite('learner-1')).toBe(true)
  })

  it('stays true for the network round trip itself, not just the debounce window', async () => {
    let releaseSelect: () => void = () => {}
    db.selectGate = new Promise((resolve) => { releaseSelect = resolve })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ dailyGoal: 4 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    // The debounce has fired and the read is blocked on the gate: no longer
    // "queued", but the write is still in flight.
    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(hasPendingPrefsWrite('learner-1')).toBe(true)

    releaseSelect()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(hasPendingPrefsWrite('learner-1')).toBe(false)
  })

  it('returns to false after a failed write-through -- a rejected guard would block every row writer forever', async () => {
    mocks.select.mockImplementationOnce(() => { throw new Error('offline') })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ dailyGoal: 4 })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(hasPendingPrefsWrite('learner-1')).toBe(false)
  })

  it('is scoped per user id', () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useWellnessPrefsMutation('learner-1'), { wrapper: Wrapper })
    act(() => { result.current.mutate(() => ({ dailyGoal: 4 })) })
    expect(hasPendingPrefsWrite('learner-1')).toBe(true)
    expect(hasPendingPrefsWrite('learner-2')).toBe(false)
  })
})
