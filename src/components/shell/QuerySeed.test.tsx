import { render, screen } from '@testing-library/react'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { compileLearnerState } from '@/lib/learner/compile'
import { clearQueryClient, getQueryClient, makeQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
import { QuerySeed } from './QuerySeed'

const learnerState = { ...compileLearnerState({ id: 'student' }, [], [], [], null), userId: 'student' }

/** Reads the seeded key with a queryFn that fails the test if it ever runs. */
function Probe({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: qk.learnerState(userId),
    queryFn: () => { throw new Error('must not fetch: the key was already seeded') },
    staleTime: Infinity,
  })
  return <div data-testid="probe">{query.data ? 'seeded' : 'empty'}</div>
}

describe('QuerySeed', () => {
  it('makes seeded data readable in the same render pass, not one tick later', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <QuerySeed userId="student" learnerState={learnerState} />
        <Probe userId="student" />
      </QueryClientProvider>,
    )
    // No `waitFor`, no `act(async ...)` — if this were seeded from a `useEffect`
    // instead of `useState`'s lazy initializer, this synchronous read would
    // still see "empty" because the effect has not run yet.
    expect(screen.getByTestId('probe').textContent).toBe('seeded')
    expect(client.getQueryData(qk.learnerState('student'))).toEqual(learnerState)
  })

  it('only seeds the keys it was actually given data for', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <QuerySeed userId="student" learnerState={learnerState} />
      </QueryClientProvider>,
    )
    expect(client.getQueryData(qk.attempts('student'))).toBeUndefined()
    expect(client.getQueryData(qk.wellness('student'))).toBeUndefined()
    expect(client.getQueryData(qk.lessonProgress('student'))).toBeUndefined()
    expect(client.getQueryData(qk.achievements('student'))).toBeUndefined()
    expect(client.getQueryData(qk.activityDays('student'))).toBeUndefined()
  })

  it('seeds every row it is given', () => {
    const client = makeQueryClient()
    const attempts = [{ id: 'a1', userId: 'student', exerciseId: 'e1', code: '', results: [], passed: true, durationMs: 10, hintCount: 0, createdAt: '2026-09-06T00:00:00.000Z' }]
    const wellness = { user_id: 'student', drill_results: [] }
    const lessonProgress = [{ userId: 'student', lessonId: 'c1', cloId: 'c1', status: 'started' as const, blockIndex: 0, checksPassed: 0, checksFailed: 0, lessonVersion: 1, startedAt: '2026-09-06T00:00:00.000Z', completedAt: null, updatedAt: '2026-09-06T00:00:00.000Z' }]
    const achievements = [{ userId: 'student', achievementId: 'first-blood', unlockedAt: '2026-09-06T00:00:00.000Z' }]
    const activityDays = [{ kind: 'exercise' as const, day: '2026-09-06' }]
    render(
      <QueryClientProvider client={client}>
        <QuerySeed
          userId="student"
          attempts={attempts}
          wellness={wellness}
          lessonProgress={lessonProgress}
          achievements={achievements}
          activityDays={activityDays}
        />
      </QueryClientProvider>,
    )
    expect(client.getQueryData(qk.attempts('student'))).toEqual(attempts)
    expect(client.getQueryData(qk.wellness('student'))).toEqual(wellness)
    expect(client.getQueryData(qk.lessonProgress('student'))).toEqual(lessonProgress)
    expect(client.getQueryData(qk.achievements('student'))).toEqual(achievements)
    expect(client.getQueryData(qk.activityDays('student'))).toEqual(activityDays)
  })

  it('re-seeds when the same user gets a fresh payload reference (I3)', () => {
    const client = makeQueryClient()
    const first = { ...learnerState }
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <QuerySeed userId="student" learnerState={first} />
      </QueryClientProvider>,
    )
    expect(client.getQueryData(qk.learnerState('student'))).toBe(first)

    // A fresh server render always produces a new object, even when nothing
    // meaningful changed — this is exactly the reference `QuerySeed` compares
    // (`!==`), never a deep walk. (The cache itself then applies TanStack's
    // own structural sharing, so the stored value is content-equal to
    // `second` rather than the exact same reference — `toEqual`, not `toBe`.)
    const second = { ...learnerState, points: 999 }
    rerender(
      <QueryClientProvider client={client}>
        <QuerySeed userId="student" learnerState={second} />
      </QueryClientProvider>,
    )
    expect(client.getQueryData(qk.learnerState('student'))).toEqual(second)
  })

  it('does not call setQueryData again when re-rendered with the same prop reference', () => {
    const client = makeQueryClient()
    const setQueryDataSpy = vi.spyOn(client, 'setQueryData')
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <QuerySeed userId="student" learnerState={learnerState} />
      </QueryClientProvider>,
    )
    expect(setQueryDataSpy).toHaveBeenCalledTimes(1)

    rerender(
      <QueryClientProvider client={client}>
        <QuerySeed userId="student" learnerState={learnerState} />
      </QueryClientProvider>,
    )
    expect(setQueryDataSpy).toHaveBeenCalledTimes(1)
  })

  it('clears the previous user’s cache and reseeds when the user id changes (I4 integration)', () => {
    // `resetQueryClientForUser` clears the browser singleton, so this test
    // deliberately wires QuerySeed to that singleton (exactly how
    // `QueryProvider` + `(app)/layout.tsx` do it in production) rather than
    // the isolated `makeQueryClient()` the other tests in this file use.
    clearQueryClient()
    const client = getQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <QuerySeed userId="user-a" learnerState={{ ...learnerState, userId: 'user-a' }} />
      </QueryClientProvider>,
    )
    client.setQueryData(['side-channel', 'user-a'], 'leftover')
    expect(client.getQueryData(qk.learnerState('user-a'))).toBeDefined()

    const learnerStateB = { ...learnerState, userId: 'user-b' }
    rerender(
      <QueryClientProvider client={client}>
        <QuerySeed userId="user-b" learnerState={learnerStateB} />
      </QueryClientProvider>,
    )

    expect(client.getQueryData(['side-channel', 'user-a'])).toBeUndefined()
    expect(client.getQueryData(qk.learnerState('user-a'))).toBeUndefined()
    expect(client.getQueryData(qk.learnerState('user-b'))).toEqual(learnerStateB)
    clearQueryClient()
  })
})
