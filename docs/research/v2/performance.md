# BroGram performance and data-layer research (v2)

Date: 2026-09-06. Scope: how to make BroGram feel fast and optimistic on Next.js 16 App Router + Vercel + Supabase, in response to the product owner's verdict ("too sluggish, no optimistic UI or caching... every course switch re-runs the onboarding profiler and finding the next question takes a long time").

Method: every Next.js claim below was checked against the docs bundled inside this repo's own `node_modules/next/dist/docs/`, which is the exact version shipped (`next@16.3.4`) — not generic web content that might describe a different major version. Where a public URL exists for the same page it is given as the citation; the local path is also noted so this is reproducible from a clean checkout. Library versions were checked against the npm registry on 2026-09-06. Every other claim is grounded in a direct reading of BroGram's own source, cited by file and line.

---

## Contents

1. [TL;DR](#tldr)
2. [Current-state audit](#current-state-audit-what-is-actually-making-brogram-feel-slow)
3. [TanStack Query v5 in the App Router](#1-tanstack-query-v5-in-the-app-router)
4. [Next.js 16 caching primitives](#2-nextjs-16-caching-primitives)
5. [Seed curriculum as static JSON](#3-seed-curriculum-as-static-json-instead-of-database-reads)
6. [Supabase query patterns that avoid waterfalls](#4-supabase-client-side-query-patterns-that-avoid-waterfalls)
7. [Code-splitting heavy client libraries](#5-code-splitting-heavy-client-libraries)
8. [Web Worker / Pyodide warmup timing](#6-web-worker-warmup-timing)
9. [Measuring: Lighthouse, Speed Insights, web-vitals](#7-measuring-lighthouse-speed-insights-web-vitals)
10. [BroGram data-layer architecture](#8-brogram-data-layer-architecture)
11. [Performance budget](#9-performance-budget)
12. [Phased rollout](#10-phased-rollout)
13. [Sources](#sources)

---

## TL;DR

- BroGram has **zero client-side data-caching today**. Every screen (`dashboard`, `onboarding`, `useExerciseLoop`) hand-rolls its own `useEffect` + `useState` fetch/loading/error trio against `supabase-js`, with no shared cache, no request de-duplication, and no optimistic writes. This is the direct, literal cause of "no optimistic UI or caching."
- The curriculum (courses, CLOs, patterns, exercises, drills) is **already static seed data** (`seed/*.json`, loaded into Supabase once at build/deploy time by `C3b`). BroGram re-reads it from Supabase over the network on every dashboard load, every course switch, and every exercise open, when it could ship as static JSON and cost zero round trips.
- "Every course switch re-runs the onboarding profiler" is a **real bug**, not a caching illusion: `src/app/(app)/onboarding/page.tsx:47` initializes `stage` to `'question'` unconditionally. Dashboard's "Change course" link (`src/app/(app)/dashboard/page.tsx`) routes there directly, so an already-onboarded learner is dropped back into the Profiler's phase-1 questions before ever seeing the course grid.
- The single biggest perceived-latency cost in the app is in `submit()` (`src/hooks/useExerciseLoop.ts:365-385`, `:267-341`): the browser already knows pass/fail the instant local grading finishes (`getRuntime(...).run(request)`), but the UI keeps showing "Checking…" through an attempt insert, a Reviewer/Diagnoser agent call, a `learner_state` read-modify-write, a `mastery` upsert, and (on a chain close or bank miss) a Planner or Author agent call — all sequential. That is the app's core loop, run more than any other action; this is where optimistic UI matters most.
- Zero routes have a `loading.tsx`. Per Next.js's own prefetching model, a dynamic route **without** `loading.js` is not prefetched by `<Link>` at all — so BroGram gets none of Next 16's automatic prefetching on any of its (fully dynamic) routes today. Adding `loading.tsx` to every route in `src/app/(app)/` is close to a free win.
- Recommended shape: keep the existing Zustand `SessionProvider` for the SSR-seeded snapshot (it already works and is low-risk to touch during launch week); add **TanStack Query v5** as a second layer for curriculum reads (until static JSON replaces them), wellness prefs, and all new mutations, using `onMutate`/`onError` optimistic pairs that key off the `LearnerState.version` field BroGram *already* carries for exactly this purpose. Do **not** rewrite `useExerciseLoop`'s state machine pre-launch — it has real, tested correctness properties (cross-tab version conflicts, idempotent upserts, hint refunds) that are not worth risking this week. Apply one surgical fix instead (see [§8](#8-brogram-data-layer-architecture)).
- Next.js 16's caching model changed shape since most training data: **Cache Components** (`cacheComponents: true` in `next.config.ts`) now unifies what used to be `experimental.ppr` / `experimental.dynamicIO` / `experimental.useCache` into one flag, `use cache` is stable, and Partial Prerendering is its default behavior. BroGram is not using it yet (`next.config.ts` is empty). It is a good fit for BroGram's rendering shape but is a real migration (every dynamic read needs a `<Suspense>` boundary) — recommended as a **post-launch** phase, not this week.

---

## Current-state audit: what is actually making BroGram feel slow

This section is what I found reading the actual code, not a general Next.js essay. It is the evidence base for every recommendation that follows.

### A. No shared client cache anywhere

- `src/store/session.ts` is a bare Zustand store: `{ user, profile, learnerState, setLearnerState }`. `setLearnerState` is a full-object replace. There is no per-slice cache, no query keys, no retry policy, no dedup.
- `src/app/(app)/dashboard/page.tsx` defines its own `useCurriculum()` hook (lines ~34-73): a `useEffect` that calls three `supabase-js` selects in a `Promise.all`, tracked with hand-rolled `attempt`/`result` state and a `retry()` callback. This pattern is duplicated with variations in `src/app/(app)/onboarding/page.tsx` (`loadCourses`, `chooseCourse`) and `src/hooks/useExerciseLoop.ts`.
- Net effect: nothing is cached across navigations. Go to `/dashboard`, then `/derot`, then back to `/dashboard` — the three curriculum queries re-run from zero every time, with a visible "Opening your course" loading state each time, because there is no library keeping that response warm.

### B. The curriculum round trip that doesn't need to exist

`useCurriculum()` fetches, on **every** dashboard mount:
```
courses.select('code,title,language').eq('code', courseCode).maybeSingle()
clos.select('id,ordinal,outcome,draft').eq('course', courseCode).order('ordinal')
exercises_public.select('id,title,difficulty,language,clo_id').eq('verified', true).in('id', ids)
```
All three tables are populated exclusively from `seed/courses.json`, `seed/clos.json`, and `seed/exercises/*.json` (build log: "C3b Load the seed to Supabase — patterns 42, courses 6, clos 26, exercises 95, drills 144"). This content only changes when someone edits a seed file and re-runs `scripts/seed-load.mjs`. There is no reason a learner's browser should ever hit Supabase for it. See [§3](#3-seed-curriculum-as-static-json-instead-of-database-reads).

### C. The onboarding "course switch replays the profiler" bug

`src/app/(app)/onboarding/page.tsx:47`:
```ts
const [stage, setStage] = useState<Stage>('question')
```
This is unconditional. `onboardingComplete` is only ever consulted at **login** to route between `/onboarding` and `/dashboard` (`src/app/(auth)/login/page.tsx:37-38`, `src/app/auth/confirm/route.ts:20`) — never inside the onboarding page itself. Dashboard's "Change course" control is a plain link to the same route (`src/app/(app)/dashboard/page.tsx`: `<Link href="/onboarding">`). So an already-onboarded learner who clicks "Change course" lands on `stage === 'question'` and has to click through the Profiler's phase-1/phase-2 cards (up to `MAX_QUESTIONS = 13`) again before ever reaching the course grid. This is the literal mechanism behind "every course switch re-runs the onboarding profiler" — a state-initialization bug, not a caching gap, and worth fixing before any of the caching work because it is small, safe, and the single biggest UX complaint on this flow.

### D. "Finding the next question takes a long time" — the real waterfall

`chooseCourse()` in the same file, once a course is picked:
1. `clos.select('*').eq('course', course.code).order('ordinal')` — 1 round trip
2. `fetchCandidates()` **once per CLO**, for the first 3 CLOs, in `Promise.all` — 1 round trip (parallel)
3. `callAgent({ agent: 'planner', trigger: 'plan-refresh', ... })` — 1 DeepSeek round trip (irreducible; this is the actual "finding the next question")
4. `writeLearnerState()` — 1-3 round trips (read-modify-write with retry)

Steps 1, 2, and 4's *reads* are all static or semi-static content (CLOs and candidate exercises are seed data; only the `learner_state` write in step 4 is genuinely dynamic). Once curriculum is static JSON, steps 1-2 disappear entirely, and the "long time" the owner is feeling shrinks to what it should always have been: the single, real, and expected Planner LLM call.

### E. `useExerciseLoop`'s per-exercise fetch waterfall

`src/hooks/useExerciseLoop.ts:113-126`, on every exercise page mount:
1. `exercises_public.select('*').eq('id', exerciseId).eq('verified', true).maybeSingle()`
2. *(depends on 1's `clo_id`)* in parallel: `clos.select('*').eq('id', item.cloId).maybeSingle()` **and** `attempts.select(...).eq('user_id', userId).order('created_at', desc)` — **the full, unbounded lifetime attempt history, on every single exercise open**
3. *(depends on 2's `outcome.course`)* `courses.select('packages').eq('code', outcome.course).maybeSingle()`

That is a three-deep waterfall for content that is 2/3 static (exercise, CLO, course packages) and one genuinely unbounded per-user read (`attempts`) that has no `.limit()` anywhere in this call. A learner who has done 2,000 attempts downloads all 2,000 rows' `created_at`/`id`/`passed`/`hint_count` before they can start their next exercise. See [§4](#4-supabase-client-side-query-patterns-that-avoid-waterfalls) and [§8](#8-brogram-data-layer-architecture) for the fix.

### F. `submit()` hides an already-known answer behind a long tail of network+LLM calls

This is the app's core, most-executed action, and it is the biggest single perceived-latency issue in BroGram. Reading `submit()` and `finishSubmission()` (`src/hooks/useExerciseLoop.ts:365-341`) in order:

1. `getRuntime(request.language).run(request)` — **local, in-browser** grading. `passed` is known the moment this resolves (line 380).
2. `attempts.upsert(...)` — 1 round trip.
3. If passed: `callAgent({ agent: 'reviewer', ... })` (a full, non-streaming DeepSeek call, budgeted up to 8,000 prompt tokens) — awaited in full before anything else happens. If failed: `streamAgent({ agent: 'diagnoser', ... })`, streamed but still gates the next step.
4. `saveState()` — a `learner_state` read-modify-write loop with up to 3 retries on version conflict.
5. A `mastery` table upsert **and** a conditional update (2 more round trips).
6. If the CLO just closed: `queueNext()` fetches all CLOs for the course, fetches a bank per CLO, and calls the **Planner** agent. If the CLO is still open: `queueNext()` fetches a bank and, on a bank miss, calls the **Author** agent and a verify route.
7. Only now: `setStatus('passed')` (line 330) or `setStatus('failed')` (line 337).

The Submit button reads "Checking…" (`src/app/(app)/exercise/[id]/page.tsx:66`) for the entire span of steps 2-6, even though the answer to "did I pass" was available after step 1. On a slow DeepSeek response plus several sequential Supabase round trips from Doha to the project's `ap-south-1` pooler, this can easily be several seconds of "Checking…" for a result the browser already had. This is worth fixing surgically without touching the careful correctness logic around it — see [§8](#8-brogram-data-layer-architecture).

Note: this code is *not* sloppy — the version-conflict retry loop, idempotent upserts (`ignoreDuplicates: true`), cross-tab guards, and hint-refund-only-if-no-partial-frame logic are genuinely careful engineering. The fix here is sequencing what the UI reveals, not rewriting the correctness machinery.

### G. Runtime warmup is reactive, never proactive

`getRuntime(language).warmup()` (`src/lib/runtimes/index.ts`) is only ever called from inside `useExerciseLoop`'s data-fetch effect (`src/hooks/useExerciseLoop.ts:141`), and only *after* the three-wave fetch in item E above fully resolves. The dashboard already knows the language of all three "next exercises" (`ExerciseDetails.language`, `src/app/(app)/dashboard/page.tsx`) but never uses that to start warming up Pyodide/the JS worker/sql.js ahead of a click. Runtime singletons are cached per language for the app's lifetime (`runtimes` Map in `src/lib/runtimes/index.ts`), so a warmup started early is never wasted — it just needs to start earlier. See [§6](#6-web-worker-warmup-timing).

### H. Zero `loading.tsx` files, incidental `<Suspense>` only

`find src/app -iname loading.tsx` returns nothing. The only `<Suspense>` usage in the app is in `derot/page.tsx`, `derot/[kind]/page.tsx`, and `login/page.tsx` (almost certainly the mandatory boundary around `useSearchParams()`, not a data-streaming boundary). Every loading state in the app is therefore a client-rendered spinner that only appears after the page's own JS has mounted and its `useEffect` has fired — never part of the server-rendered shell. This also has a direct, mechanical prefetching cost, covered next.

### I. Already correct — no action needed

To be precise about what is *not* a finding: `src/proxy.ts` is already correctly named for Next 16 (not `middleware.ts`); `package.json`'s `dev`/`build` scripts are already the plain `next dev`/`next build` form Next 16 wants (Turbopack is on by default, no `--turbopack` flag needed); `lint` already calls `eslint` directly, not the removed `next lint`; `src/components/report/pdf.ts` already dynamically imports `jspdf` and `html2canvas-pro` with a documented rationale in its own comment; Pyodide, the JS engine, SQL, and Mongo runtimes already run inside dedicated Web Workers (`*.worker.ts`), which is the right isolation boundary. These are worth confirming so the rest of this document reads as an honest diff, not a rewrite-everything pitch.

---

## 1. TanStack Query v5 in the App Router

**Version verified against npm (2026-09-06): `@tanstack/react-query@5.102.8`.** BroGram has no `@tanstack/*` package installed today (confirmed by grep).

Next.js's own guide (`node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/tanstack-query.md`, mirrored at nextjs.org/docs/app/guides/client-side-data-fetching/tanstack-query) is the canonical pattern for Next 16 and is what the recommendations below follow.

### Provider setup

One `QueryClient` per server render, one reused singleton in the browser — this is the documented pattern, verbatim:

```tsx
// src/components/shell/QueryProvider.tsx
'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

let browserQueryClient: QueryClient | undefined
function getQueryClient() {
  if (typeof window === 'undefined') return new QueryClient()
  browserQueryClient ??= new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
  })
  return browserQueryClient
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>
}
```

Mount it in `src/app/(app)/layout.tsx`, wrapping the existing `<SessionProvider>` — the two are complementary, not competing (see [§8](#8-brogram-data-layer-architecture) for the division of responsibility).

### SSR hydration: `dehydrate` / `HydrationBoundary` vs. the simpler path

The full `dehydrate(queryClient)` → `<HydrationBoundary state={...}>` pattern the Next.js guide shows is designed for **fetch-based** data loading, ideally paired with Cache Components (`'use cache'`) so the dehydrated state itself can be cached and prefetched. BroGram's `(app)/layout.tsx` does not fetch via `fetch()` — it calls `serverClient()` (Supabase server client) directly and assembles `LearnerState` server-side already. For this shape, the lighter documented alternative — "provide initial data from a Server Component" via a plain prop, then call `queryClient.setQueryData(key, initialData)` once on mount in a client component — is the right fit today; reach for full `dehydrate`/`HydrationBoundary` when curriculum data is later served through cached Server Components (post Cache Components adoption, [§10](#10-phased-rollout)).

### `staleTime` strategy

TanStack Query v5's documented defaults (tanstack.com/query/v5/docs/framework/react/guides/important-defaults): **`staleTime` defaults to `0`** (every mount/refocus refetches in the background) and **`gcTime` defaults to 5 minutes** (`1000 * 60 * 5`) for how long an unused cache entry survives before eviction. The guide's own warning applies directly to BroGram's dashboard: leaving `staleTime: 0` on a screen visited every session "hammers your API on every tab focus or mount." Recommended per-domain values for BroGram:

| Query key | Recommended `staleTime` | Why |
|---|---|---|
| `['curriculum', courseCode]` (if still Supabase-backed during transition) | `Infinity` | Content only changes on redeploy; invalidate manually, never by time. |
| `['learner-state', userId]` | `30_000` (30s) | Matches the minimum client-cache stale time Next.js itself enforces for its own router cache — a natural, well-precedented number. Correctness is still enforced by the `version` write-guard regardless of staleness. |
| `['wellness-prefs', userId]` | `Infinity` | Rarely changes; always written optimistically, invalidated only on mutation. |
| Agent replies (profiler/planner/author/diagnoser/coach/reviewer/buddy) | N/A — **never `useQuery`** | Each call is a unique, side-effecting LLM invocation, not idempotent cacheable data. Model these as `useMutation` only. |

Keep `gcTime >= staleTime` for every entry (the documented rule) so a still-fresh cache never gets garbage-collected out from under a component that briefly unmounts (e.g., navigating dashboard → exercise → dashboard).

### Optimistic updates: `onMutate` / rollback

The documented shape (same guide, "Coordinate server and client caches after mutations"):

```tsx
const queryClient = useQueryClient()
const mutation = useMutation({
  mutationFn: saveWellnessPrefs,
  onMutate: async (nextPrefs) => {
    await queryClient.cancelQueries({ queryKey: ['wellness-prefs', userId] })
    const previous = queryClient.getQueryData(['wellness-prefs', userId])
    queryClient.setQueryData(['wellness-prefs', userId], nextPrefs) // instant UI
    return { previous }
  },
  onError: (_err, _vars, context) => {
    queryClient.setQueryData(['wellness-prefs', userId], context?.previous) // rollback
  },
})
```

This pairs naturally with a fact already true of BroGram's schema: `LearnerState.version` (`src/lib/contracts.ts`) is documented as "Increment on every write. Agents receive it and echo it so stale deltas are rejected" — i.e., BroGram's backend was *already designed* for optimistic-then-reconcile. `onMutate`/`onError` is the client-side half that pattern has been missing.

### Query invalidation

Use `queryClient.invalidateQueries({ queryKey: [...] })` after a mutation settles when the server is the ultimate source of truth and a background refetch is cheap (e.g., after `attempt-passed` re-validate `['learner-state', userId]` once `finishSubmission` completes, even though the UI already updated optimistically). Prefer targeted keys over `invalidateQueries()` with no key (which invalidates everything).

### `supabase-cache-helpers` (optional accelerant, not required)

`@supabase-cache-helpers/postgrest-react-query` (verified on npm: **`1.13.9`**) auto-generates TanStack Query hooks and keys directly from `postgrest-js` query builders, removing the boilerplate of hand-writing `queryKey`/`queryFn` pairs for straight Supabase reads. It is a reasonable option for the plain curriculum/attempts reads if the team wants less hand-written glue, but it does not give the version-aware optimistic-concurrency pattern `learner_state` needs — write that mutation by hand regardless.

---

## 2. Next.js 16 caching primitives

This is the area most likely to diverge from prior knowledge — Next 16 reshaped this significantly, and this section was verified line-by-line against the bundled docs (`node_modules/next/dist/docs/01-app/{01-getting-started,02-guides,03-api-reference}/...`), not memory.

### The headline change: Cache Components

Next.js 15's `experimental.ppr`, `experimental.dynamicIO`, and `experimental.useCache` flags no longer exist. As of **16.0.0** they are unified into one top-level flag:

```ts
// next.config.ts
const nextConfig: NextConfig = { cacheComponents: true }
```

With it enabled: `'use cache'` is a stable directive (no `unstable_` prefix — that was removed in 16), Partial Prerendering becomes the **default rendering behavior** (not an opt-in per-route flag anymore — `experimental_ppr` segment config was removed), and every route is validated in dev for "instant navigation" (does a direct visit and a client navigation both produce a static shell instantly, or does something block).

**BroGram's `next.config.ts` is currently empty** — no `cacheComponents`, so BroGram is on what the docs call the "Previous Model" (`caching-without-cache-components.md`): `fetch()` is uncached by default, `unstable_cache()` wraps non-fetch reads, and `dynamic`/`revalidate`/`fetchCache` route-segment exports control behavior.

### `use cache`, `cacheLife`, `cacheTag` (Cache Components model)

```ts
import { cacheLife, cacheTag } from 'next/cache'

export async function getCourses() {
  'use cache'
  cacheLife('days')       // stale 5m / revalidate 1d / expire 1w
  cacheTag('curriculum')
  return db.query(...)
}
```

Preset `cacheLife` profiles (all have a 5-minute client `stale` window by default; only `revalidate`/`expire` differ):

| Profile | stale | revalidate | expire |
|---|---|---|---|
| `default` | 5m | 15m | never |
| `seconds` | 30s | 1s | 1m |
| `minutes` | 5m | 1m | 1h |
| `hours` | 5m | 1h | 1d |
| `days` | 5m | 1d | 1w |
| `weeks` | 5m | 1w | 30d |
| `max` | 5m | 30d | 1y |

A cache with `revalidate: 0`, `expire` under 5 minutes, or `stale` under 30 seconds is excluded from the prerendered static shell and becomes a "dynamic hole" resolved at request time — this is by design (a prefetch would otherwise expire before the click lands).

### `revalidateTag`, `updateTag`, `refresh` — read this carefully, the signature changed

**`revalidateTag` now requires a second argument in Next 16.** The official v16 upgrade guide states this explicitly: *"`revalidateTag` now requires a second argument specifying a `cacheLife` profile. The single-argument form is deprecated and will produce a TypeScript error."*

```ts
// Before (Next 15) — now a type error in 16
revalidateTag('posts')
// After (Next 16)
revalidateTag('posts', 'max') // stale-while-revalidate: serve stale, refresh in background
```

Note: the "Previous Model" caching guide's own code example still shows the single-argument form — that page has not been fully updated for the signature change; follow the upgrade guide (the changelog), not that example, for the exact call shape.

Two related, newer APIs worth knowing for BroGram specifically:

- **`updateTag(tag)`** — Server Actions only, expires *and* refreshes in the same request ("read-your-own-writes"). Use where a user must see their own change immediately (e.g., a saved wellness preference, if that write ever moves server-side).
- **`refresh()`** — refreshes the client router from inside a Server Action without any tag machinery; useful for something like "bump a notification count" style UI, not directly needed by BroGram's current mutation set (all of which go through `supabase-js` from the client, not Server Actions).

### Partial Prerendering (PPR) status

PPR is **not experimental anymore** in the sense of a separate flag — it *is* what `cacheComponents: true` does. There is no more `experimental.ppr` boolean and no more `experimental_ppr` route segment export; both were removed in 16 (confirmed in `upgrading/version-16.md`). If BroGram was ever going to reach for the old `experimental.ppr` flag from prior knowledge, that flag simply does not exist on 16.3.4 — use `cacheComponents` instead.

**Partial Prefetching** (a related, separate, newer flag — introduced in **16.3.0**, so BroGram's exact installed version, 16.3.4, already has it) changes `<Link>`'s default prefetch from "the whole page" to "one shared App Shell per route":

```ts
const nextConfig: NextConfig = { cacheComponents: true, partialPrefetching: true }
```

Once on, a route's URL-independent content (session-scoped via `cookies()`/`headers()`) is fetched once and shared by every link to that route; content that depends on `searchParams`/dynamic `params` only resolves per-link if that specific `<Link>` sets `prefetch={true}` (which costs one server invocation per visible such link — use it sparingly, e.g. on a hover-triggered link, not on a whole grid of cards).

### Router prefetch behavior (this applies to BroGram *today*, with or without Cache Components)

This is the single most actionable fact in this section, and it needs no new config to act on. From `guides/prefetching.md`:

| | Static page | Dynamic page |
|---|---|---|
| Prefetched by `<Link>` | Yes, full route | **No, unless it has a `loading.js`** |
| Client cache TTL | 5 min default | Off, unless `staleTimes.dynamic` is set |
| Server round trip on click | No | Yes, streamed after the shell |

BroGram's `(app)` routes are all dynamic (the shared layout calls `supabase.auth.getUser()` and reads `headers()`), and **none of them has a `loading.tsx`.** That means every `<Link>` in BroGram today — "Change course," each of the three "Next exercises," "Try a de-rot drill" — is not prefetched by Next.js at all. Adding a `loading.tsx` per route segment is what turns this on; see [§8](#8-brogram-data-layer-architecture) for exactly where.

### `loading.tsx` and streaming with `<Suspense>`

Two independent mechanisms, easy to conflate:
- **`loading.tsx`** is a route-segment-level convention: while the segment's async work is pending, Next shows this file's export as an instant fallback, streamed as part of the initial response, and (per the table above) it is also what makes a dynamic route eligible for `<Link>` prefetching at all.
- **`<Suspense>`** boundaries let you stream *part* of a page while the rest renders immediately — finer-grained than a whole-route `loading.tsx`. Under Cache Components, `<Suspense>` is also how you mark "this part of the tree reads runtime data (`cookies()`/`headers()`/uncached fetch) and should stream, not block the whole render."

For BroGram pre-Cache-Components, the actionable version is simple: add a `loading.tsx` skeleton to every route under `src/app/(app)/` (dashboard, `exercise/[id]`, `derot`, `derot/[kind]`, `reports`, `account`, `onboarding`). This alone (a) unlocks prefetching per the table above, and (b) replaces "blank page, then client `useState` spinner" with an immediate, server-shipped, branded skeleton.

---

## 3. Seed curriculum as static JSON instead of database reads

BroGram's own architecture already treats curriculum as static content — `seed/courses.json` (8.0K), `seed/clos.json` (12K), `seed/patterns.json` (8.0K), `seed/exercises/*.json` (372K across 7 files, ~88 verified + 15 unverified Java), `seed/drills/*.json` (124K) — checked into the repo, validated by `seed/validate.mjs`, and loaded into Supabase once by `scripts/seed-load.mjs`. Total curriculum payload is well under 600KB uncompressed, which is small even before gzip/brotli (JSON compresses very well — typically 70-85% smaller).

**Important constraint this respects rather than works around:** the design spec's own non-negotiable #3 states *"Vercel exists only to call DeepSeek and to proxy the Java judge. Supabase only persists."* That rules out routing curriculum reads through a new Next.js Route Handler wrapped in `unstable_cache` — even though that is a legitimate Next.js pattern in general, it would add a Vercel Function invocation for content that has no business touching a server function at all. Static files under `public/` (or bundled at build time) are served by the CDN/edge with **zero function execution**, which is the only option fully consistent with BroGram's own rule.

**Recommended shape:**

1. Add a small build step — `scripts/build-static-curriculum.mjs`, run as a `prebuild` script — that reads `seed/*.json`, applies the *same* filters the current Supabase queries apply (`status === 'live'`, `verified === true`), strips `referenceSolution` from every exercise (the `ExercisePublic = Omit<Exercise, 'referenceSolution'>` type in `src/lib/contracts.ts` already documents exactly what is safe to ship to the client — hidden-test `expected` values are fine, per the design's own "the browser grades" model; only the reference solution is the one field that must never leave the server), and writes:
   - `public/curriculum/courses.json` — the live course list
   - `public/curriculum/<course-code>.json` — that course's CLOs + its exercises (`ExercisePublic[]`)
   - `public/curriculum/patterns.json`
   - `public/curriculum/drills/<kind>.json`
2. Fetch these with plain `fetch('/curriculum/<course>.json')` from client components, or `import` them directly into a Server Component where the data is needed at first paint (zero network request either way once cached by the browser).
3. Set explicit cache headers in `next.config.ts` for the static path, since Next's default `public/` serving does not add the aggressive `immutable` headers it gives hashed `_next/static` assets automatically:
   ```ts
   async headers() {
     return [{
       source: '/curriculum/:path*',
       headers: [{ key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=604800' }],
     }]
   }
   ```
4. Supabase's `courses`/`clos`/`exercises`/`drills` tables remain the source of truth for **authoring and verification** (the `seed:load` pipeline, the admin screens, `exercise-verify` route) — this is purely about what the *learner's browser* reads on the hot path. Nothing about the authoring or verification pipeline changes.

Trade-off to say out loud: a content edit now requires a redeploy (or at minimum a rebuild) to reach learners, instead of being visible the instant a row changes in Supabase. Given BroGram already redeploys constantly during this build (per the build log) and the content is authored offline in batches (per the agent-architecture memory: "offline-generated hybrid bank"), this is the right trade for a fast, static-first product, not a real loss.

---

## 4. Supabase client-side query patterns that avoid waterfalls

**Embedded resource joins** are the documented way to fetch related rows in one round trip via PostgREST's automatic foreign-key detection (supabase.com/docs/guides/database/joins-and-nesting):

```js
// One round trip instead of two
const { data } = await supabase
  .from('orchestral_sections')
  .select('id, name, instruments ( id, name )')
```

Add `!inner` to turn the default left-join semantics into an inner join (drops parent rows with no match), and `alias:relation!foreign_key_name` to disambiguate when a table has more than one foreign key into the same target.

**Where this genuinely helps in BroGram:** anywhere a table with a real foreign key needs to be fetched alongside its parent in a UI that reads more than one relation at once (e.g., an admin screen joining `attempts` with exercise metadata, or a future report view). Use it there directly.

**Where it does *not* straightforwardly apply — and why, precisely:** `exercises_public` (`supabase/migrations/0001_init.sql:97-105`) is a **security-barrier view**, not a table:
```sql
create view public.exercises_public as
select id, clo_id, language, kind, difficulty, pattern, title, prompt, starter_code, tests, origin, parent_exercise_id, author_user_id, verified, tags, fixture, created_at
from public.exercises
where public.is_not_banned() and (origin = 'seed' or author_user_id = (select auth.uid()));
```
PostgREST's automatic embedding relies on foreign-key **constraints**, which exist on the base table (`exercises`) and, deliberately, not on the client-readable view — the base table is `revoke all`'d from `anon`/`authenticated` on purpose, precisely so the reference solution and the row-level ban check stay server-enforced. Whether `select('*, clos(*)')` against `exercises_public` will auto-embed depends on PostgREST's ability to trace the view back to the base table's constraints, which is not guaranteed for a `security_barrier` view with a `where` clause calling a `security definer` function — **verify directly against the live project before relying on it**, don't assume it works from the general pattern alone. Either way, this is moot for the specific waterfall in `useExerciseLoop` (item E in the audit above): `clos` and `courses.packages` are seed data, so the real fix is [§3](#3-seed-curriculum-as-static-json-instead-of-database-reads) making that lookup free, not forcing a join through a security view for data that shouldn't be a network call at all.

**The one genuine per-user waterfall left after static JSON lands** is `attempts` in the same effect — currently fetched with no `.limit()`, on every exercise open, for the user's entire lifetime history. Two independent fixes, both worth doing:
- Cap it: `.order('created_at', { ascending: false }).limit(50)` — `useExerciseLoop` only reads `history.current` for recency checks (last attempt time for a given exercise/CLO) and for the streak/mastery math the *server* already aggregates into `learner_state`; a full unbounded history is not actually needed client-side for this hook's own logic (confirm against each `history.current` read site before shipping the cap, since one or two call sites do scan the array for a specific `exercise_id`, but even those only need recent attempts to be useful for hint-count recovery).
- Cache it: once TanStack Query owns this read (`['recent-attempts', userId]`, `staleTime: 30_000`), moving between exercises within the same session reuses the same cached page instead of re-fetching the full list every time.

---

## 5. Code-splitting heavy client libraries

BroGram is already correct in one place and has one concrete, fixable gap.

**Already correct:** `src/components/report/pdf.ts` dynamically imports both heavy libraries at call time, with a comment explaining exactly why:
```ts
const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')])
```
`jspdf` and `html2canvas-pro` never enter any route's main bundle — they load only when `downloadReportPdf()` is actually invoked from a click handler. This is the textbook pattern (`next/dynamic` with `ssr: false` is the equivalent for a component that needs to render something, rather than a bare function like this one) and needs no change.

**The concrete gap:** `src/components/exercise/Editor.tsx` statically imports **all five** CodeMirror language packages at module scope —
```ts
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { sql, SQLite } from '@codemirror/lang-sql'
import { java } from '@codemirror/lang-java'
```
— even though `languageExtension()` only ever uses **one** of them per exercise (switched on the `language` prop). Every exercise page bundle ships Python's, JavaScript's, HTML's, SQL's, *and* Java's grammar/parser tables regardless of which single language that course actually needs. Recommended fix — load only the needed grammar, on demand, and cache the compartment reconfiguration:
```ts
const languageLoaders: Record<Language, () => Promise<Extension>> = {
  python: () => import('@codemirror/lang-python').then(m => m.python()),
  javascript: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  typescript: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  mongo: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  web: () => import('@codemirror/lang-html').then(m => m.html()),
  sql: () => import('@codemirror/lang-sql').then(m => m.sql({ dialect: m.SQLite })),
  java: () => import('@codemirror/lang-java').then(m => m.java()),
}
// then, in the language-change effect:
useEffect(() => {
  let active = true
  languageLoaders[language]().then(ext => { if (active) view.current?.dispatch({ effects: compartments.language.reconfigure(ext) }) })
  return () => { active = false }
}, [compartments, language])
```
This is a same-file, low-risk change (no new dependency, no API change to `Editor`'s props) that removes 4 of 5 language grammars from every exercise page's bundle.

**Already effectively split by architecture:** Pyodide, the JS engine, `sql.js`, and Mongo all run inside dedicated Web Workers (`pyodide.worker.ts`, `js.worker.ts`, `sql.worker.ts`, `mongo.worker.ts`). Because bundlers emit a worker's dependency graph as its own chunk, Pyodide's multi-megabyte WASM payload is already off the main thread and already outside the exercise page's own JS bundle — this part of the architecture does not need `next/dynamic`; the worker boundary already *is* the code-split. The only remaining lever for these is *when* the worker is spun up, covered next.

**Route-level splitting** happens automatically in the App Router (each route segment is its own chunk) — BroGram does not need manual `next/dynamic` at the route level for e.g. keeping CodeMirror out of `/dashboard`'s bundle; that is already true today simply because `/dashboard` and `/exercise/[id]` are different route segments.

---

## 6. Web Worker warmup timing

General pattern (web.dev, "WebAssembly performance patterns for web apps"): preload the wasm binary as early as possible (`<link rel="preload" as="fetch" crossorigin>`), prefer streaming compilation (`WebAssembly.instantiateStreaming`) over compile-then-instantiate, and — the part that matters here — **keep initialization out of the interaction's hot path**: warm a worker during idle time, well before the user needs it, and reuse the same warm worker/instance rather than re-initializing per use. `requestIdleCallback` (MDN, W3C spec) is the standard primitive for scheduling exactly this kind of "important but not urgent" background work without competing with input/animation.

BroGram's `RuntimeAdapter` contract (`src/lib/contracts.ts`) already anticipates this correctly: `warmup(): Promise<void>` is documented as **"Idempotent. Resolves when the runtime is ready"** — calling it early and calling it again later are both safe. `getRuntime()` (`src/lib/runtimes/index.ts`) caches one adapter instance per language for the app's lifetime, so a warmup started from the dashboard is never wasted work; it is simply the same warm worker the exercise page will use minutes later.

Today, per the audit (§ current-state, item G), warmup only starts *after* the exercise page's own three-wave data fetch resolves — i.e., as late as it could possibly start. Recommended change, purely additive (no change to the existing warmup-on-exercise-mount logic, which should stay as the fallback for direct links/refreshes):

```tsx
// in the dashboard, once the "next exercises" list is known (already has .language per item)
useEffect(() => {
  if (!orderedExercises[0]) return
  const idle = 'requestIdleCallback' in window ? window.requestIdleCallback : (cb: () => void) => setTimeout(cb, 200)
  const cancel = idle(() => {
    const language = orderedExercises[0].kind === 'schema' ? 'sql' : orderedExercises[0].language
    void getRuntime(language).warmup().catch(() => {}) // best-effort; the exercise page retries on real need
  })
  return () => { if ('cancelIdleCallback' in window) window.cancelIdleCallback(cancel as number) }
}, [orderedExercises])
```

Because `Runtime = 'browser' | 'judge'` and only one language is likely to be "next" for a given course, this is a single, cheap, best-effort call — not a fan-out across all five runtimes. Pair it with a hover/focus trigger on each of the three "Next exercises" rows (mirroring the same intent signal Next's own `<Link>` hover-prefetch uses) for the second and third items, so all three are warm by the time any of them is actually clicked.

---

## 7. Measuring: Lighthouse, Vercel Speed Insights, web-vitals

Versions verified against the npm registry and this project's exact Next.js build, 2026-09-06:

| Tool | Verified version | Role |
|---|---|---|
| `@vercel/speed-insights` | **2.0.0** | Real-user monitoring (RUM): field data (LCP, INP, CLS, FCP, TTFB) from actual visitors, shipped to the Vercel dashboard. |
| `web-vitals` | **6.2.1** | The underlying metrics library (by the Chrome team); Next.js's own `useReportWebVitals` hook is built on it. |
| `@lhci/cli` (Lighthouse CI) | **0.15.x**, running **Lighthouse 12.6.1** | Lab data in CI: fails a build/PR on a performance regression against a budget. |

**Vercel Speed Insights** — confirmed via the published package's own `exports` map (not just the docs) that the Next.js App Router entry point is `@vercel/speed-insights/next`:
```tsx
// src/app/layout.tsx (root layout)
import { SpeedInsights } from '@vercel/speed-insights/next'
// ...
<body>
  {children}
  <SpeedInsights />
</body>
```
It only reports in production/deployed environments, not `next dev`. This is the fastest way to get real BroGram-learner-device Core Web Vitals with no custom plumbing, and the free tier is sufficient to start (per Vercel's current pricing page).

**`web-vitals` / `useReportWebVitals`** — Next's own App Router hook (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-report-web-vitals.md`, `next/web-vitals`), useful **in addition to** Speed Insights when BroGram wants its own record of a metric (e.g., logging LCP/INP into `agent_usage`-style telemetry, or for anyone self-hosting the MIT-licensed project without a Vercel account — worth keeping in mind given the stated ambition to be "the best open-source code learning platform in the world," which implies other people running their own instance off Vercel):
```tsx
// src/components/shell/WebVitals.tsx
'use client'
import { useReportWebVitals } from 'next/web-vitals'
export function WebVitals() {
  useReportWebVitals((metric) => {
    if (metric.name === 'LCP' || metric.name === 'INP' || metric.name === 'CLS') {
      navigator.sendBeacon?.('/api/vitals', JSON.stringify(metric))
    }
  })
  return null
}
```
Metric names reported: `TTFB`, `FCP`, `LCP`, `FID` (legacy — Google has since replaced FID with INP as the responsiveness Core Web Vital; keep reading it for now, don't design around it), `CLS`, `INP`. Each carries a `rating` of `"good" | "needs-improvement" | "poor"` already computed against Google's published thresholds — no need to hand-roll threshold logic.

**Lighthouse CI** — for catching a regression before it ships, not for live monitoring. A minimal GitHub Actions job:
```yaml
- run: npm install -g @lhci/cli@0.15.x
- run: lhci autorun --collect.numberOfRuns=3
```
Set `numberOfRuns: 3` (or 5) so assertions run against the **median**, reducing run-to-run variance — this is the current documented recommendation, not a leftover from an older major version. Define budgets (max LCP, min performance score, a JS-byte cap) in `lighthouserc.json` and let a regression fail the PR rather than relying on someone noticing it felt slower.

**Division of labor:** Lighthouse CI catches a regression in CI before merge (lab data, one simulated device/network profile); Speed Insights shows what actually happened to actual learners on actual devices/networks after deploy (field data). Use both — they answer different questions and neither substitutes for the other.

---

## 8. BroGram data-layer architecture

### Data classification

| Data | Source of truth | Where the learner's browser gets it | Refresh trigger |
|---|---|---|---|
| Courses, CLOs, patterns | `seed/*.json` → Supabase (authoring/admin) | **Static JSON** (`public/curriculum/*.json`), built by a `prebuild` script | Redeploy after a seed edit |
| Exercises (`ExercisePublic`, no `referenceSolution`) | `seed/exercises/*.json` → Supabase (authoring/verification) | **Static JSON**, one file per course | Redeploy after `seed:load` / re-verification |
| Drill items | `seed/drills/*.json` | **Static JSON** | Redeploy |
| Onboarding fallback questions | `profiler-fallback.json` | Already static (bundled) | Redeploy |
| `learner_state` (mastery, streak, points, path, nextExerciseIds, profile, integrityScore, accountStatus, version) | Supabase, per-user | SSR-seeded once in `(app)/layout.tsx`, then TanStack Query (`['learner-state', userId]`) for client reads/writes | On mutation (attempt, hint, plan-refresh) or 30s staleness |
| `attempts` | Supabase, per-user | TanStack Query, **capped** (`limit(50)`, newest first) | On new attempt; 30s staleness otherwise |
| `mastery` (per-CLO rows) | Supabase, per-user | Derived into `learner_state.mastery` server-side already; client rarely needs the raw table directly | Same as `learner_state` |
| `wellness` (prefs, drill_results, water/pomodoro logs) | Supabase, per-user | Prefs: localStorage-first + background sync via TanStack Query mutation. Logs: append-only, fire-and-forget mutation. | Instant locally; background persist |
| `integrity_events` | Supabase, per-user, write-only from the client's perspective | Never read back by the learner's own client | N/A |
| Agent replies (all seven agents) | `/api/agent` (DeepSeek) | Never cached — `useMutation` only, one-shot | Every trigger, by design (the seven-trigger rule already enforces this) |

### What is prefetched, and when

| Moment | Action |
|---|---|
| App shell mount (`(app)/layout.tsx`) | `learner_state`, recent `attempts` (capped), and `wellness` are already fetched server-side today; keep this, just also seed the TanStack Query cache with the result so client reads don't refetch immediately. |
| Dashboard mount | Zero curriculum round trips (static JSON, already resolvable synchronously from the bundle/cache). `requestIdleCallback` warms the top "next exercise"'s runtime ([§6](#6-web-worker-warmup-timing)). `<Link>` (with `loading.tsx` now present on `exercise/[id]`) prefetches all three next-exercise routes automatically as they enter the viewport — no manual `router.prefetch()` needed for this specific case. |
| Hover/focus on a "Next exercises" row (2nd and 3rd items) | Trigger that item's runtime warmup, mirroring the intent signal `<Link>` itself uses for hover-prefetch. |
| Onboarding → course grid | Course list renders instantly from static JSON (no `coursesLoading` state needed at all for the live-course grid; only the "coming soon" DB rows, if kept dynamic, still show their existing loading state). |
| Course selection (`chooseCourse`) | CLOs + candidate exercises resolve from static JSON (zero round trips) instead of 1 + 3 Supabase calls; only the Planner agent call and the `learner_state` write remain — both irreducible, both already shown with the existing `StepLoading` UI. |
| Exercise page mount | Exercise content resolves from static JSON keyed by id (or a single, capped Supabase read if some exercises are still DB-only, e.g. freshly `origin: 'generated'` ones not yet in the static bundle); only `attempts` (capped) is a real per-user Supabase read. Runtime warmup starts in parallel with, not after, this read (it no longer depends on `course.packages`, since packages are static too). |

### Optimistic paths

| Action | Optimistic behavior | Reconciliation | Rollback |
|---|---|---|---|
| **Attempt submit** | Local grading (`getRuntime().run()`) already determines pass/fail synchronously in the browser. Reveal it immediately — a new fast UI state (e.g. `status: 'graded'`, distinct from today's `'submitting'`) shows the pass/fail result and test breakdown the instant local grading resolves, with a small "Saving your progress…" indicator for the still-in-flight background work (attempt insert, Reviewer/Diagnoser call, mastery/learner_state write, next-exercise queueing). | The existing `finishSubmission()` chain runs unchanged in the background and fills in praise/quality/points/next-exercise once it resolves. | None needed for the pass/fail fact itself (it is a true local computation, not a guess); if the background save ultimately fails, show a retry banner (the existing `retry()` path) without revoking the already-shown grading result. |
| **Hint request** | Already optimistic today: hint count is spent and a receipt written *before* the network call, and streamed partial tokens render progressively. Keep as-is. | Real reply replaces the streamed partial on completion. | Refund only if zero partial frames were ever received (existing, correct logic) — do not change this. |
| **Drill result** (de-rot) | Local-only by design (spec: "entirely local," "no data beyond a `DrillResult`"). Update the de-rot streak/score in UI state immediately on completion; persist to `wellness.drill_results` as a fire-and-forget `useMutation`. | Background upsert. | On persistent failure, queue for retry on next mount rather than blocking or reverting the just-earned streak. |
| **Prefs** (wellness rail position/collapsed/dock, sound on/off, tone/verbosity) | Write-through: apply to local state / `localStorage` instantly (zero network wait, ever, for a preference toggle), then a debounced `useMutation` persists to Supabase in the background. | Background write. | Roll back only on a hard, repeated failure, surfaced as a toast — never block the toggle itself on the network. |
| **Course switch** | Fix the `stage` initialization bug first (derive the initial stage from `session.learnerState?.profile.onboardingComplete`, so an already-onboarded learner lands directly on the course grid, never back on Profiler questions). Course grid and CLO/candidate data render from static JSON with zero loading state. The one irreducible step (the Planner call) keeps its existing `StepLoading`/"Building your path" UI, now reached in roughly 1 round trip instead of ~7. | `learner_state` write on completion (existing retry-safe `writeLearnerState`). | Existing `ErrorRetry` + "Choose a different course" secondary action, unchanged. |

---

## 9. Performance budget

Targets assume Lighthouse's mobile-throttled profile for LCP/CLS (matching Google's published Core Web Vitals thresholds: LCP good ≤2.5s / poor >4s, INP good ≤200ms / poor >500ms, CLS good ≤0.1) and a warm cache for repeat-route numbers, since BroGram is a logged-in product where nearly every session after the first is a "return visit."

### Per-route round trips (excluding the DeepSeek/agent call itself, which is accounted for separately)

| Route | Today (client-side Supabase round trips, steady state) | Target |
|---|---|---|
| `/dashboard` | 3 (courses, clos, exercises_public — every single mount) | **0** for curriculum (static JSON); `learner_state`/`attempts` already SSR-seeded and cache-warm from TanStack Query on repeat visits within the session |
| `/exercise/[id]` | 4, in 3 sequential waves (exercise row → [clo ∥ attempts] → course packages) | **1** (capped `attempts`, e.g. `limit(50)`) once exercise/clo/packages are static JSON |
| `/onboarding` (course switch) | ~7 (1 clos + 3 candidate fetches + 1-3 `learner_state` write) **plus** an unnecessary detour through up to 13 Profiler question screens | **1** (the `learner_state` write) plus the one irreducible Planner agent call; zero detour through Profiler UI |
| `/reports` | Renders entirely from already-loaded `LearnerState` (per spec: "Nothing server-side") | **0** — already correct, no change needed |

### LCP

| Route | Target (mobile, throttled) | Why achievable |
|---|---|---|
| `/dashboard` | ≤ 1.5s | Headline and "Next exercises" titles are SSR'd via the layout's existing server fetch; once curriculum is static JSON, the exercise *titles* (today's LCP-relevant text, currently swapped in late behind "Opening your course") are available immediately instead of after a client round trip. |
| `/exercise/[id]` | ≤ 1.8s (excludes CodeMirror mount, which is interaction-gated, not paint-gated) | Prompt text (`PromptPanel`) is the LCP candidate and depends only on the exercise/CLO data, which becomes a single capped read instead of a 3-wave chain. |

### Interaction latency (INP-oriented)

| Interaction | Target | Rationale |
|---|---|---|
| Course tile click → course grid renders | < 100ms | Already a pure client state transition; only needs the `stage`-initialization bug fixed so the grid is what actually renders. |
| Submit click → pass/fail revealed | < 300ms **beyond** actual code-execution time in the runtime adapter | The UI overhead on top of Pyodide/worker execution should be imperceptible once pass/fail is read from the local grading result directly, instead of waiting on the full save/agent chain (today: potentially several seconds, dominated by a full Reviewer/Diagnoser LLM round trip plus multiple Supabase writes). |
| Hint click → first visible token | < 1.5s | Already streamed; this formalizes existing behavior as a budget rather than changing it. |
| First Run/Submit after opening a **new** language for the session (cold Pyodide) | Not user-visible at all for the *first* exercise of a session, by starting warmup from the dashboard at idle time before the click | Currently this cost lands entirely on the first click inside the exercise page. |

### JS payload

| Bundle | Target |
|---|---|
| `exercise/[id]` route's CodeMirror language grammars | 1 loaded grammar (the exercise's own language), not 5 |
| `dashboard`, `onboarding` route bundles | No CodeMirror, Pyodide, jsPDF, or html2canvas-pro code at all (already true today by route-level splitting; keep it true as new features are added — don't accidentally import `Editor.tsx` from a non-exercise route) |

---

## 10. Phased rollout

Sequenced for a codebase shipping thin-but-whole on a tight date, ordered by (low risk, high leverage) first:

**Ship this week — near-zero risk, large perceived-speed wins:**
1. Fix the onboarding `stage` initialization bug (§ audit item C) — a few lines, directly fixes the loudest specific complaint.
2. Add `loading.tsx` to every route under `src/app/(app)/` — unlocks Next's own `<Link>` prefetching on all of them and removes the blank-page flash.
3. Ship curriculum as static JSON (`public/curriculum/*.json` + a `prebuild` script) — removes the dashboard's 3 round trips and most of the onboarding waterfall in one change.
4. Split CodeMirror's language import in `Editor.tsx` per language.
5. Start runtime warmup from the dashboard at idle time for the top "next exercise."
6. Add `@vercel/speed-insights` to the root layout — costs one component, starts collecting real field data from day one of the live launch, informs everything after.

**Ship next — moderate effort, still feasible pre-launch:**
7. Introduce TanStack Query for curriculum (as a safety net alongside static JSON during the transition), wellness prefs, and course-switch mutations, with `onMutate`/rollback wired to the existing `version` field.
8. Cap `attempts` reads (`limit(50)`) in `useExerciseLoop` and move that read behind TanStack Query.
9. Apply the single surgical optimistic-reveal fix to `submit()` (a new fast UI state right after local grading, before the background save chain) — without touching the correctness machinery around version conflicts, idempotent upserts, and hint refunds.

**Post-launch — bigger architectural bets, worth doing once real usage data exists:**
10. Evaluate `cacheComponents: true` (Cache Components) adoption. This is a real migration — every dynamic read (starting with the `(app)/layout.tsx` auth check itself) needs an explicit `<Suspense>` boundary, and the dev-time "instant navigation" validator will surface every place that currently blocks. Vercel documents dedicated migration workflows for exactly this (`next-cache-components-adoption` and `next-partial-prefetching-adoption`, referenced from the Instant Navigation guide) — worth using once there is room to do it carefully rather than during launch week.
11. Wire Lighthouse CI into the pipeline with real budgets, now that there is a live URL and real baseline numbers to set thresholds against.
12. Revisit whether `reactCompiler: true` (stable in 16, opt-in, not default) is worth its build-time cost for BroGram's more re-render-heavy screens (dashboard, exercise workspace) — worth a measured trial, not a blind flip, since it uses Babel and will slow builds.

---

## Sources

Next.js (version-matched to this repo's installed `next@16.3.4`, verified against `node_modules/next/dist/docs/`; public URLs given for reference):
- [Caching](https://nextjs.org/docs/app/getting-started/caching) — Cache Components, `use cache`, prerendering, prefetching overview
- [Caching and Revalidating (Previous Model)](https://nextjs.org/docs/app/guides/caching-without-cache-components) — the model BroGram is on today
- [Rendering Philosophy](https://nextjs.org/docs/app/guides/rendering-philosophy) — static/dynamic as a spectrum
- [`cacheComponents` config](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
- [`use cache` directive](https://nextjs.org/docs/app/api-reference/directives/use-cache)
- [`cacheLife`](https://nextjs.org/docs/app/api-reference/functions/cacheLife)
- [`cacheTag`](https://nextjs.org/docs/app/api-reference/functions/cacheTag)
- [Revalidating](https://nextjs.org/docs/app/getting-started/revalidating) — `revalidateTag`, `updateTag`, `revalidatePath`
- [Client-side data fetching](https://nextjs.org/docs/app/guides/client-side-data-fetching) — SWR vs. TanStack Query decision guide
- [Client-side data fetching with TanStack Query](https://nextjs.org/docs/app/guides/client-side-data-fetching/tanstack-query)
- [Prefetching](https://nextjs.org/docs/app/guides/prefetching)
- [Optimizing prefetching](https://nextjs.org/docs/app/guides/optimizing-prefetching)
- [Ensuring instant navigations](https://nextjs.org/docs/app/guides/instant-navigation)
- [`partialPrefetching` config](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching)
- [`prefetchInlining` config](https://nextjs.org/docs/app/api-reference/config/next-config-js/prefetchInlining)
- [How to upgrade to version 16](https://nextjs.org/docs/app/guides/upgrading/version-16) — breaking changes, `revalidateTag` signature change, PPR removal/replacement
- [`useReportWebVitals`](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)

Supabase:
- [Querying Joins and Nested Tables](https://supabase.com/docs/guides/database/joins-and-nesting) — embedded resource select syntax, `!inner`, foreign-key disambiguation

TanStack Query:
- [Important Defaults (v5)](https://tanstack.com/query/v5/docs/framework/react/guides/important-defaults) — `staleTime`/`gcTime` defaults, retry/backoff, structural sharing
- [Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — `onMutate`/rollback pattern (referenced from the Next.js TanStack Query guide)

Vercel:
- [Getting started with Speed Insights](https://vercel.com/docs/speed-insights/quickstart)
- [Speed Insights package configuration](https://vercel.com/docs/speed-insights/package)

Web performance:
- [WebAssembly performance patterns for web apps (web.dev)](https://web.dev/articles/webassembly-performance-patterns-for-web-apps) — preload, streaming compilation, Worker warmup, module caching
- [`Window.requestIdleCallback()` (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
- [Lighthouse CI (GoogleChrome/lighthouse-ci)](https://github.com/GoogleChrome/lighthouse-ci/)

npm registry (versions verified 2026-09-06 via `npm view <package> version`):
- [next](https://www.npmjs.com/package/next) — 16.3.4 (matches this repo's installed version exactly)
- [react](https://www.npmjs.com/package/react) — 19.2.8
- [@tanstack/react-query](https://www.npmjs.com/package/@tanstack/react-query) — 5.102.8
- [@vercel/speed-insights](https://www.npmjs.com/package/@vercel/speed-insights) — 2.0.0
- [web-vitals](https://www.npmjs.com/package/web-vitals) — 6.2.1
- [@supabase-cache-helpers/postgrest-react-query](https://www.npmjs.com/package/@supabase-cache-helpers/postgrest-react-query) — 1.13.9
- [@supabase/supabase-js](https://www.npmjs.com/package/@supabase/supabase-js) — 2.115.0 (matches this repo's installed version)
- [@supabase/ssr](https://www.npmjs.com/package/@supabase/ssr) — 0.12.6 (matches this repo's installed version)

BroGram source (this repository, read directly as the evidence base for §"Current-state audit" and §8):
- `src/store/session.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/onboarding/page.tsx`, `src/app/(app)/exercise/[id]/page.tsx`, `src/hooks/useExerciseLoop.ts`, `src/lib/runtimes/index.ts`, `src/components/exercise/Editor.tsx`, `src/components/report/pdf.ts`, `src/lib/contracts.ts`, `supabase/migrations/0001_init.sql`, `seed/*.json`, `docs/build-log.md`, `docs/superpowers/specs/2026-09-05-brogram-design.md`, `openspec/changes/brogram-launch/tasks.md`
