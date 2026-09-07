'use client'

/**
 * Fix round 3 (W2FIX-F3, cross-lane finding surfaced by W2FIX-A round 2's
 * "Cross-lane visibility" note): both de-rot runners build the
 * `RewardContext` they hand to `recordGoalDay`/`recordAchievements` at save
 * time from a bare `getQueryClient().getQueryData(qk.attempts(userId))` read
 * -- with no observer anywhere under `src/app/(app)/derot`. `(app)/layout.tsx`'s
 * `QuerySeed` seeds that row once, server-side, on every (app) route, but
 * TanStack's default `gcTime` for a browser client (five minutes) deletes an
 * *unobserved* query five minutes after its last observer detaches,
 * regardless of `staleTime`. An ordinary de-rot session (a 60-90s Playground
 * game, a multi-minute Arcade run) easily outlasts five idle minutes once
 * whatever observer originally seeded the row elsewhere (the dashboard, a
 * lesson) has itself unmounted -- at which point the save-time
 * `getQueryData` call silently returns `undefined`, and a mixed day (a
 * walkthrough or exercise pass earlier today, a de-rot run as the day's last
 * action) undercounts `winsToday` and permanently loses that UTC day's goal.
 *
 * Same mechanism as `LessonView.tsx`'s own inert `useQuery` observer (T2.9a
 * report, findings R1/F6-5): `enabled: false` registers a real TanStack
 * observer without ever calling `queryFn` (never a network request -- the
 * de-rot route's own zero-extra-request budget for this window, spec 5.6,
 * is unaffected), and TanStack clears a query's pending gc timeout the
 * moment any observer attaches. Built on the imperative `QueryObserver`
 * (what `useQuery` itself constructs internally) rather than `useQuery`
 * directly, and bound explicitly to `getQueryClient()` -- the same
 * module-level singleton both `arcade/[kind]/page.tsx` and
 * `play/[game]/page.tsx` already read/write through for `invalidateQueries`/
 * `getQueryData` -- rather than resolving a client through React context
 * (`useQueryClient()`), since neither de-rot route mounts its own
 * `QueryClientProvider` (that happens once, at `(app)/layout.tsx`); a
 * harness that renders either page directly without that ambient provider
 * (e.g. `src/lib/agents/no-agent-surfaces.test.tsx`) would otherwise throw
 * "No QueryClient set". `gcTime: Infinity` on this observer's own options
 * keeps the residency guarantee for as long as either de-rot screen (Arcade
 * or Playground) stays mounted -- shared here rather than duplicated in both
 * route files, which both need the identical mechanism.
 */
import { useEffect } from 'react'
import { QueryObserver } from '@tanstack/react-query'
import type { Attempt } from '@/lib/contracts'
import { getQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'

export function useKeepAttemptsResident(userId: string | null): void {
  useEffect(() => {
    const client = getQueryClient()
    const observer = new QueryObserver<Attempt[]>(client, {
      queryKey: qk.attempts(userId ?? ''),
      queryFn: () => Promise.resolve([]),
      enabled: false,
      staleTime: Infinity,
      gcTime: Infinity,
    })
    // A no-op listener: `subscribe` is what registers this observer on the
    // query (clearing its pending gc timeout) -- this hook has no render
    // output of its own to update.
    const unsubscribe = observer.subscribe(() => {})
    return () => {
      unsubscribe()
      observer.destroy()
    }
  }, [userId])
}
