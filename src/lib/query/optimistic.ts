/**
 * The one optimistic-mutation shape every BroGram mutation uses (spec 5.3):
 * apply the change to the cache before the network call resolves, restore the
 * exact prior snapshot if it fails, keep the applied value and invalidate
 * whatever else should refresh if it succeeds.
 *
 * `apply` and `mutate` never touch the query cache themselves — this factory
 * is the only place that calls `cancelQueries` / `getQueryData` /
 * `setQueryData`. It reaches for the browser singleton via `getQueryClient()`
 * rather than `useQueryClient()` so it stays a plain function, callable from
 * outside a component; in the browser this is the exact client every
 * `QueryProvider` and every `useQuery` hook already shares.
 *
 * Cancel-then-snapshot order matters when two mutations land on the same key
 * before either settles: `onMutate` awaits `cancelQueries` first, then reads
 * `getQueryData`, so the second mutation's rollback point is whatever the
 * first one already applied — not the value from before either ran.
 */

import type { UseMutationOptions } from '@tanstack/react-query'
import { getQueryClient } from './client'

export function optimistic<TData, TVars>(opts: {
  key: readonly unknown[]
  apply: (prev: TData | undefined, vars: TVars) => TData
  mutate: (vars: TVars) => Promise<unknown>
  onSettledInvalidate?: readonly (readonly unknown[])[]
}): UseMutationOptions<unknown, Error, TVars, { previous: TData | undefined }> {
  const { key, apply, mutate, onSettledInvalidate } = opts
  return {
    mutationFn: mutate,
    onMutate: async (vars) => {
      const client = getQueryClient()
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<TData>(key)
      client.setQueryData<TData>(key, (current) => apply(current, vars))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      getQueryClient().setQueryData(key, context?.previous)
    },
    onSettled: () => {
      if (!onSettledInvalidate?.length) return
      const client = getQueryClient()
      for (const invalidateKey of onSettledInvalidate) void client.invalidateQueries({ queryKey: invalidateKey })
    },
  }
}
