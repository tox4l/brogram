/**
 * The one optimistic-mutation shape every BroGram mutation uses (spec 5.3):
 * apply the change to the cache before the network call resolves, restore the
 * exact prior snapshot if it fails, and reconcile with the server on settle —
 * always invalidating the mutation's own key (so an optimistic value can
 * never become permanent cache truth on an `Infinity`-stale key) plus
 * whatever else the caller names.
 *
 * `apply` and `mutate` never touch the query cache themselves — `optimisticWith`
 * is the only place that calls `cancelQueries` / `getQueryData` / `setQueryData`
 * / `removeQueries` / `invalidateQueries`, and it always does so against the
 * exact `QueryClient` it was handed — never a client the caller cannot see.
 *
 * Two forms are exported for the two kinds of caller:
 * - `useOptimistic` binds to the `QueryClient` from React context, via
 *   `useQueryClient()` — the same client every component's own `useQuery`
 *   reads from, including a test's own `QueryClientProvider client={makeQueryClient()}`
 *   wrapper (see `hooks.test.tsx`). Components use this one.
 * - `optimistic` binds to the browser singleton (`getQueryClient()`), for a
 *   non-component caller. In production, with exactly one `QueryProvider` in
 *   the tree, the two resolve to the same client; only `useOptimistic` is
 *   guaranteed to see a test's independently-constructed one.
 *
 * Cancel-then-snapshot order matters when two mutations land on the same key
 * before either settles: `onMutate` awaits `cancelQueries` first, then reads
 * `getQueryData`, so the second mutation's rollback point is whatever the
 * first one already applied — not the value from before either ran.
 *
 * `onError`'s rollback calls `removeQueries` rather than
 * `setQueryData(key, undefined)` when there was no prior snapshot:
 * `QueryClient.setQueryData` is a documented no-op when the computed value is
 * `undefined` (it does not clear an existing entry), so writing `undefined`
 * back would silently leave the failed optimistic value in the cache forever
 * on an `Infinity`-`gcTime` key.
 */

import type { QueryClient, UseMutationOptions } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { getQueryClient } from './client'

export interface OptimisticOptions<TData, TVars> {
  key: readonly unknown[]
  apply: (prev: TData | undefined, vars: TVars) => TData
  mutate: (vars: TVars) => Promise<unknown>
  onSettledInvalidate?: readonly (readonly unknown[])[]
}

type OptimisticMutationOptions<TData, TVars> = UseMutationOptions<unknown, Error, TVars, { previous: TData | undefined }>

function optimisticWith<TData, TVars>(client: QueryClient, opts: OptimisticOptions<TData, TVars>): OptimisticMutationOptions<TData, TVars> {
  const { key, apply, mutate, onSettledInvalidate } = opts
  return {
    mutationFn: mutate,
    onMutate: async (vars) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<TData>(key)
      client.setQueryData<TData>(key, (current) => apply(current, vars))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      // `setQueryData(key, undefined)` is a documented no-op — it would leave
      // the just-applied optimistic value in place forever. An empty key
      // before the mutation means "not cached", so restore exactly that.
      if (context?.previous === undefined) client.removeQueries({ queryKey: key, exact: true })
      else client.setQueryData(key, context.previous)
    },
    onSettled: () => {
      const invalidate = [key, ...(onSettledInvalidate ?? [])]
      for (const invalidateKey of invalidate) void client.invalidateQueries({ queryKey: invalidateKey })
    },
  }
}

/** Component form: binds to the `QueryClient` from React context. */
export function useOptimistic<TData, TVars>(opts: OptimisticOptions<TData, TVars>): OptimisticMutationOptions<TData, TVars> {
  const client = useQueryClient()
  return optimisticWith(client, opts)
}

/** Non-component form: binds to the browser singleton. */
export function optimistic<TData, TVars>(opts: OptimisticOptions<TData, TVars>): OptimisticMutationOptions<TData, TVars> {
  return optimisticWith(getQueryClient(), opts)
}
