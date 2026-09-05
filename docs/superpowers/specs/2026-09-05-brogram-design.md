# BroGram Design Spec

**Date:** 2026-09-05
**Owner:** Musa (Velocity)
**Builders:** Claude Code (Claude lane) + Codex plugin running GPT-6 Astra (Astra lane)
**Status:** Approved in conversation, section by section. This document is the source of truth for the first build.
**Companion files:** `docs/contracts/brogram-contracts.ts` (types both lanes import), `seed/*.json` (curriculum), `docs/superpowers/plans/2026-09-05-brogram-build-plan.md` (execution), `docs/prompts/*` (operating prompts).

---

## 1. What BroGram is

BroGram is a free, open-source (MIT), all-in-one coding tutor for university students. It teaches by making students write code against course learning outcomes (CLOs), grades locally in the browser, and puts a small team of specialised agents around the student: one profiles how they learn, one plans their path, one writes exercises, one diagnoses failures, one hints without ever coding for them, one reviews passes, and one chats about coding only. Around that core it keeps the student healthy (prayer, water, stretches, pomodoro), trains their attention (de-rot drills and mind games), locks the exercise screen against cheating, and exports a progress report.

Brand: **Velocity**. The product is never branded with or mentions any institution. Course codes are internal keys only.

### Non-negotiables (decided, do not relitigate)

1. **All seven subsystems ship in v1.** Onboarding agents, CLO curriculum, exercise loop, live coding environment with hinting agent, lockdown with auto-ban, wellness plus de-rot, reports plus buddy. Content is thin at launch; surface area is not.
2. **Stack:** Next.js (App Router, TypeScript) on Vercel; Supabase (auth, Postgres, RLS); DeepSeek for every agent call. No other LLM provider.
3. **Client-heavy:** the browser runs code, grades tests, diffs attempts, renders reports, runs timers and drills. Vercel exists only to call DeepSeek and to proxy the Java judge. Supabase only persists.
4. **Code execution:** browser-first behind one `RuntimeAdapter` interface. Java is the single language routed through a hosted judge from day one. The judge is Judge0 CE on RapidAPI at launch (the public Piston API went whitelist-only in February 2026), behind a `JUDGE_PROVIDER` switch so a self-hosted Piston can replace it later. The judge route exists for every other language but is disabled by an environment flag until user load justifies it.
5. **Agents are learner-state specialists.** One Learner State document per student; each agent reads a slice and returns a delta; agents never call each other.
6. **Exercise source is a hybrid bank.** As many exercises as possible are generated offline (in Claude Code / Codex sessions, on plan credits), labelled, reviewed, and committed as seed data. Only hints, diagnoses, reviews, and bank-miss variants are generated at runtime.
7. **Auth:** magic link only. Sign-up allowed only for emails ending in `.edu.qa`, permanently. Invite-only during beta via an invites table; the invite check is a flag that turns off later, the domain check never does.
8. **Lockdown:** blank on blur, 15-second no-input blur, paste/copy/cut/context-menu blocked, PrintScreen best-effort, every event logged, weighted auto-escalation to warn, restrict, ban.
9. **Language:** English UI, English agents. No Arabic, no RTL.
10. **Model routing for the build itself:** Claude subagents on Sonnet 5 or Opus 5 at max effort; Fable 5.1 only when strictly necessary. Codex on `gpt-6-astra` at `ultra` (inherited from the Codex config; never override).
11. **Deadline:** deployed to Vercel and Supabase with real invited users by 19:00 Doha time on 2026-09-05, then one week of daily pilot feedback.

---

## 2. Users and auth

- **Who:** students at Qatari universities. Beta cohort is hand-picked by Musa.
- **Sign-up gate (server-side, two layers):**
  1. Supabase auth hook that fires before a user is created rejects any email that does not end in `.edu.qa`.
  2. While `INVITES_REQUIRED=true`, the same hook also requires an unredeemed row in `invites` matching the email exactly. On success it marks the invite redeemed in the same transaction.
