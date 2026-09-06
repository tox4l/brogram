import type { PropsWithChildren } from 'react'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compileLearnerState } from '@/lib/learner/compile'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { makeQueryClient } from './client'
import { qk } from './keys'
import { useAchievements, useActivityDays, useAttempts, useLearnerState, useLessonProgress, useWellness } from './hooks'

type Row = Record<string, unknown> | null

const spies = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), calls: {} as Record<string, number> }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: spies.from, rpc: spies.rpc }) }))

// M2: captures the exact `staleTime`/`gcTime` each hook passes to `useQuery`,
// so all six hooks are pinned against spec 5.2's table, not just the two
// (`useLearnerState`, `useWellness`) the behavioural tests below exercise.
// Delegates to the real implementation — this only observes, never replaces.
const captured = vi.hoisted(() => ({ options: {} as Record<string, { staleTime: unknown; gcTime: unknown }> }))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: (options: Parameters<typeof actual.useQuery>[0]) => {
      const key = Array.isArray(options.queryKey) ? String(options.queryKey[0]) : 'unknown'
      captured.options[key] = { staleTime: options.staleTime, gcTime: options.gcTime }
      return actual.useQuery(options)
    },
  }
})

function tableBuilder(row: Row) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
    then: (resolve: (result: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: row === null ? [] : [row], error: null }).then(resolve),
  }
  return builder
}

const learnerRow = { state: { ...compileLearnerState({ id: 'student' }, [], [], [], null) }, version: 1 }
const wellnessRow = { user_id: 'student', prefs: null, pomodoro_sessions: null, water_log: null, drill_results: [], updated_at: null }

beforeEach(() => {
  vi.clearAllMocks()
  spies.calls = {}
  captured.options = {}
  spies.from.mockImplementation((table: string) => {
    spies.calls[table] = (spies.calls[table] ?? 0) + 1
    if (table === 'learner_state') return tableBuilder(learnerRow)
    if (table === 'wellness') return tableBuilder(wellnessRow)
    return tableBuilder(null)
  })
  spies.rpc.mockResolvedValue({ data: [], error: null })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function wrapper(client: ReturnType<typeof makeQueryClient>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: { id: 'student' } as User, profile: null, learnerState: null }}>
          {children}
        </SessionProvider>
      </QueryClientProvider>
    )
  }
}

describe('query hooks caching (spec 5.2 stale times)', () => {
  it('does not fetch a seeded key on mount', () => {
    const client = makeQueryClient()
    const seed = { ...compileLearnerState({ id: 'student' }, [], [], [], null), userId: 'student' }
    client.setQueryData(qk.learnerState('student'), seed)

    const { result } = renderHook(() => useLearnerState(), { wrapper: wrapper(client) })

    expect(result.current.data).toEqual(seed)
    expect(spies.calls.learner_state).toBeUndefined()
  })

  it('never refetches an Infinity staleTime key on remount', async () => {
    const client = makeQueryClient()
    const first = renderHook(() => useWellness(), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    expect(spies.calls.wellness).toBe(1)
    first.unmount()

    const second = renderHook(() => useWellness(), { wrapper: wrapper(client) })
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(spies.calls.wellness).toBe(1)
  })

  it('refetches a 30_000 staleTime key once the clock passes it', async () => {
    const client = makeQueryClient()
    const first = renderHook(() => useLearnerState(), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    expect(spies.calls.learner_state).toBe(1)
    first.unmount()

    // Fake only `Date` — TanStack's staleness check reads `Date.now()`, but
    // `setTimeout` stays real so `waitFor`'s own polling still runs.
    const realNow = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(realNow + 30_001)

    const second = renderHook(() => useLearnerState(), { wrapper: wrapper(client) })
    await waitFor(() => expect(spies.calls.learner_state).toBe(2))
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
  })
})

describe('stale-time table (spec 5.2, all six hooks — M2)', () => {
  const cases: [key: string, run: () => unknown, staleTime: number, gcTime: number][] = [
    ['learner-state', () => useLearnerState(), 30_000, 300_000],
    ['attempts', () => useAttempts(), 30_000, 300_000],
    ['activity-days', () => useActivityDays(), Infinity, Infinity],
    ['wellness', () => useWellness(), Infinity, Infinity],
    ['lesson-progress', () => useLessonProgress(), Infinity, Infinity],
    ['achievements', () => useAchievements(), Infinity, Infinity],
  ]

  it.each(cases)('%s uses staleTime %s / gcTime %s', (key, run, staleTime, gcTime) => {
    renderHook(run, { wrapper: wrapper(makeQueryClient()) })
    expect(captured.options[key]).toEqual({ staleTime, gcTime })
  })
})
