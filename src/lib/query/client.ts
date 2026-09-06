/**
 * The documented Next.js App Router singleton (node_modules/next/dist/docs/
 * 01-app/02-guides/client-side-data-fetching/tanstack-query.md): a fresh
 * `QueryClient` on every server render, so one request's cache can never leak
 * into another's SSR pass, and exactly one client reused for the lifetime of
 * the browser tab.
 */

import { QueryClient } from '@tanstack/react-query'

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A learner alt-tabbing back into an exercise must not trigger a
        // refetch storm on every focus — the 15s idle blur guard (LOCKDOWN)
        // already reacts to that gap; a background refetch here would race it.
        refetchOnWindowFocus: false,
        retry: 1,
        throwOnError: false,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient()
  browserQueryClient ??= makeQueryClient()
  return browserQueryClient
}
