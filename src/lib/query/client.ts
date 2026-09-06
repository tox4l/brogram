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
let lastSeededUserId: string | undefined

export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient()
  browserQueryClient ??= makeQueryClient()
  return browserQueryClient
}

/**
 * Clears the browser query client whenever the signed-in user changes, so a
 * future client-side sign-out/sign-in cannot leave the previous user's
 * `gcTime: Infinity` rows (wellness, lesson progress, achievements, activity
 * days) resident in the tab for whoever signs in next on the same machine —
 * there is no client-side sign-out today (`/auth/signout` is a full document
 * navigation that tears down the JS heap with it), but this task owns the
 * client's lifecycle, so the guard belongs here rather than in whichever
 * later task adds one. `QuerySeed` calls this on every render; it is a no-op
 * the first time any user is seen and on a repeat render of the same user.
 */
export function resetQueryClientForUser(userId: string): void {
  if (typeof window !== 'undefined' && lastSeededUserId !== undefined && lastSeededUserId !== userId) {
    getQueryClient().clear()
  }
  lastSeededUserId = userId
}

/** Test-only: forgets the tracked user and drops the browser singleton entirely. */
export function clearQueryClient(): void {
  browserQueryClient?.clear()
  browserQueryClient = undefined
  lastSeededUserId = undefined
}