- **Sign-in:** magic link (email OTP link) via `@supabase/ssr`. No passwords ever.
- **Account status** lives on `profiles.account_status` (`active | warned | restricted | banned`). RLS reads it: a `banned` user cannot select from `exercises`, `attempts`, or `learner_state`; a `restricted` user cannot insert into `attempts` until `restricted_until` passes. The client also checks it for UX, but the server is the authority.
- **Admin:** Musa's user id is listed in `ADMIN_USER_IDS`. Admin pages are gated by that list server-side. Admin is exempt from integrity scoring.

---

## 3. System shape

Three tiers, sorted by where work runs.

**Browser**
- Runtime adapters: Pyodide (Python incl. numpy, pandas, matplotlib, scikit-learn), native JS/TS (in a Worker), sandboxed iframe (HTML/CSS/JS pages with DOM assertions), sql.js (SQL), a MongoDB-query-language engine in JS (Mongo).
- Grading: every test case is executed and compared locally. Results are written to Supabase as an attempt row.
- Learner State mirror: loaded once at session start, updated after every attempt, written back with optimistic versioning.
- Lockdown hook, idle/blur overlays, hint cooldown timer.
- Wellness timers, prayer fetch, water/stretch/pomodoro.
- De-rot drills, entirely local.
- PDF report rendering.
- Bank queries (Supabase select with filters) and the "which pattern next" logic.

**Vercel (Route Handlers, Node runtime)**
- `POST /api/agent`: the only DeepSeek caller. Validates the request against the contracts, slices Learner State, builds the prompt, enforces the per-agent token budget, calls DeepSeek with JSON mode, validates the reply, retries once on invalid JSON, returns a safe fallback on the second failure. Streams for `coach`, `diagnoser`, `buddy`.
- `POST /api/judge`: proxies to the configured judge provider (Judge0 CE at launch). Always on for `java`; returns `503 judge-disabled` for other languages unless `JUDGE_ALL_LANGUAGES=true`.
- `POST /api/exercises/verify`: flips `verified=true` on a generated exercise the caller authored, after the browser ran its reference solution against its tests. Service key, ownership checked.
- `POST /api/admin/*`: invite minting, lift/restrict/ban, usage and bank stats. Gated by `ADMIN_USER_IDS`; an empty list denies everyone.
- Nothing else. No SSR data fetching on hot paths; pages are client components once authenticated.

**Supabase**
- Auth with the before-user-created hook and magic links.
- Postgres tables (section 4), migrations committed in the repo and applied with the Supabase CLI.
- RLS on every table. Service key used only by the Vercel routes that must write across users (invite redemption, admin actions, bank inserts from the Author agent).
- No realtime subscriptions, no storage buckets in v1.

**Agent cost rule, enforced in code:** an agent call fires only on these seven triggers: `onboarding-answer`, `plan-refresh` (onboarding done, CLO closed, course switched), `bank-miss`, `attempt-failed`, `hint-requested`, `attempt-passed`, `buddy-message`. A call on a keystroke, timer, or page load is a bug and a test asserts the client never does it.

---

## 4. Data model

All ids are `uuid` except CLO/course/pattern keys which are text. Timestamps are `timestamptz`. Every user-owned table has `user_id uuid references auth.users` and an RLS policy "owner reads and writes own rows".

