# BroGram v1 codebase audit — causes of the owner's verdict

Date: 2026-09-06. Method: code read, production build run, test suite run. Every claim below carries a `file:line`. Nothing here is inferred from the spec; where the spec and the code disagree, the code is what is reported.

Verified this session:
- `npm run build` — exit 0, Next.js 16.3.4 (Turbopack). Turbopack prints no per-route byte table, so route weights below were computed from `.next/server/app/**/page_client-reference-manifest.js` against `.next/static/chunks/*.js` on disk.
- `npx vitest run` — **91 files, 840 tests, all passing**, 11.0s.

---

## 0. Hotspot ranking

Ranked by (owner pain) × (how much of it this one thing causes) × (how cheap it is to fix without touching a frozen contract).

| # | Hotspot | Owner complaint it causes | Evidence |
|---|---|---|---|
| **H1** | **Onboarding re-runs the full profiler on every course switch.** `stage` is initialized to `'question'` unconditionally; nothing reads `profile.onboardingComplete`. Both dashboard entry points link straight to `/onboarding`. | "every course switch re-runs the onboarding profiler" | `src/app/(app)/onboarding/page.tsx:47`; `src/app/(app)/dashboard/page.tsx:118,155`; `src/app/(app)/reports/page.tsx:88` |
| **H2** | **One blocking, non-streaming DeepSeek call per onboarding question, up to 13.** `profiler.streams:false` → `callAgent` waits for the whole JSON object. Each call also costs ~4 server DB round trips before the model is even reached. | "finding the next question takes a long time" | `src/lib/agents/profiler.ts:132`; `src/app/(app)/onboarding/page.tsx:88-99,26`; `src/lib/supabase/server.ts:59,61`; `src/lib/agents/ratelimit.ts:52,70` |
| **H3** | **All 13 onboarding questions are already deterministic in server code, yet each costs an LLM call.** Phase 2's six questions are hardcoded verbatim and mapped by pure functions; phase 1 has a 5-question static fixture and a pure `styleFromAnswers`. | "remove redundant questions" | `src/lib/agents/profiler.ts:53-60,70-82,85-101,117-129`; `src/lib/agents/fixtures/profiler-fallback.json` (5 questions) |
| **H4** | **Submit is not optimistic: `setStatus('passed')` fires only after a non-streaming Reviewer call plus 6+ serial DB round trips.** The button says "Checking…" the entire time. | "too sluggish, no optimistic UI" | `src/hooks/useExerciseLoop.ts:330` (last line of the chain), `:270,280,291,307,315,318,328`; `src/lib/agents/reviewer.ts:54` (`streams:false`); `src/app/(app)/exercise/[id]/page.tsx:66` |
| **H5** | **The `(app)` layout paginates the learner's entire `attempts` table on every cold load of every app route, in a sequential loop, before any HTML ships.** | "too sluggish" | `src/app/(app)/layout.tsx:35-44,45-48` |
| **H6** | **457 KB of prayer-time math (`adhan`) is statically imported into the shell, so it loads on `/dashboard`, `/reports`, `/derot`, `/account` and `/exercise` — where it is only ever an offline fallback for an API call.** | "too sluggish", bundle | `src/lib/wellness/prayer.ts:10,113-129,136-164`; `src/components/wellness/Rail.tsx:10`; `src/components/shell/AppShell.tsx:49`; chunk `2nsqw184k8pg1.js` = 457 KB, referenced by 7 of 8 app route manifests |
| **H7** | **Wellness rail is structurally welded to the right, cannot collapse, and re-renders every 1000 ms.** Position is a hardcoded grid column + `order-first` on exercise; there is no preference, no toggle, no persistence. | "cannot be collapsed and must not be forced to the right" | `src/components/shell/AppShell.tsx:46-50`; `src/components/wellness/Rail.tsx:30-37,120` |
| **H8** | **The exercise screen opens through a 4-hop query waterfall and only then starts a double Pyodide cold-start from a third-party CDN.** `warmup()` spawns two workers, each fetching ~10 MB. | "too sluggish" | `src/hooks/useExerciseLoop.ts:113,117-120,125,140-143`; `src/lib/runtimes/worker-adapter.ts:74-78`; `src/lib/runtimes/pyodide.worker.ts:9-13` |
| **H9** | **No walkthrough layer exists in the product at all.** There is no concept/lesson route, no teach-before-test component, no `loading.tsx` anywhere. A course genuinely starts at the "Next exercises" list. | "a course starts at 'Next exercises', a beginner cannot learn" | `src/app/(app)/dashboard/page.tsx:138-159`; `find src -name "loading.tsx"` → none; route list in `.next` app-paths-manifest has no lesson/concept route |
| **H10** | **The UI has no motion system, no themes, and no sound.** `gsap`, `@gsap/react` and `motion` are installed and **imported nowhere**; `next-themes` is imported only by the sonner wrapper, with `dark` hardcoded on `<html>`; there is no `Audio`/`AudioContext` anywhere. Total animation surface: 6 `animate-pulse` + 2 `animate-spin` + shadcn dialog/drawer defaults. | "plain with no themes and no personality… animated, rewarding UI with sound effects" | `package.json:32,36,42`; `grep gsap\|from 'motion' src/` → 0 hits; `src/app/layout.tsx:28`; `src/components/ui/sonner.tsx:3`; `grep -i "new Audio\|AudioContext" src/` → 0 hits |
| **H11** | **Lockdown copy is bare enforcement, and the PrintScreen guard is provably theatre.** It fires on `keyup`, i.e. after the OS has already taken the shot; it then covers the page for 2 s and blanks the clipboard. | "the paste block only says 'Type it. That's the whole point' and the PrintScreen overlay is theatre" | `src/hooks/useLockdown.ts:87,131-141`; `src/components/exercise/LockdownOverlay.tsx:17,19` |
| **H12** | **`/reports` re-downloads every attempt row including full `code` and `results` JSON, paged 1000 at a time, after the layout already paged the same table.** | "too sluggish" | `src/app/(app)/reports/data.ts:46-61,51,70-78`; duplicate of `src/app/(app)/layout.tsx:35-44` |
| **H13** | **The `wellness` row is read up to three times per `/derot` load** (layout, rail, page) and drill results are saved non-optimistically through a read-then-write pair before the score screen appears. | "too sluggish", de-rot feel | `src/app/(app)/layout.tsx:47`; `src/components/wellness/Rail.tsx:130`; `src/app/(app)/derot/page.tsx:37`; `src/app/(app)/derot/[kind]/page.tsx:79,86,99` |
| **H14** | **The proxy runs three serial server operations on every matched request — including every `<Link>` prefetch** — and the layout then repeats the auth check with `auth.getUser()`, which is always a network call. | "too sluggish" | `src/proxy.ts:9-12`; `src/lib/supabase/middleware.ts:48,57,59-60`; `src/app/(app)/layout.tsx:13` |
| **H15** | **`next()` after a pass throws away the already-fetched next exercise and does a full route push,** re-running H8 from scratch. | "too sluggish" | `src/hooks/useExerciseLoop.ts:264` (fetched) vs `:437-441` (discarded) |

