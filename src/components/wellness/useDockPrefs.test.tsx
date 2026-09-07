import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { resetDockPrefsCacheForTests } from '@/lib/wellness/dock'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { resetWellnessPrefsWriterForTests, useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'
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
  resetWellnessPrefsWriterForTests()
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

  // C1, fix round 1 (Opus review of b509b0e): the dock widget (this hook)
  // and the Account page's own sound/motion/goal controls
  // (`useWellnessPrefsMutation`) used to keep entirely independent debounce
  // timers over the same `wellness.prefs` blob -- a dock change could
  // silently drop an unflushed sound change, and vice versa. Both now
  // delegate to the same module-level writer, so a change on either "hook"
  // shares one queue.
  it('C1 (fix round 1): a dock change and a sound change made moments apart share one write, and both survive', async () => {
    db.row = {
      prefs: {
        sound: { enabled: true, volume: 0.6, interface: false },
        dock: { placement: 'right', collapsed: false, compactOnExercise: true, corner: 'br' },
      },
    }
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => ({
      dock: useDockPrefsMutation('learner-one'),
      prefs: useWellnessPrefsMutation('learner-one'),
    }), { wrapper: Wrapper })

    act(() => { result.current.dock.mutate(() => ({ placement: 'left' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    act(() => { result.current.prefs.mutate((current) => ({ sound: { ...current.sound, enabled: false } })) })

    // The second mutate() re-arms the *same* shared timer -- nothing has
    // reached the network yet at what would have been the dock-only deadline.
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(mocks.update).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const written = mocks.update.mock.calls[0][1] as { prefs: { dock?: Record<string, unknown>; sound?: Record<string, unknown> } }
    expect(written.prefs.dock).toEqual(expect.objectContaining({ placement: 'left' }))
    expect(written.prefs.sound).toEqual(expect.objectContaining({ enabled: false }))

    // No flip-back: the cache reflects both changes, not just the last one
    // written and not a stale server snapshot from either hook alone.
    const cached = resolveWellnessPrefs(client.getQueryData<WellnessRow>(qk.wellness('learner-one'))?.prefs)
    expect(cached.dock.placement).toBe('left')
    expect(cached.sound.enabled).toBe(false)
  })

  it('C1 (fix round 1): cancels any in-flight fetch for this key before applying a new optimistic write', () => {
    const { Wrapper, client } = wrapper()
    const cancelSpy = vi.spyOn(client, 'cancelQueries')
    const { result } = renderHook(() => useDockPrefsMutation('learner-one'), { wrapper: Wrapper })

    act(() => result.current.mutate(() => ({ placement: 'top' })))

    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: qk.wellness('learner-one') })
  })
})
