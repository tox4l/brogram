import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import type { LearnerState } from '@/lib/contracts'
import { useProfileMutation } from './profileMutation'

function baseState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'learner-1',
    profile: {
      displayName: 'Ada', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: 'grades', beyondCourses: false, depth: 'pass', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'INFS1101', path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0, integrityScore: 0, accountStatus: 'active', version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const db = vi.hoisted(() => ({ row: null as { state: LearnerState; version: number } | null }))
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), toast: vi.fn() }))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => { mocks.select(); return { data: db.row, error: null } },
        }),
      }),
      update: (payload: { state: LearnerState; version: number }) => ({
        eq: () => ({
          eq: (_column: string, expectedVersion: number) => ({
            select: () => ({
              maybeSingle: async () => {
                mocks.update(payload)
                if (!db.row || db.row.version !== expectedVersion) return { data: null, error: null }
                db.row = { state: payload.state, version: payload.version }
                return { data: { version: payload.version }, error: null }
              },
            }),
          }),
        }),
      }),
    }),
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  db.row = { state: baseState(), version: 1 }
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function wrapper() {
  const client = makeQueryClient()
  client.setQueryData(qk.learnerState('learner-1'), baseState())
  return { Wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>, client }
}

describe('useProfileMutation', () => {
  it('applies the change to the learner-state cache before the network call resolves', () => {
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => useProfileMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ tone: 'direct' })) })

    const cached = client.getQueryData<LearnerState>(qk.learnerState('learner-1'))
    expect(cached?.profile.tone).toBe('direct')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('debounces the write-through and persists a version-guarded update', async () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useProfileMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ verbosity: 'verbose' })) })
    expect(mocks.update).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const [payload] = mocks.update.mock.calls[0]
    expect(payload.state.profile.verbosity).toBe('verbose')
    expect(payload.version).toBe(2)
  })

  it('merges two different motivation fields touched within one debounce window', async () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useProfileMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate((current) => ({ motivation: { ...current.motivation, depth: 'master' } })) })
    act(() => { result.current.mutate((current) => ({ motivation: { ...current.motivation, beyondCourses: true } })) })

    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const [payload] = mocks.update.mock.calls[0]
    expect(payload.state.profile.motivation).toEqual({ why: 'grades', beyondCourses: true, depth: 'master', wantsAgenticCoding: false })
  })

  it('never reverts the cached value when the write-through rejects', async () => {
    mocks.select.mockImplementationOnce(() => { throw new Error('offline') })
    const { Wrapper, client } = wrapper()
    const { result } = renderHook(() => useProfileMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ tone: 'tough-love' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })

    const cached = client.getQueryData<LearnerState>(qk.learnerState('learner-1'))
    expect(cached?.profile.tone).toBe('tough-love')
  })

  it('toasts only after repeated consecutive failures, not the first', async () => {
    mocks.select.mockImplementation(() => { throw new Error('offline') })
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useProfileMutation('learner-1'), { wrapper: Wrapper })

    act(() => { result.current.mutate(() => ({ tone: 'playful' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.toast).not.toHaveBeenCalled()

    act(() => { result.current.mutate(() => ({ tone: 'direct' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
  })

  it('does nothing when signed out', () => {
    const { Wrapper } = wrapper()
    const { result } = renderHook(() => useProfileMutation(null), { wrapper: Wrapper })
    expect(() => act(() => { result.current.mutate(() => ({ tone: 'direct' })) })).not.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