| Table | Purpose | Key columns |
|---|---|---|
| `profiles` | one per user | `id` (= auth user id), `display_name`, `account_status`, `restricted_until`, `invite_code`, `is_admin` (derived from env, not stored), `created_at`, `last_seen_at` |
| `invites` | beta gate | `code`, `email` (lowercase, unique), `created_by`, `redeemed_by`, `redeemed_at` |
| `courses` | seeded from `seed/courses.json` | `code` pk, `slug`, `title`, `language`, `secondary_language`, `runtime`, `level`, `prerequisites text[]`, `topics text[]`, `clo_ids text[]`, `status`, `packages text[]` |
| `clos` | seeded from `seed/clos.json` | `id` pk, `course`, `ordinal`, `outcome`, `topics text[]`, `prerequisites text[]`, `patterns text[]`, `assessable_in_code`, `draft` (true for CLOs drafted without a syllabus) |
| `patterns` | seeded from `seed/patterns.json` | `id` pk, `name`, `description`, `family` |
| `exercises` | the bank | `id`, `clo_id`, `language`, `kind`, `difficulty`, `pattern`, `title`, `prompt`, `starter_code`, `tests jsonb`, `reference_solution`, `origin`, `parent_exercise_id`, `author_user_id` (null for seed), `verified` (true for seed; false until the author's browser verified a generated row), `tags text[]`, `fixture`, `created_at`. **No client role has SELECT on this table.** Clients read `exercises_public`; only the service key writes. |
| `attempts` | every submission | `id`, `user_id`, `exercise_id`, `code`, `results jsonb`, `passed`, `duration_ms`, `hint_count`, `created_at` |
| `mastery` | per user per CLO | `user_id`, `clo_id`, `score`, `chain`, `patterns_passed text[]`, `closed`, `last_attempt_at`; pk `(user_id, clo_id)` |
| `learner_state` | one JSON doc per user | `user_id` pk, `state jsonb`, `version int`, `updated_at`. Write requires `version = current + 1` (enforced by a trigger). |
| `integrity_events` | lockdown log | `id`, `user_id`, `type`, `exercise_id`, `during_attempt`, `created_at`. Users can insert own rows, cannot read or delete. Admin reads all. |
| `wellness` | one row per user | `user_id` pk, `prefs jsonb`, `pomodoro_sessions jsonb`, `water_log jsonb`, `drill_results jsonb`, `updated_at` |
| `buddy_messages` | chat history, capped client-side to last 50 | `id`, `user_id`, `role`, `content`, `created_at` |
| `drills` | de-rot items seeded from `seed/drills/*.json` | `id` text pk, `kind`, `language`, `difficulty`, `time_limit_s`, `payload jsonb`. Readable by non-banned users. |
| `agent_usage` | one row per agent call, written by the agent route with the service key | `id`, `user_id`, `agent`, `trigger`, `prompt_tokens`, `completion_tokens`, `cache_hit_tokens`, `fallback`, `created_at`. Admin reads via a service-key route; users never. |

**Derived, not stored:** integrity score (computed from the last 7 days of events with `INTEGRITY_WEIGHTS`), points (sum over attempts), streaks (computed from attempt and drill dates). The Learner State caches these values for the agents; the client recomputes on load.

**RLS specifics**
- `exercises`: SELECT is revoked from `anon` and `authenticated` outright. The view `exercises_public` runs with owner rights (no `security_invoker`), omits `reference_solution`, and filters `where public.is_not_banned() and (origin = 'seed' or author_user_id = (select auth.uid()))`. `authenticated` gets SELECT on the view only. Hidden tests keep their `expected` values in the view because the browser is the grader; "hidden" means not displayed, and the real wall is per-student variants (section 9). The Reviewer, Diagnoser, and Author get reference solutions server-side through the agent route with the service key, never from the client.
- `profiles`: UPDATE is revoked from `authenticated` and re-granted only on `display_name` and `last_seen_at`; a trigger rejects any change to `account_status`, `restricted_until`, or `invite_code` not made by the service role. Restriction lifts happen only through admin routes or the `lift_expired_restriction()` function called on app load.
- `attempts`: `insert` allowed when status is `active` or `warned`, or `restricted` with `restricted_until < now()`.
- `integrity_events`: `insert` own, no `select` for non-admins.
- `learner_state`: owner select/update; trigger rejects a write whose `version` is not exactly `current + 1`.

---

## 5. Learner State

The one document every agent reads. Shape is `LearnerState` in the contracts file. Rules:

- The browser owns it. It is rebuilt after every attempt from local data plus the server rows, then written back with `version + 1`. A version conflict reloads from the server and replays the local delta.
- Agents receive a **slice**, never the whole thing. The slice per agent is fixed in the route, not chosen by the client:
  - Profiler: `profile`, `version`.
  - Planner: `profile.motivation`, `mastery`, `recentMistakes`, `currentCourse`.
  - Author: `profile.learningStyle`, `profile.verbosity`, `recentMistakes` (labels only).
  - Diagnoser: `profile.tone`, `profile.verbosity`, `recentMistakes`.
  - Coach: `profile.tone`, `profile.verbosity`.
  - Reviewer: `profile.tone`, `profile.verbosity`, `mastery[cloId]`.
  - Buddy: `profile`, `mastery` (summary counts), `recentMistakes`, `streak`.
- `recentMistakes` holds at most 10 entries. When a prompt exceeds its budget, the route trims from the oldest mistake first, then the oldest buddy messages, then hidden test details. It never trims the student's current code.
- `integrityScore` and `accountStatus` are in the state so the Buddy can say "you were restricted, here is why" without another call.

---

## 6. Agent layer

Seven specialists. Each is one module under `lib/agents/<name>.ts` exporting `buildPrompt(req)`, `replySchema` (Zod), `slice(state)`, and `fallback(req)`. The route is the only DeepSeek caller.

| Agent | Trigger | Reads | Returns | Streams |
|---|---|---|---|---|
| Profiler | `onboarding-answer` | answers so far, phase | next question or done, profile delta | no |
| Planner | onboarding done, CLO closed | motivation, mastery, mistakes, bank candidates | ordered CLO path, next 3 exercise ids, one-line focus | no |
| Author | `bank-miss` | CLO, pattern, difficulty, 2 style examples, optional parent | complete exercise with tests and reference | no |
| Diagnoser | `attempt-failed` | failed code, results, last 5 mistakes | intent, root cause, mistake label, 3 to 6 step fix plan | yes |
| Coach | `hint-requested` | diff since last hint, current code, fix plan, hints so far | one hint, optional single code line, plan step | yes |
| Reviewer | `attempt-passed` | passing code, reference, hint count, duration | two improvements, quality 0..100, praise | no |
| Buddy | `buddy-message` | profile, mastery summary, mistakes, streak, last 6 messages | on-topic flag, reply, optional suggestion | yes |

**Rules across all seven**
- **JSON only.** DeepSeek is called with JSON output mode and a schema description in the system prompt. Reply is parsed and validated with Zod. Invalid → one retry with the validation error appended. Invalid again → `fallback(req)` returns a safe, renderable object and `fallback: true`.
- **Token budgets** are `AGENT_TOKEN_BUDGETS` (Profiler/Planner/Buddy 2,000; Author 4,000; Diagnoser/Coach/Reviewer 8,000; hard ceiling 12,000). Counted with a tokenizer approximation before the call; trimmed per the Learner State rule.
- **Coach cannot code.** The reply schema allows an optional `codeLine` that must be a single line under 80 characters with no newline. Anything else fails validation. The prompt also says it, but the schema is the guarantee.
- **Buddy off-topic gate.** The first field in Buddy's JSON is `onTopic`. The system prompt defines on-topic as coding, computer science, study technique for coding, and BroGram itself. When `onTopic` is false, `reply` must be the fixed refusal sentence and the client renders it without the streaming cursor.
- **Tone injection.** Every prompt ends with two sentences generated from the profile: one for tone (`playful | supportive | tough-love | direct`), one for verbosity (`short | verbose`). Nothing else about style.
- **Prompt caching.** The system prompt for each agent is static and placed first; the Learner State slice second; the volatile payload last. DeepSeek's context cache then hits on the static prefix.
- **Rate limits.** Per user: Coach at most one call per 60 seconds and 5 per exercise; Buddy at most 20 messages per hour; Author at most 10 bank-miss generations per hour. Enforced in the route with a small in-memory token bucket keyed by user id, and backstopped by a count query for Author.
- **Author output is validated by execution.** The agent route holds the Zod-validated Author reply, inserts it with the service key as `origin='generated'`, `author_user_id` = the requesting student, `verified=false`, and returns it (with the reference solution, for this one purpose) to that client. The client runs the reference against the tests in its runtime (Judge0 for Java). On success it calls `POST /api/exercises/verify` and the row becomes `verified=true`; on failure it abandons the row and falls back to the closest bank exercise. At launch a generated row is visible only to its author (the view filters on `author_user_id`); sharing verified generated rows with other students needs server-side verification and is pilot-week work (section 17).

**Why this is distinctive.** The intelligence is in three artifacts that have nothing to do with which model runs: the Learner State schema, the trigger and slicing rules, and the pattern taxonomy. Replace DeepSeek tomorrow and the product does not change.

---

## 7. Exercise bank and the loop

### 7.1 Bank

- Seed exercises are generated offline with the Author prompt, executed against their own tests, reviewed, and committed to `seed/exercises/<course>.json`. Target at launch: at least 3 exercises per pattern per code-assessable CLO, 3 difficulties spread, which is roughly 250 to 350 exercises across the six courses. Generation is a workflow script (`docs/workflows/exercise-bank-generation.js`), one agent per CLO, with an executor step that runs the reference solution in a real runtime before accepting it.
- Runtime-generated exercises are inserted with `origin='generated'`, `parent_exercise_id`, and `author_user_id` set, and at launch are visible only to the student they were generated for.
- **Bank query** (client-side, Supabase select on `exercises_public`, rows mapped to `ExercisePublic` by `toExercisePublic`): `clo_id = ?`, `difficulty between target-1 and target+1`, `pattern in (preferPatterns)`, `id not in (recent)`. If empty, drop the pattern preference. If still empty, widen difficulty to ±2. If still empty, any unseen exercise on the CLO. Only then `bank-miss` → Author.
- **Launch bank size:** the seed workflow runs with one exercise per pattern per CLO on launch day (about 100 exercises across the six courses, verified by execution) plus the five hand-written smoke exercises. The three-per-pattern run is queued during the pilot week.

### 7.2 The loop

1. **Pick.** Dashboard shows the Planner's three. Student taps one, or picks any CLO from the course grid.
2. **Attempt.** Exercise screen: prompt panel, editor with paste blocked, Run (free run, no grading, shows stdout), Submit (runs all tests). Timer starts on first keystroke.
3. **Fail.** Attempt row written. Diagnoser streams intent, root cause, fix plan into the side panel. Mistake label appended to Learner State. The first hint after a failure unlocks when the student edits or 60 seconds pass, whichever first; every later hint requires 60 seconds since the last Coach call. Each hint sends the diff since the last hint to the Coach. Max 5 hints per exercise. Student edits and resubmits. Loop.
4. **Pass.** Attempt row written. Reviewer returns two improvements and a quality score. Points added (`pointsForPass`). Mastery updated (`nextMasteryScore`), pattern appended to `patternsPassed`, `chain + 1`.
5. **Chain rule.** Immediately queue the next exercise on the **same CLO with a different pattern** the student has not passed in this chain. Three consecutive passes with three distinct patterns closes the CLO. Any fail resets `chain` to 0 but not `score` or `patternsPassed`.
6. **Close.** CLO closed → Planner runs → dashboard updates path and next three. Reviewer praise line shows once.
7. **Difficulty.** Starts at 3 for everyone. Planner lowers to 2 only after two consecutive fails on the same CLO, raises to 4 after a chain closes with zero hints.

### 7.3 Exercise kinds

- `code`: hidden tests; student writes code.
- `predict-output`: student types the exact output; graded by normalized string compare.
- `spot-the-bug`: student clicks a line; graded by line number set.
- `trace`: student fills variable values at a step; graded by exact match per cell.
- `schema`: student writes DDL or class skeletons; graded by structural checks in the runtime (table exists, column types, keys).

Non-code-assessable CLOs (three of the 26) use `predict-output`, `spot-the-bug`, and `trace` only.

---

## 8. Code execution

One interface, `RuntimeAdapter` in the contracts. Adapters live in `lib/runtimes/<language>.ts`, each in a Web Worker so the UI never blocks and a timeout can terminate the worker.

| Language | Engine | Notes |
|---|---|---|
| python | Pyodide | Loaded once per session from CDN in a worker. `packages` from the course are loaded on course open, with a progress bar. stdout/stderr captured via `setStdout`. Tests call a `solve` function or run the whole script with stdin, per `TestCase.input`. |
| javascript / typescript | Worker `new Function` with TS stripped by a lightweight transpiler | Console captured. |
| web | sandboxed `<iframe sandbox="allow-scripts">` | Fixture is the HTML shell; tests are DOM assertions run inside the iframe and posted back. |
| sql | sql.js | Fixture is the setup DDL/DML; tests are queries whose results are serialized and compared. |
| mongo | in-memory Mongo-query engine | Fixture is a JSON collection seed; tests run `find`, `update`, `aggregate` and compare serialized results. |
| java | Judge0 CE via `/api/judge` | Fixture is a test harness `Main.java` that calls the student's class; stdout compared. `language_id` 62. 10-second timeout. `JUDGE_PROVIDER=judge0` at launch, `piston` later. |

Timeouts: 5 s per test for browser runtimes. On expiry the main thread terminates the worker, marks remaining tests `timeout`, promotes a pre-warmed standby worker to active, and spawns a new standby. Infinite loops are therefore survivable and the student never waits for a cold Pyodide load twice.

No cross-origin isolation headers. `SharedArrayBuffer` interrupts would need `COEP: require-corp`, which breaks every cross-origin asset without CORP headers. Terminate-and-respawn is enough. Exact versions, CDN URLs, and API shapes for every runtime are in `docs/research/runtime-facts.md`.

---

## 9. Lockdown and integrity

One hook, `useLockdown(exerciseId)`, mounted only on exercise and drill screens.

- **Blur guard.** `visibilitychange` hidden or `window.blur` → full-screen opaque overlay (a separate element above the editor, not a CSS filter on it) and a "Come back to continue" line. Focus returns → overlay removed. Event `blur` logged with `duringAttempt`.
- **Idle guard.** No `keydown` or `mousemove` for 15 s → overlay at 85% opacity with heavy backdrop blur. Any input clears it. Logged as `idle` only if it lasts 60 s or more.
- **Clipboard guard.** `copy`, `cut`, `paste`, `contextmenu` prevented on the exercise page container and in the editor. Paste attempt shows a one-line toast: "Type it. That's the whole point." Logged as `paste-blocked` / `copy-blocked` / `contextmenu-blocked`.
- **Key guard.** `keyup` with `key === 'PrintScreen' || keyCode === 44` (Firefox fires no `keydown` for it) → overlay for 2 s and `navigator.clipboard.writeText('')` where allowed. Logged as `printscreen`.
- **Nothing else.** No DevTools detection, no camera theatre.

**Escalation** (computed server-side by a Postgres function `integrity_score(user_id)` over the last 7 days using `INTEGRITY_WEIGHTS`, and re-evaluated on every event insert by a trigger):

| Score | Status | Effect |
|---|---|---|
| ≥ 10 | `warned` | Banner on next login explaining the rule. |
| ≥ 20 | `restricted` for 24 h | Exercises locked; dashboard and de-rot open. `restricted_until` set. |
| ≥ 40 | `banned` | Sign-in blocked with a one-line message and Musa's contact email for appeal. |
| 5 `paste-blocked` in one exercise | `restricted` for 24 h immediately | Regardless of score. |

Admin page lists users with score, events, and buttons: lift, restrict, ban. Admin ids are exempt from scoring.

**The real wall** is per-student variant exercises. A leaked solution matches nobody else's exercise.

---

## 10. Wellness

A persistent side rail on every non-exercise screen; a thin strip on exercise screens.

- **Prayer.** Times fetched once per day from the Aladhan API for Doha (calculation method suited to Qatar; exact method id in the runtime facts doc), or device coordinates if the student allows. Reminders 10 minutes before and at time for the five prayers, each individually mutable. During an active attempt the reminder queues until submit.
- **Water and stretch.** Default 45-minute intervals, gentle toast, one-tap log, streak shown.
- **Pomodoro.** 25/5 default, editable. A pomodoro ending mid-attempt pauses the idle guard instead of interrupting.
- All preferences in `wellness.prefs` (`WellnessPrefs`), all logs in the same row as JSON.

---

## 11. De-rot

A top-level section equal to Courses in the nav. Six drills at launch, all local, all scored and streaked, each a data file plus a component. Adding a seventh is content, not code.

| Drill | Payload | Grading |
|---|---|---|
| Predict the output | snippet, language, expected string, time limit | normalized string match before the countdown ends |
| Spot the bug | snippet with one planted bug, bug line numbers | clicked line in set |
| Trace by hand | snippet, step index, variable names, expected values | exact per cell |
| Hold focus | 200 to 400 word technical passage, one question, 4 options; no scroll allowed | correct option; leaving the page voids it |
| N-back | sequence of code tokens, N; press when current equals N back | hits minus false alarms |
| Speed type | snippet to type exactly | accuracy over speed; paste blocked |

Daily de-rot streak is separate from the exercise streak. Buddy suggests a drill after three consecutive fails. Drill items ship in `seed/drills/*.json`, at least 20 per drill at launch.

---

## 12. Onboarding, dashboard, reports, buddy

**Onboarding.** Two phases, under four minutes total, no code shown.
- Phase 1 (Profiler): 5 to 7 adaptive either-or cards: a diagram or a paragraph, a video or a snippet, an example first or a rule first. Output: `learningStyle` and `styleVector`.
- Phase 2 (Profiler): why are you learning; do you want to go beyond the courses; how deep (pass / understand / master); do you want agentic coding; pick a tone; short or verbose. Output: `motivation`, `tone`, `verbosity`.
- Then the student picks a course, the Planner builds the path, and the dashboard appears.

**Dashboard.** One screen: current course, next three exercises, both streaks, points, mastery grid per CLO, wellness rail, buddy button, de-rot shortcut. No feed, no walls of text.

**Reports.** One button → PDF rendered in the browser: mastery per CLO, patterns passed, mistake trend over time, time spent, de-rot scores, and the Planner's focus line. Nothing server-side.

**Buddy.** A drawer, not a page. Coding and improvement only. Has the Learner State summary, so "why do I keep failing loops" gets an answer from data.

**Admin.** `/admin` (gated): invites (mint, list), users (status, integrity score, events, lift/restrict/ban), bank stats (exercises per CLO per pattern), agent usage (calls per agent per day).

---

## 13. UI direction

Astra owns the screens. Direction, in Musa's words: cinematic and subtle. Rules for the Astra lane:
- Dark-first, one accent, generous spacing, motion that explains state changes and nothing else. No decorative animation on the exercise screen; the editor is the hero there.
- Typography from `next/font/google` with a real fallback stack. Never Inter. No emoji anywhere in UI copy.
- Every screen must be usable on a 13-inch laptop at 100% zoom with the wellness rail open.
- Loading states for every runtime warmup (Pyodide is tens of megabytes) with real progress, never a spinner alone.
- Footer line on every page: "Built by Velocity". Open-source link to the repo.
- Skills to load before any UI work: `gpt-taste` (the user's taste file) and the Astra operating prompt in `docs/prompts/astra-operating-prompt.md`.

---

## 14. Deployment, repo, secrets, flags

- **Repo:** public on GitHub under Musa's account, MIT, `README.md` with Velocity credit and a two-paragraph architecture summary. Seed data and prompts are in the repo.
- **Branches:** `main` deploys to production on Vercel. Every PR gets a preview deploy. During the build day both lanes commit to short-lived branches and merge via PR after the other lane's review.
- **Supabase:** one project. Migrations in `supabase/migrations/`, applied with the Supabase CLI. Seed applied with a Node script that reads `seed/*.json` and upserts through the service key.
- **Package manager:** npm with a committed `package-lock.json`. Not pnpm: Vercel misdetects pnpm 11 lockfiles (open bug) and this machine has pnpm 11.
- **Model:** `deepseek-v4-flash` for all seven agents. `deepseek-v4-pro` is not used at launch.
- **Secrets (Vercel env, never in the client bundle):** `DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JUDGE0_API_KEY`, `JUDGE0_HOST`, `ADMIN_USER_IDS` (comma-separated user ids; empty means nobody is admin). Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Local-only, never on Vercel: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` for the CLI.
- **Flags (env):** `INVITES_REQUIRED` (true at launch), `JUDGE_ALL_LANGUAGES` (false at launch), `JUDGE_PROVIDER` (`judge0` at launch), `AGENT_DRY_RUN` (returns fallbacks without calling DeepSeek; used in tests and previews).

---

## 15. Testing

- **Vitest** (unit): mastery math, points, ban scoring and thresholds, bank query selection, Learner State compile and trim, every agent's Zod schema against fixtures (valid, invalid, edge), Coach single-line rule, Buddy off-topic gate, each runtime adapter against a tiny golden exercise (Python, JS, SQL, Mongo; web via jsdom; Java via a mocked judge).
- **Playwright** (e2e, three flows only): invite → magic link (mocked mailer) → onboarding → first exercise; fail → fix plan → hint → pass → chain continues; blur → overlay → focus → overlay gone, event row exists.
- **Manual before deploy:** one real student email through the real magic link; one Java exercise through the real judge; Pyodide loads pandas on a throttled connection with visible progress.

---

## 16. Team seams and ownership

| Lane | Owns | Never touches |
|---|---|---|
| **Claude** | agent prompts and modules, `/api/agent` route logic, Learner State compile/trim, bank query and chain rule, scoring, ban math, seed exercise generation workflow, drill item generation, Vitest suites for all of those, the Astra operating prompt, review of Astra PRs | UI components, migrations, runtime adapters, screens |
| **Astra (Codex)** | Supabase schema, migrations, RLS, auth hook, seed loader, Next.js app shell, all screens, runtime adapters, lockdown hook, wellness rail, de-rot components, PDF report, admin pages, Playwright flows, Vercel and Supabase deploy wiring, review of Claude PRs | agent prompts, agent schemas, scoring, contracts file |
| **Musa** | Vercel and Supabase projects, GitHub repo, secrets, invite list, PR approval, taste calls | |

The contracts file is frozen at build start. A change to it requires a PR that both lanes review the same hour.

**Capacity valve.** Codex runs one write-capable task at a time in this working tree, so Astra tasks are serial. If A5a (onboarding, buddy, wellness) has not landed when Phase 3 opens, the Claude lane builds the pure-presentation pieces of A5b (the six drill components against the drills seed, the report pages, the admin tables) with parallel subagents that follow the Astra operating prompt's UI direction, and Astra reviews them before merge. Musa can veto this at the Phase 2 checkpoint; the default is to use it.

---

## 17. Out of scope for v1

Arabic and RTL; any language beyond the six courses' runtimes; realtime collaboration; mobile app; server-side code execution for non-Java languages (wired, flag-off); payments; email notifications beyond the magic link; SSO; sharing runtime-generated exercises between students (needs server-side verification); the three-per-pattern bank (queued for pilot week).

---

## 18. Open items

1. **INFS1201 syllabus** is missing; its four CLOs are drafted from the appendix and flagged `draft: true` in the seed. Swap when Musa provides it.
2. **Judge0 CE free-tier quota** could not be read from the pricing page. Musa subscribes on RapidAPI before the judge task starts and records the quota in the runtime facts doc. If it is too small for the cohort, self-host Piston on a small VPS and flip `JUDGE_PROVIDER`.
3. **Aladhan calculation method** for Qatar is method 10; confirmed live. Fallback is the `adhan` package computed locally.
4. **Musa must supply before the build reaches them:** DeepSeek API key, Supabase project ref and service key, Judge0 RapidAPI key, Vercel login, GitHub login, the beta invite email list.