---

## 1. Network round trips and waterfalls, per route

Counting rule: a "hop" is one request that must complete before the next one can start. Parallel requests inside one `Promise.all` count as one hop.

### 1.1 Shared prefix — every `(app)` route pays this

**Hop 1-3 — waterfall W1 "proxy triple"** (`src/lib/supabase/middleware.ts`)
1. `supabase.auth.getClaims()` — `:48`
2. `supabase.rpc('lift_expired_restriction')` — `:57` — unconditional, on every matched request
3. `profiles.select('account_status, restricted_until')` — `:59-60`

Strictly serial (3 needs the uid from 1; 2 sits between them). The matcher covers `/dashboard`, `/onboarding`, `/exercise`, `/derot`, `/reports`, `/admin`, `/login`, `/auth` (`src/proxy.ts:9-12`), and RSC prefetch requests match too — so each in-viewport `<Link>` on the dashboard silently triggers another W1.

**Hop 4-6 — waterfall W2 "layout re-auth + full history scan"** (`src/app/(app)/layout.tsx`)

4. `supabase.auth.getUser()` — `:13`. This is a network call to Supabase's `/auth/v1/user`; it re-proves what the proxy just proved at step 1 and forwarded via headers (`:16-18`).
5. `learner_state.select('state, version')` — `:24`
6. `Promise.all([activityDates(), wellness])` — `:45-48`, where `activityDates()` (`:35-44`) is:

```ts
for (let offset = 0; ; offset += 1000) {
  const page = await supabase.from('attempts').select('created_at').eq('user_id', user!.id)
    .order('created_at', { ascending: false }).range(offset, offset + 999)
  ...
  if ((page.data?.length ?? 0) < 1000) return dates
}
```

An unbounded sequential pager, executed on the server, blocking the first byte of HTML, purely to recompute two streak dates that the saved state already carries (`:53-57`). This is **W3 "full attempt-history scan"**.

**Hop 7 — waterfall W4 "hydrate-then-fetch."** The layout renders `AppShell` and the page is `'use client'` on every app route (`dashboard/page.tsx:1`, `onboarding/page.tsx:1`, `exercise/[id]/page.tsx:1`, `derot/page.tsx:1`, `reports/page.tsx:1`). No page data is fetched on the server. Nothing route-specific can start until ~880 KB–1.6 MB of JS has downloaded, parsed and hydrated. There is **no `loading.tsx` anywhere in `src/`**, so App Router shows nothing during the RSC fetch.

**Hop 8-9 — waterfall W5 "rail double-read + third-party prayer fetch"**, mounted for every app route via `AppShell.tsx:48-50`:
8. `wellness.select('prefs,water_log,pomodoro_sessions')` — `src/components/wellness/Rail.tsx:130`. This is the **second** read of the `wellness` row on this page load; hop 6 already read it.
9. `fetch('https://api.aladhan.com/v1/timings/...')` — `src/lib/wellness/prayer.ts:143-144`, third-party, cache-missable, plus an optional `navigator.geolocation.getCurrentPosition` permission prompt at `Rail.tsx:55`.

