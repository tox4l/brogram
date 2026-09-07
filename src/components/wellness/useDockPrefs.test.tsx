import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { resetDockPrefsCacheForTests } from '@/lib/wellness/dock'
import type { WellnessRow } from '@/lib/learner/compile'
import { useDockPrefsMutation } from './useDockPrefs'

const db = vi.hoisted(() => ({ row: null as { prefs?: unknown } | null }))
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => { mocks.select(table); return { data: db.row, error: null } } }) }),
      update: (patch: Record<string, unknown>) => ({
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
      insert: async (payload: Record<string, unknown>) => {
        mocks.insert(table, payload)
        db.row = { ...payload }
        return { data: null, error: null }
      },
    }),
  }),
}))

beforeEach(() => {
  db.row = { prefs: {} }
  vi.useFakeTimers()
})
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  resetDockPrefsCacheForTests()
})

function wrapper() {
  const client = makeQueryClient()
  return { Wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>, client }
}

describe('useDockPrefsMutation', () => {
  it('applies the optimistic cache write and the localStorage mirror immediately, same call', () => {
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => useDockPrefsMutation('learner-one'), { wrapper: Wrapper })

    act(() => result.current.mutate(() => ({ placement: 'left' })))

    const cached = client.getQueryData<WellnessRow>(qk.wellness('learner-one'))
    expect((cached?.prefs as { dock?: { placement?: string } })?.dock?.placement).toBe('left')
    expect(localStorage.getItem('brogram:wellness:dock-cache')).toContain('"placement":"left"')
    // The network write has not happened yet -- it is debounced.
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('debounces the network write, coalescing a rapid burst to the latest change', async () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useDockPrefsMutation('learner-one'), { wrapper: Wrapper })

    act(() => {
      result.current.mutate(() => ({ corner: 'tr' }))
      result.current.mutate(() => ({ corner: 'bl' }))
      result.current.mutate(() => ({ corner: 'tl' }))
    })
    expect(mocks.update).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ prefs: expect.objectContaining({ dock: expect.objectContaining({ corner: 'tl' }) }) }),
      'user_id',
      'learner-one',
    )
  })

  it('never calls the network for a signed-out user, but still updates the cache', () => {
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => useDockPrefsMutation(null), { wrapper: Wrapper })

    act(() => result.current.mutate(() => ({ collapsed: true })))

    const cached = client.getQueryData<WellnessRow>(qk.wellness(''))
    expect((cached?.prefs as { dock?: { collapsed?: boolean } })?.dock?.collapsed).toBe(true)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
