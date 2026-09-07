import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { resetWellnessPrefsWriterForTests, useWellnessPrefsMutation } from './prefsMutation'

const db = vi.hoisted(() => ({ row: null as { prefs?: unknown } | null }))
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn(), toast: vi.fn() }))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { mocks.select(table); return { data: db.row, error: null } },
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
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
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
