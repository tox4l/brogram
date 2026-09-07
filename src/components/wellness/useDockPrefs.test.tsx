import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { resetDockPrefsCacheForTests } from '@/lib/wellness/dock'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
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
    expect(localStorage.getItem('brogram:wellness:dock-cache:learner-one')).toContain('"placement":"left"')
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

  // N2 (fix round 2): a *relative* change (the collapse toggle) must resolve
  // against the cache at each call, not replay a closure 400ms later against
  // a separately re-read server row -- two rapid toggles used to send the
  // opposite of what the cache (and the screen) had already settled on.
  it('N2: two rapid relative toggles inside the debounce window send the final resolved value, not a replayed closure', async () => {
    db.row = { prefs: { dock: { collapsed: false } } }
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => useDockPrefsMutation('learner-one'), { wrapper: Wrapper })

    const toggle = () => result.current.mutate((current) => ({ collapsed: !current.dock.collapsed }))
    act(() => {
      toggle() // false -> true
      toggle() // true -> false (resolved against the cache's own update from the first call)
    })

    const cached = client.getQueryData<WellnessRow>(qk.wellness('learner-one'))
    expect(resolveWellnessPrefs(cached?.prefs).dock.collapsed).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    // The server receives the same final value the cache (and the screen)
    // settled on -- not a stale relative flip computed against the
    // still-unwritten server row (which would have sent `true`).
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(resolveWellnessPrefs(db.row?.prefs).dock.collapsed).toBe(false)
  })

  // N4 (fix round 2): a change made shortly before the component unmounts
  // (a route change, a tab close) must still reach the server -- otherwise
  // the stale server value wins on the next load and the change silently
  // reverts, even though `localStorage` (checked above) already has it.
  it('N4: flushes a pending debounced write on unmount instead of dropping it', async () => {
    const { Wrapper } = wrapper()
    const { result, unmount } = renderHook(() => useDockPrefsMutation('learner-one'), { wrapper: Wrapper })

    act(() => result.current.mutate(() => ({ placement: 'left' })))
    expect(mocks.update).not.toHaveBeenCalled()

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ prefs: expect.objectContaining({ dock: expect.objectContaining({ placement: 'left' }) }) }),
      'user_id',
      'learner-one',
    )
  })
})