The rail also runs a **1 Hz `setInterval` that re-renders `PrayerTimes`, `WaterStretch` and `Pomodoro` every second on every page** (`Rail.tsx:30-37,120`), and a second 15 s interval at `:39-48`.

### 1.2 `/dashboard`

Shared prefix (hops 1-9), then **hop 10**, one `Promise.all` of three queries in `useCurriculum` (`src/app/(app)/dashboard/page.tsx:46-52`): `courses`, `clos`, `exercises_public`.

**Total: 10 serial hops, ~13 requests**, plus one W1 per prefetched link (5 links: `:118,148,155,188` and the shell's nav). Nothing above the fold is server-rendered.

Loading state while hop 10 is in flight: a bare sentence, `:130` — *"Loading your course and exercise details. Your saved progress is ready."*

### 1.3 `/onboarding` — the worst offender

Shared prefix (hops 1-9). The first question is static and needs no network (`src/app/(app)/onboarding/lib.ts:26`, correctly noted at `:19-24`).

Then, **per answer** (`src/app/(app)/onboarding/page.tsx:86-99`), one `callAgent({ agent:'profiler' })` → `POST /api/agent`, and on the server each of those is:

- `getUserAndProfile()` → `auth.getUser()` + `profiles` select — `src/lib/supabase/server.ts:59,61` (2 round trips)
- `checkRate()` → `serviceClient()` + an `agent_usage` count — `src/lib/agents/ratelimit.ts:52,70` (1-2 round trips)
- `generateObject` against `deepseek-v4-flash` — `src/app/api/agent/route.ts:12`, **not streamed** because `profiler.streams:false` (`src/lib/agents/profiler.ts:132`), so the client sees nothing until the full JSON object lands
- an `agent_usage` insert — `route.ts:64`

**≈4 DB round trips + 1 full LLM completion, per question, up to 13 questions** (`MAX_QUESTIONS`, `onboarding/page.tsx:26`). Waterfall **W6 "thirteen serial model calls."**

Then course selection:
- `courses.select(...)` — `:109`
- `clos.select('*')` — `:133`
- `Promise.all` of 3 × `fetchCandidates` — `:145`
- `callAgent({ agent:'planner' })` — `:148`, also `streams:false` (`src/lib/agents/planner.ts:89`), so another 4 DB + 1 LLM
- `writeLearnerState` read+write, up to 3 attempts — `src/app/(app)/onboarding/lib.ts:86-103`
- `router.push('/dashboard')` — `:166` → the entire §1.2 waterfall again

**Worst case ≈60+ round trips including 14 DeepSeek completions.** The only feedback during any of them is `StepLoading` with the string *"Finding your next question."* (`:193,253-263`).

**Redundancy (H3).** Phase 2's six questions are hardcoded verbatim at `src/lib/agents/profiler.ts:53-60`, and their answers are mapped by a pure switch at `:85-101`. Phase 1 has five static questions in `src/lib/agents/fixtures/profiler-fallback.json` and a pure scorer at `:70-82`. `profiler.fallback()` (`:117-129`) already produces the entire 13-question flow deterministically with **zero** model calls. Today, that path is only reached when the model fails.

**Re-onboarding (H1).** `const [stage, setStage] = useState<Stage>('question')` — `onboarding/page.tsx:47`. Nothing in the file reads `session.learnerState.profile.onboardingComplete`, which `chooseCourse` itself sets to `true` at `:158`. The dashboard's "Change course" button (`dashboard/page.tsx:118`), its "Review your course" link (`:155`) and the reports empty-state link (`reports/page.tsx:88`) all point at `/onboarding` unconditionally. A returning learner therefore answers 13 questions again to change one course code.

### 1.4 `/exercise/[id]`

Shared prefix (hops 1-9, with an extra restriction check at `middleware.ts:64` and again at `layout.tsx:22` and again at `exercise/[id]/page.tsx:84`). Then, in `useExerciseLoop`:

- **hop 10** `exercises_public.select('*')` — `src/hooks/useExerciseLoop.ts:113`
- **hop 11** `Promise.all([clos, attempts])` — `:117-120`. The attempts select has **no limit and no range** — the entire history, again, on top of the layout's own pager.
- **hop 12** `courses.select('packages')` — `:125`. Serial, though it only needs `outcome.course` which arrived in hop 11.
- **hop 13** `await getRuntime(...).warmup()` — `:141`, **awaited inline**. `WorkerAdapter.warmup()` spawns *two* workers, active and standby (`src/lib/runtimes/worker-adapter.ts:74-78`), and each Python worker does `importScripts('https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.js')` then `loadPyodide` (`src/lib/runtimes/pyodide.worker.ts:9-13`) — roughly 10 MB of third-party WASM, twice, started only after four database hops.

Waterfall **W7 "four-hop open"** + **W8 "double Pyodide cold start."** Nothing warms the runtime while the learner is still on the dashboard; nothing prefetches it for the next exercise.

**Submit — waterfall W9 "serial pass chain"** (`finishSubmission`, `:267-341`):

| step | call | line |
|---|---|---|
| S1 | `attempts.upsert` | `:270` |
| S2 | Reviewer (pass) or Diagnoser (fail) via `/api/agent` — Reviewer is `streams:false` | `:280` / `:285`, `src/lib/agents/reviewer.ts:54` |
| S3 | `saveState`: `learner_state` read then conditional update, up to 3 attempts | `:291` → `:177,186` |
| S4 | `learner_state` read **again** | `:307` |
| S5 | `mastery.upsert` | `:315` |
| S6 | `mastery.update` | `:318` |
| S7 | `queueNext` — `fetchBank` (`:227`) or, on CLO close, `clos` + N parallel `fetchBank` + Planner + another `saveState` | `:200-264` |
| S8 | **`setStatus('passed')`** | `:330` |

Eight serial stages, one of them a full non-streamed LLM completion, before the word "Passed" appears. The button reads `"Checking…"` throughout (`src/app/(app)/exercise/[id]/page.tsx:66`).

**`next()`** (`:437-441`) then does `router.push`, remounting the whole hook and re-running W7 + W8 — even though the next exercise's full `ExercisePublic` was already in hand at `:264`.

### 1.5 `/derot` and `/derot/[kind]`

`/derot`: shared prefix, then **hop 10** `Promise.all([wellness.drill_results, drills.select('kind')])` (`src/app/(app)/derot/page.tsx:36-39`). That wellness read is the **third** on the page (layout `:47`, rail `:130`, here).

`/derot/[kind]`: shared prefix, then **hop 10** `Promise.all([drills.select('*').eq('kind'), wellness])` (`:50-53`) — `select('*')` pulls every drill body for the kind, then one is picked client-side at `:60`.

**Drill submit is not optimistic** (`:71-116`): read `wellness` (`:79`) → `update` (`:86`) → possibly `insert` (`:96`), and only then `phase:'result'` (`:99`). The score screen waits on two-to-three serial writes.

### 1.6 `/reports`

Shared prefix, then **hop 10** `fetchReportData` (`src/app/(app)/reports/data.ts:69-78`): `Promise.all([clos, wellness, fetchAllAttempts])`, where `fetchAllAttempts` (`:46-61`) is another sequential 1000-row pager that selects `id,exercise_id,code,results,passed,duration_ms,hint_count,created_at` (`:51`) — **every attempt's full source code and full per-test results JSON**, for a client-side render. The layout already paged the same table for `created_at` alone.

Loading state: one sentence, `reports/page.tsx:108` — *"Preparing your report."*

---

## 2. Loading, skeletons, optimistic updates

### 2.1 Where loading is a spinner or nothing

| Place | What is shown | Line |
|---|---|---|
| Any RSC navigation | **nothing** — no `loading.tsx` exists anywhere in `src/` | — |
| Dashboard course + exercises | one grey sentence | `dashboard/page.tsx:130,153,183` |
| Exercise open | a full-page text block, no editor shell | `exercise/[id]/page.tsx:25-29` |
| Runtime download | one line of text | `exercise/[id]/page.tsx:61` |
| De-rot overview | one grey sentence | `derot/page.tsx:119` |
| Drill open | one grey sentence | `derot/[kind]/page.tsx:164,214` |
| Report build | one grey sentence | `reports/page.tsx:108` |
| Agent thinking (fix plan) | one grey sentence | `FixPlanPanel.tsx:16` |
| PDF export | `Loader2` spinner | `DownloadReportButton.tsx:44` |
| Login | one grey sentence | `login/page.tsx:199` |

### 2.2 Where skeletons exist

Only three, and two are non-content:

- `src/app/(admin)/admin/AdminDashboard.tsx:23-31` — a real three-bar skeleton (admin only)
- `src/app/(app)/onboarding/page.tsx:253-263` — `StepLoading`, two pulsing bars, but it is a *status* block appended below the question, not a shape-matched skeleton
- `src/components/buddy/Drawer.tsx:150` — a pulsing text caret during streaming

**No skeleton exists on `/dashboard`, `/exercise`, `/derot`, `/reports`, or the wellness rail** — the five surfaces the owner actually used.

### 2.3 Optimistic updates — what exists

| Interaction | Optimistic? | Evidence |
|---|---|---|
| **Buddy send** | **Yes** — the user's message is appended before any network call, and the reply streams token-by-token | `buddy/Drawer.tsx:67-70,78-81`; `src/lib/agents/buddy.ts:66` (`streams:true`) |
| **Wellness prefs** | **Yes** — local `setPrefs` first, `persist` fire-and-forget | `wellness/Rail.tsx:173-177,160-171` |
| **Water / stretch log, pomodoro sessions** | **Yes** — same pattern | `Rail.tsx:183-193` |
| **Hint request** | **Partly** — the hint is spent and persisted *before* the await (`:402-406`), and the Coach streams partials into the panel | `useExerciseLoop.ts:403-407`; `FixPlanPanel.tsx:15`; `src/lib/agents/coach.ts:54` |
| **Diagnosis on failure** | **Partly** — Diagnoser streams (`streams:true`) so the fix plan fills in progressively | `useExerciseLoop.ts:285`; `src/lib/agents/diagnoser.ts:61` |

### 2.4 Optimistic updates — what is missing

| Interaction | What happens today | Evidence |
|---|---|---|
| **Attempt submit / pass** | **Nothing optimistic.** Test results are set at `:377`, then eight serial stages run, then `setStatus('passed')` at `:330`. Points, streak, mastery bar and the pass celebration all wait on a non-streamed LLM call. The local `applyPass`/`pointsForPass` math is pure and could run instantly. | `useExerciseLoop.ts:377,267-341,330`; `src/lib/learner/score.ts:16`; `src/lib/contracts.ts` (`pointsForPass`) |
| **Drill result** | **Nothing optimistic.** `phase:'result'` is set only after the wellness read + update round trip. | `derot/[kind]/page.tsx:73,99` |
| **De-rot streak** | Updated only after the write lands | `derot/[kind]/page.tsx:101-112` |
| **Course switch / plan** | Blocking modal-ish "Building your path" screen; no provisional path is shown | `onboarding/page.tsx:243-250` |
| **Onboarding answer** | Every option button is `disabled={busy}` while a full model call runs; the next question never appears provisionally, even though the deterministic next question is knowable client-side | `onboarding/page.tsx:187,193` |
| **Any navigation** | No `loading.tsx`, no route-level optimistic shell | — |

There is **no query cache of any kind** — no SWR, no TanStack Query, no `unstable_cache`, no Next `fetch` caching (every read is a Supabase client call, not `fetch`). Each `useEffect` refetches from zero on mount, and every remount (including `router.push` between exercises) starts over. The one deduplication mechanism present is the `key`-guard pattern in `useCurriculum` (`dashboard/page.tsx:35,68`) and `useReportData` (`reports/page.tsx:25,47`), which prevents *stale* renders but caches nothing.

---

## 3. Client bundle

`npm run build` → exit 0. Per-route client JS, computed from each route's `page_client-reference-manifest.js` against on-disk chunk sizes (uncompressed):

| Route | Client JS | Chunks | Heaviest contributors |
|---|---:|---:|---|
| `/preview` | **1848 KB** | 13 | CodeMirror 658, adhan 457, supabase 241+226 |
| `/exercise/[id]` | **1593 KB** | 13 | CodeMirror 658, adhan 457, supabase 226 |
| `/derot/[kind]` | **926 KB** | 11 | adhan 457, supabase 226 |
| `/reports` | **896 KB** | 10 | adhan 457, supabase 226 |
| `/onboarding` | **891 KB** | 10 | adhan 457, supabase 226 |
| `/account` | **890 KB** | 10 | adhan 457, supabase 226 |
| `/dashboard` | **887 KB** | 10 | adhan 457, supabase 226 |
| `/derot` | **881 KB** | 10 | adhan 457, supabase 226 |
| `/login` | 338 KB | 7 | supabase 226 |
| `/admin` | 199 KB | 7 | — |
| `/` | 70 KB | 4 | — |

`.next/static` total: 7.7 MB.

### Heavy libraries on first paint

1. **`adhan` — 457 KB, chunk `2nsqw184k8pg1.js`, on 7 of 8 app routes.** Statically imported at `src/lib/wellness/prayer.ts:10` for `computeFallback` (`:113-129`), which only runs when the Aladhan API call at `:143-144` fails. It reaches every route through `prayer.ts` → `Rail.tsx:10` → `WellnessSlot.tsx:4` → `AppShell.tsx:8,49`. **This is the single biggest cheap win in the bundle: half a megabyte of astronomy shipped to a page that shows an exercise list, to cover a fallback path.**
2. **CodeMirror + five language packs — 658 KB, chunk `26jtfioh4kpkr.js`, on `/exercise`.** `src/components/exercise/Editor.tsx:6-12` statically imports `basicSetup` plus `lang-python`, `lang-javascript`, `lang-html`, `lang-sql` **and** `lang-java` for every exercise, whatever its language, and `Editor` is a static import in the page (`exercise/[id]/page.tsx:10`). A Python exercise pays for the SQL, HTML and Java grammars.
3. **Supabase client — 226 KB + 241 KB, on every authenticated route.** Expected; one of the two is the auth-helper split.
4. **Correctly lazy, leave alone:** `jspdf` + `html2canvas-pro` (418 + 248 + 198 KB) are behind a dynamic import in `src/components/report/pdf.ts` and do not appear in `/reports`' 896 KB. `mingo` (107 KB) and the 3.4 MB `sql.js` worker chunk (`1bu43xunukcw-.js`, reached only via `2e_n_8srimmpi.js`) are worker-only and load on demand. Pyodide is CDN-loaded inside the worker, never bundled.
5. **Dead weight in `package.json`:** `gsap`, `@gsap/react`, `motion` — installed, zero imports in `src/`. `next-themes` — one import, in `src/components/ui/sonner.tsx:3`, with no `ThemeProvider` mounted anywhere.

### Static assets

`public/` is **37 MB**: `public/java/tools.jar` 18 MB + `public/java/*.wasm` 616 KB, and `public/spikes/cheerpj` 18 MB. Only `public/spikes/cheerpj/tools.jar` is gitignored; `git check-ignore public/java/tools.jar` returns 1 (**not ignored**) though it is currently untracked. `public/java/*` is consumed only by `e2e/java/probe.spec.ts:8` and is generated by `scripts/fetch-java-tools.mjs`; `public/spikes/*` only by `e2e/spikes/cheerpj.spec.ts`. Neither is referenced from `src/`. Both are spike leftovers that would be uploaded on a Vercel deploy.

---

## 4. Copy that sounds like a teacher, and the lockdown copy

### 4.1 Teacher voice — the pattern

The dominant construction across the app is **second-person-possessive + reassurance**: "Your …" appears as the opening word of 30+ user-facing strings. It reads as a careful institution, not a bro. A representative census:

| Line | String |
|---|---|
| `dashboard/page.tsx:19` | "Your next exercises are still being prepared." |
| `dashboard/page.tsx:106` | "Your next step starts here." |
| `dashboard/page.tsx:107` | "Choose a course and make space for your first small win." |
| `dashboard/page.tsx:114` | "Find your starting point." |
| `dashboard/page.tsx:115` | "Your saved progress is kept below." |
| `dashboard/page.tsx:115` | "A course gives your practice a direction. You can change it anytime." |
| `dashboard/page.tsx:107` | "A little practice. A clearer understanding." |
| `dashboard/page.tsx:125` | "One day at a time." / "Your first pass starts it." |
| `dashboard/page.tsx:126` | "Attention takes practice." / "Make time for a short drill." |
| `dashboard/page.tsx:127` | "Earned through practice." |
| `dashboard/page.tsx:130` | "Loading your course and exercise details. Your saved progress is ready." |
| `dashboard/page.tsx:153` | "Your recommendations are on their way." |
| `dashboard/page.tsx:154` | "Once your course and learning profile are ready, your next three exercises will appear here." |
| `dashboard/page.tsx:183` | "Practice across different patterns to build confidence in each outcome." |
| `dashboard/page.tsx:187` | "Train your attention with a short coding drill." |
| `onboarding/page.tsx:193` | "Finding your next question." |
| `onboarding/page.tsx:204` | "You can change this anytime from your dashboard." |
| `onboarding/page.tsx:247` | "Preparing your plan." |
| `exercise/[id]/page.tsx:26` | "Opening your exercise" |
| `exercise/[id]/page.tsx:27` | "Loading your prompt and starting code." |
| `exercise/[id]/page.tsx:74` | "Outcome complete. Your next steps are ready." / "Your pass is saved." |
| `ResultsPanel.tsx:11` | "Run to explore your output, or submit when you are ready to check your work." |
| `ResultsPanel.tsx:19` | "Needs work" (the failure label) |
| `ResultsPanel.tsx:20` | "The result does not match." |
| `HintButton.tsx:12` | "Use your fix plan to guide the next attempt." |
| `FixPlanPanel.tsx:16` | "Thinking through your work…" |
| `derot/page.tsx:110` | "Short drills to keep your attention sharp between exercises." |
| `derot/page.tsx:116` | "Finish one drill today to start your streak." |
| `derot/page.tsx:85` | "Not attempted yet. Give it a try." |
| `reports/page.tsx:103` | "Mastery per outcome, patterns passed, mistakes over time, time spent, and your de-rot scores." |
| `login/page.tsx:185` | "Sign in to your coding space." |
| `login/page.tsx:199` | "Your coding space is ready. Preparing sign-in…" |
| `app/error.tsx:8-9` | "Your progress is still yours." / "We could not load this part of your learning space." |
| `Pomodoro.tsx:79` | "Work block complete. Time for a short break." |
| `WaterStretch.tsx:47-48` | "Take a sip of water." / "Stand up and stretch for a moment." |
| `PredictOutput.tsx:10` | "Read the snippet and type what it prints." |
| `SpotTheBug.tsx:12` | "Select every line that contains a bug." |
| `Trace.tsx:12` | "Enter each variable's value at the step described in the task." |
| `buddy/Drawer.tsx:119` | "Coding and improvement only." |
| `buddy/Drawer.tsx:128` | "Ask about the code you are stuck on, or why a pattern keeps failing." |

Domain vocabulary reinforces it: **"outcome," "mastery," "learning outcome," "curriculum," "Difficulty 3 of 5," "Draft outcome"** are surfaced raw to the learner (`dashboard/page.tsx:113,163,176,147`; `PromptPanel.tsx:33`).

### 4.2 Warning / enforcement copy

| Line | String | Note |
|---|---|---|
| `useLockdown.ts:87` | **"Type it. That's the whole point."** | The entire paste-block response. Ephemeral (3.5 s, `:89`), grey, no explanation, no alternative. |
| `AccountNotice.tsx:16` | "Type your own work. Clipboard attempts and leaving an exercise are recorded." | The `warned` banner — surveillance framing. |
| `AccountNotice.tsx:17-19` | "Exercises are paused until … (Doha). Your dashboard and De-rot remain available." | |
| `AccountNotice.tsx:6-7` | "Your BroGram account has been banned." / "Contact Velocity through your invitation email to appeal." | |
| `exercise/[id]/page.tsx:54` | "Type your own work" | A permanent grey label pinned to the editor header. |
| `exercise/[id]/page.tsx:84` | "Exercises are paused" / "Your account cannot open an exercise right now." | |
| `dashboard/page.tsx:143` | "Exercises are paused while your account is restricted." | |
| `useExerciseLoop.ts:170` | "Exercises are paused for this account. Return to your dashboard." | |
| `LockdownOverlay.tsx:17` | "Come back to continue" (blur/idle) / **"Keep your work here"** (printscreen) | |
| `LockdownOverlay.tsx:19` | "Return to this window to resume your exercise." / "Your exercise is still here. Move your mouse or press a key when you are ready." / **"Your exercise will return in a moment."** | |
| `HoldFocus.tsx:105` | "Read the passage without scrolling, then answer the question. Leaving the page voids the drill." | |
| `HoldFocus.tsx:125` | "Focus lost. The drill was voided." | |
| `SpeedType.tsx:75` | "Type the snippet exactly. Accuracy matters more than speed; pasting is disabled." | |

**The PrintScreen guard is theatre, provably** (`useLockdown.ts:131-141`): it listens on `keyup`, which fires *after* the operating system has already captured and copied the screen; it then shows an opaque overlay for 2000 ms (`:136`) and attempts `navigator.clipboard.writeText('')` (`:138`) inside a `try` that swallows the near-certain permission failure (`:139-140`). It cannot prevent a screenshot, cannot reliably clear the clipboard, and interrupts the learner for two seconds. Its only real product is one `integrity_events` row (`:134`) — which is legitimately useful and should survive; the overlay is what does not.

The **paste block itself is sound** (`containerProps.onPaste` → `preventDefault` + log, `:180`) — it is the one-line grey response that fails, not the mechanism.

---

## 5. Keep list — what v2 must not rewrite

Everything below is covered by the 840 passing tests and is either a frozen contract, correct-by-review math, or hard-won runtime work. **None of it is implicated in the owner's complaints.**

### 5.1 Frozen contracts
- `src/lib/contracts.ts` — the whole file. `LOCKDOWN` (`:523`), `INTEGRITY_WEIGHTS`/`INTEGRITY_THRESHOLDS` (`:211,220`), `AGENT_TOKEN_BUDGETS` (`:288`), `pointsForPass`, `nextMasteryScore`, every request/reply interface. Changes need a contracts PR.
- `src/lib/contracts.test.ts`.

### 5.2 The agent route and the seven agent modules
- `src/app/api/agent/route.ts` — DeepSeek-only, `deepseek-v4-flash` (`:12`), thinking disabled for token budget (`:16-19`), server-side hydration of reference solutions and author examples with the service key (`:36-55`), usage recording (`:63-66`), rate-limit gate (`:33-34`).
- `src/lib/agents/{profiler,planner,author,diagnoser,coach,reviewer,buddy}.ts` + `index.ts`, `shared.ts`, `requests.ts`, `ratelimit.ts`, `client.ts`, and `fixtures/profiler-fallback.json`.
- The deterministic `fallback()` implementations, especially `profiler.ts:117-129` — v2 should *promote* this to the primary path, not delete it.
- The SSE streaming client `src/lib/agents/client.ts:29-72`.
- Tests: `src/lib/agents/*.test.ts`, `src/app/api/agent/route.test.ts`, `route.live.test.ts`.

### 5.3 Learner-state math
- `src/lib/learner/compile.ts`, `score.ts` (`applyPass`/`applyFail`), `chain.ts` (`nextInChain`, `withPatternAtEnd`), `integrity.ts` (weighted escalation), `trim.ts`.
- `src/lib/learner/*.test.ts`.

### 5.4 Bank query and selection
- `src/lib/learner/bank.ts` — `toExercisePublic` (`:25`), the widening-tier `pickFromBank` (`:54-83`), `fetchBank` with its server-side `verified` filter (`:93-97`), `BANK_VIEW`, `DEFAULT_DIFFICULTY`.
- `src/lib/learner/bank.test.ts`.

### 5.5 Browser runtimes
- `src/lib/runtimes/*` in full: `worker-adapter.ts` (active/standby slots, per-test deadlines, abort/promote), `worker-host.ts`, `pyodide{,-engine,.worker}.ts`, `js*`, `sql*`, `mongo*`, `web*`, `java-normalize.ts`, `judge.ts` (flag-off), `progress.ts`, `shared.ts`.
- `src/lib/exercise/grading.ts` (`gradeAnswer`, `exerciseRunRequest`, `codeDiff`, `usesAnswerForm`).
- `scripts/copy-sqljs-wasm.mjs` + the `postinstall` hook, and `public/sql-wasm.wasm`.
- Tests: `src/lib/runtimes/*.test.ts`, `src/lib/exercise/grading.test.ts`.

### 5.6 Lockdown logging (the mechanism, not the copy)
- `src/hooks/useLockdown.ts` — the per-type coalescing and 1 s batched insert (`:50-82`), the `logIntegrity` dedupe (`:84-104`), the blur/visibility/idle listener set (`:106-171`), `containerProps` paste/copy/cut/contextmenu blocking (`:179-185`), the `during_attempt` capture (`:101`), the insert-only table discipline (`:74`).
- Keep the `printscreen` **event log** (`:134`); drop the 2 s overlay.
- `src/hooks/useLockdown.test.tsx`, `e2e/blur-overlay.spec.ts`.

### 5.7 Admin surface
- `src/app/(admin)/**` and `src/components/admin/**` — `UsersTable`, `InvitesTable`, `MintInviteForm`, `CreateAccountForm`, `BankStatsTable`, `AgentUsageTable`, `StatusBadge`.
- `src/app/api/admin/**` (users, users/create, users/[id]/status, invites, bank-stats, agent-usage) and `src/lib/admin/{gate,paginate}.ts`.
- All matching `*.test.ts(x)`. This is also the only surface that already has a real loading skeleton (`AdminDashboard.tsx:23-31`).

### 5.8 Auth, proxy and Supabase plumbing
- `src/lib/supabase/{client,server,middleware}.ts`, `src/proxy.ts`, `src/app/auth/{confirm,signout}/route.ts`, `src/store/session.ts`, `src/components/shell/SessionProvider.tsx`.
- The header-forwarding contract between proxy and layout (`middleware.ts:16-22` ↔ `layout.tsx:16-22`) — v2 should *use* it to delete the duplicate `getUser()`, not replace it.
- `supabase/templates/*`, `scripts/supabase-auth-config.mjs`.

### 5.9 Migrations and seed
- `supabase/migrations/0001_init.sql` … `0005_hook_allowlist.sql` — 14 tables, RLS policies (`0001:161-176`), `is_not_banned()`/`can_attempt()`, `exercises_public` view, the integrity escalation trigger (`0004:15`), the signup allowlist hook (`0005:6`), `lift_expired_restriction`.
- `supabase/config.toml`.
- `seed/{courses,clos,patterns}.json`, `seed/exercises/`, `seed/drills/`, `seed/validate.mjs`, `scripts/seed-load.mjs`, `scripts/verify-exercise.mjs`.
- `src/app/api/exercises/verify/route.ts`, `src/app/api/judge/route.ts`.

### 5.10 De-rot drill engines and the report renderer
- `src/components/derot/**` — `DrillRunner`, `NBack`, `HoldFocus`, `PredictOutput`, `SpotTheBug`, `SpeedType`, `Trace`, `scoring.ts`, `useCountdown.ts`, and `src/app/(app)/derot/lib.ts` (`pickDrillItem`, `computeDerotStreak`, `DRILL_META`). The *scoring and item selection* survive even though the presentation is being rebuilt.
- `src/components/report/**` — `ReportPages`, `derive.ts`, `pdf.ts` (dynamic-import discipline), the six section components, `DownloadReportButton`.
- `src/lib/wellness/{timers,prayer}.ts` — the pure timer math (`timers.ts:4`, derived-from-now, no interval counting) and the Aladhan+cache+fallback logic. Keep the logic; make the `adhan` import dynamic.

### 5.11 Tests — the whole safety net
- **91 vitest files, 840 tests, green.** `vitest.config.mts`.
- `e2e/invite-to-first-exercise.spec.ts`, `e2e/fail-fix-pass.spec.ts`, `e2e/blur-overlay.spec.ts`, `playwright.config.ts`, `e2e/support/`.
- `src/app/preview/**` — the offline fixture-driven preview harness (`fixtures.ts` + 8 section components). It is the fastest way to iterate on v2 visuals without a database, and its 1848 KB never reaches a learner: `src/app/preview/layout.tsx:11` calls `notFound()` outside `NODE_ENV === 'development'` (the chunks are still built, just unreachable).

---

## 6. Two conclusions worth stating plainly

**The sluggishness is not one slow thing; it is the absence of three cheap habits.** Nothing is cached, nothing is server-rendered with data, and nothing is optimistic. Every screen re-derives its world from zero on every mount, behind a 5-to-9-hop waterfall, behind ~880 KB of JS, with a grey sentence where a skeleton should be. The two heaviest individual offenders — the layout's full attempt-history pager (`layout.tsx:35-44`) and the 457 KB static `adhan` import (`prayer.ts:10`) — are each a few lines of change.

**The re-onboarding is a one-line routing bug, not a design problem.** `onboarding/page.tsx:47` initializes to `'question'` and never consults `profile.onboardingComplete`, which the same file sets to `true` at `:158`. The contract already has exactly one trigger for "course switched" — `plan-refresh`, owned by the Planner, not the Profiler (`src/lib/contracts.ts:300-307`). The correct path is already modelled; the UI just does not take it. And the 13 questions behind it are, today, already computable with zero model calls by a function that ships in the bundle (`profiler.ts:117-129`).
