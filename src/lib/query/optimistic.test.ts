import { createElement, type PropsWithChildren } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, useMutation } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getQueryClient, makeQueryClient } from './client'
import { optimistic, useOptimistic } from './optimistic'

// `optimistic()` reaches for the browser QueryClient singleton (the same one
// every `QueryProvider` and every hook in hooks.ts shares) rather than taking
// one as a parameter, so tests share it too and reset its cache between runs.
const client = getQueryClient()

/** Deferred promise, so a test controls exactly when a mutation settles. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => { client.clear() })
afterEach(() => { client.clear() })

describe('optimistic', () => {
  it('applies the change before the network call resolves', async () => {
    const key = ['x'] as const
    client.setQueryData(key, 0)
    const pending = deferred<void>()
    const { result } = renderHook(() => useMutation(optimistic<number, number>({
      key,
      apply: (prev = 0, vars) => prev + vars,
      mutate: () => pending.promise,
    }), client))

    result.current.mutate(5)
    await waitFor(() => expect(client.getQueryData(key)).toBe(5))
    // The network call has not resolved yet — the applied value is purely local.
    expect(result.current.isPending).toBe(true)

    pending.resolve()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('restores the exact prior snapshot when the mutation rejects', async () => {
    const key = ['y'] as const
    client.setQueryData(key, { count: 3 })
    const pending = deferred<void>()
    const { result } = renderHook(() => useMutation(optimistic<{ count: number }, number>({
      key,
      apply: (prev, vars) => ({ count: (prev?.count ?? 0) + vars }),
      mutate: () => pending.promise,
    }), client))

    result.current.mutate(10)
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ count: 13 }))

    pending.reject(new Error('write failed'))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryData(key)).toEqual({ count: 3 })
  })

  it('removes the key entirely when rolling back a mutation that had no prior snapshot (C1)', async () => {
    // `setQueryData(key, undefined)` is a documented no-op in query-core — it
    // would leave the just-applied optimistic value in the cache forever on
    // an `Infinity`-gcTime key. An empty key before the mutation must come
    // back empty after a failed rollback, not "whatever was last applied".
    const key = ['unseeded'] as const
    expect(client.getQueryData(key)).toBeUndefined()
    const pending = deferred<void>()
    const { result } = renderHook(() => useMutation(optimistic<{ count: number }, number>({
      key,
      apply: (prev, vars) => ({ count: (prev?.count ?? 0) + vars }),
      mutate: () => pending.promise,
    }), client))

    result.current.mutate(10)
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ count: 10 }))

    pending.reject(new Error('write failed'))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(client.getQueryData(key)).toBeUndefined()
  })

  it('keeps the applied value and invalidates its own key plus the named keys once the mutation resolves (I2)', async () => {
    const key = ['z'] as const
    const other = ['other'] as const
    client.setQueryData(key, 1)
    client.setQueryData(other, 'stale')
    const invalidated: unknown[][] = []
    const originalInvalidate = client.invalidateQueries.bind(client)
    client.invalidateQueries = (async (filters: { queryKey?: unknown[] } | undefined) => {
      if (filters?.queryKey) invalidated.push(filters.queryKey)
      return originalInvalidate(filters)
    }) as typeof client.invalidateQueries

    const { result } = renderHook(() => useMutation(optimistic<number, number>({
      key,
      apply: (prev = 0, vars) => prev + vars,
      mutate: async () => 'ok',
      onSettledInvalidate: [other],
    }), client))

    result.current.mutate(9)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(client.getQueryData(key)).toBe(10)
    // The mutation's own key is always invalidated on settle — an optimistic
    // value must never become permanent truth on an Infinity-stale key just
    // because a caller forgot to list its own key in `onSettledInvalidate`.
    expect(invalidated).toContainEqual(key)
    expect(invalidated).toContainEqual(other)

    client.invalidateQueries = originalInvalidate
  })

  it('rolls back two sequential mutations on one key in cancel-then-snapshot order', async () => {
    // This pins the cancel-then-snapshot guarantee for two mutations that
    // overlap in time (B starts before A settles) but whose `onMutate`s do
    // not race each other (A's fully resolves before B's begins) — the
    // common case of two quick clicks. It does not prove behaviour under a
    // true same-tick race, where both `onMutate`s could snapshot before
    // either applies; that is a known limit of the documented pattern.
    const key = ['sequential'] as const
    client.setQueryData(key, 0)
    const first = deferred<void>()
    const second = deferred<void>()
    const options = (mutate: () => Promise<void>) => optimistic<number, number>({
      key,
      apply: (prev = 0, vars) => prev + vars,
      mutate,
    })

    const a = renderHook(() => useMutation(options(() => first.promise), client))
    const b = renderHook(() => useMutation(options(() => second.promise), client))

    // Start A, let its onMutate (cancel, then snapshot 0, then apply) finish
    // before B starts — this is the ordering the name describes.
    a.result.current.mutate(1)
    await waitFor(() => expect(client.getQueryData(key)).toBe(1))

    // B's onMutate now cancels, then snapshots whatever is in the cache —
    // A's already-applied 1, not the original 0 — then applies on top of it.
    b.result.current.mutate(10)
    await waitFor(() => expect(client.getQueryData(key)).toBe(11))

    // B fails: it must roll back to what it actually snapshotted (A's 1),
    // never all the way back to the pre-A value.
    second.reject(new Error('b failed'))
    await waitFor(() => expect(b.result.current.isError).toBe(true))
    expect(client.getQueryData(key)).toBe(1)

    // A then succeeds; nothing about its own resolution touches the cache further.
    first.resolve()
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    expect(client.getQueryData(key)).toBe(1)
  })
})

describe('useOptimistic', () => {
  it('binds to the QueryClient from React context, not the browser singleton (I1)', async () => {
    // This is the shape every real component actually uses: `useMutation` is
    // never handed a client argument, exactly like `hooks.test.tsx`'s own
    // `QueryClientProvider client={makeQueryClient()}` wrapper. If this bound
    // to the module singleton instead, the optimistic value would apply to a
    // client nobody's `useQuery` is reading from.
    const contextClient = makeQueryClient()
    const key = ['context-bound'] as const
    contextClient.setQueryData(key, 0)
    const pending = deferred<void>()
    function wrapper({ children }: PropsWithChildren) {
      return createElement(QueryClientProvider, { client: contextClient }, children)
    }

    const { result } = renderHook(() => useMutation(useOptimistic<number, number>({
      key,
      apply: (prev = 0, vars) => prev + vars,
      mutate: () => pending.promise,
    })), { wrapper })

    result.current.mutate(5)
    await waitFor(() => expect(contextClient.getQueryData(key)).toBe(5))
    // The browser singleton (this file's shared `client`) was never touched.
    expect(client.getQueryData(key)).toBeUndefined()

    pending.resolve()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})
