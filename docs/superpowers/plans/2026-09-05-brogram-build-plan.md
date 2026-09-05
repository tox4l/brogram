# BroGram Build Plan (launch day)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for Claude-lane tasks and the Codex plugin (`/codex:rescue --background --fresh ...`) for Astra-lane tasks, using the prompt files in `docs/prompts/astra-tasks/`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, invite-only BroGram on Vercel + Supabase with all seven subsystems live by 19:00 Doha time.

**Architecture:** Client-heavy Next.js 16 app. Browser runs and grades code, holds the Learner State, runs lockdown, wellness, drills, and PDF. Vercel hosts one agent route (DeepSeek), one judge proxy (Judge0), one exercise-verify route, and admin routes. Supabase holds auth, tables, RLS. Seven learner-state specialist agents read slices of one JSON document and return validated deltas.

**Tech Stack:** Next.js 16.3 (App Router, TypeScript, Turbopack), Tailwind 4, shadcn/ui, CodeMirror 6, Pyodide v314, sql.js 1.14, mingo 7.2, Supabase (`@supabase/ssr`), Vercel AI SDK + `@ai-sdk/deepseek` 3.0 (`deepseek-v4-flash`), Zod 4, Zustand 5, Vitest 5, Playwright 1.63, jsPDF + html2canvas-pro, GSAP 3.15, motion 13. npm, not pnpm.

**Spec:** `docs/superpowers/specs/2026-09-05-brogram-design.md`
**Contracts:** `docs/contracts/brogram-contracts.ts` (copied verbatim to `src/lib/contracts.ts`, frozen)
**Runtime facts:** `docs/research/runtime-facts.md`
**Agent specs:** `docs/prompts/agents/*.md`

## Global Constraints

- Node ≥ 22 (machine has 24). npm only; `package-lock.json` committed; no `pnpm-lock.yaml` ever.
- Every LLM call goes through `src/app/api/agent/route.ts`. Model `deepseek-v4-flash`. JSON mode via `generateObject` / `streamObject`. Word `json` present in every system prompt.
- Agent calls fire only on the seven triggers in the contracts. A test asserts no agent call on mount, keystroke, or timer.
- Email gate: `.edu.qa` suffix, server-side, in the `before-user-created` hook. `INVITES_REQUIRED=true` at launch.
- No client role has SELECT on `exercises`; clients read `exercises_public`. Reference solutions reach prompts only through server-side hydration in the agent route.
- No institution name anywhere in UI, seed titles, or prompts. "Built by Velocity" in the footer.
- English only. No Arabic, no RTL. No emoji in UI copy. Never the Inter font.
- Timeouts: 5 s per browser test, 10 s per Java run. Idle blur 15 s. First hint after a failure unlocks on edit or 60 s; later hints need 60 s since the last Coach call; max 5 per exercise.
- Integrity weights and thresholds exactly as `INTEGRITY_WEIGHTS` / `INTEGRITY_THRESHOLDS`.
- Lane ownership per spec §16. The contracts file is edited only by a PR both lanes review.
- Commit after every task with a conventional message. Deploy a preview after every phase.

## How the Codex plugin behaves (verified against its source; do not rediscover)

- Only `/codex:rescue` and `/codex:setup` are model-invocable. Status, result, review, and adversarial-review are reached through `node "C:/Users/musal/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" <status --json | result <id> | review --base main | adversarial-review --base main <focus>>` via Bash. Review always runs foreground; use `run_in_background: true`.
- Codex runs one write-capable task at a time in this working tree. **Astra tasks are serial:** A0, A1, A2, A3, A4, A5a, A5b, A6. The Claude lane runs alongside.
- Deltas are fresh rescues that name the branch. Never `--resume`.

---

## Timeline and lanes

| Phase | Target | Claude lane (parallel) | Astra lane (serial) | Musa |
|---|---|---|---|---|
| 0 Bootstrap | +25 min | C0 tooling, tests scaffold, contracts guard | A0 scaffold + first deploy | keys, logins, Supabase + Vercel projects, RapidAPI |
| 1 Core | +2 h | C1 agents + routes, C2 state/bank/scoring | A1 schema/RLS/hook/seed loader/server helpers, then A2 shell + auth + dashboard | invite list |
| 2 Exercise | +3.5 h | C3 seed bank (perPattern 1), C4 drills + fallbacks, **then C3b: load seed to Supabase** | A3 runtimes, then A4 exercise screen + lockdown; A5a may start as soon as A2 merged if A3 is waiting on C1 | try the preview |
| 3 Surround | +5 h | C5 integration + Playwright, PR reviews; **capacity valve** for A5b pieces if A5a has not landed | A5a onboarding/buddy/wellness, then A5b de-rot/report/admin | taste review |
| 4 Ship | +6 h | C6 smoke with Musa | A6 prod deploy, hook registration, admin env, e2e on preview | mint invites, send links |

Merge order inside a phase: Astra schema first, then Claude routes, then Astra UI. Both lanes work on branches `claude/*` and `astra/*`, PR into `main`, and the other lane reviews before merge.

---

## Phase 0: Bootstrap

### Task A0: Scaffold the app and deploy

**Files:**
- Create: repo root via `create-next-app` (copied in), `.env.example`, `.gitignore` merge, `src/lib/contracts.ts`, `scripts/copy-sqljs-wasm.mjs`
- Create: `src/app/layout.tsx`, `src/app/page.tsx` (placeholder with footer)

**Interfaces:**
- Produces: the repo, `npm run dev`, `npm run build`, a live Vercel URL.

- [ ] **Step 1: Scaffold into this folder**

The package root (this folder, containing `docs/` and `seed/`) becomes the app root. `create-next-app` refuses non-empty directories, so scaffold beside it and copy in, preserving the curated `.gitignore`:

```bash
cd ..
npx create-next-app@latest brogram-scaffold --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
node -e "const fs=require('fs');const p=require('path');const src='brogram-scaffold',dst='Brogram';for(const e of fs.readdirSync(src,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.gitignore')continue;fs.cpSync(p.join(src,e.name),p.join(dst,e.name),{recursive:true})}"
cd Brogram && npm install
```
Then delete `../brogram-scaffold`. Verify `package.json` has `tailwindcss` ^4 and `@tailwindcss/postcss`; if not: `npm i -D tailwindcss@latest @tailwindcss/postcss postcss`. Set `"name": "brogram"`.

- [ ] **Step 2: Contracts into place**

Copy `docs/contracts/brogram-contracts.ts` → `src/lib/contracts.ts` unchanged.

- [ ] **Step 3: Env and gitignore check**

Create `.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DEEPSEEK_API_KEY=
JUDGE0_HOST=judge0-ce.p.rapidapi.com
JUDGE0_API_KEY=
JUDGE_PROVIDER=judge0
JUDGE_ALL_LANGUAGES=false
INVITES_REQUIRED=true
AGENT_DRY_RUN=false
ADMIN_USER_IDS=
```
Verify: `git check-ignore -v "UDST START"` prints a match; `git check-ignore .env.example` prints nothing.

- [ ] **Step 4: Install the fixed dependency set**

```bash
npm i @supabase/supabase-js @supabase/ssr ai @ai-sdk/deepseek zod zustand codemirror @codemirror/state @codemirror/view @codemirror/lang-python @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-sql @codemirror/lang-java sql.js mingo gsap @gsap/react motion jspdf jspdf-autotable html2canvas-pro adhan server-only
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths @playwright/test @types/sql.js pyodide typescript
npx shadcn@latest init -d
npx shadcn@latest add button card dialog drawer input toast progress badge tabs
```

- [ ] **Step 5: sql.js wasm copy script**

`scripts/copy-sqljs-wasm.mjs`:
```js
import { copyFileSync, mkdirSync } from 'node:fs'
mkdirSync('public', { recursive: true })
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'public/sql-wasm.wasm')
console.log('sql-wasm.wasm copied')
```
`package.json` scripts: `"postinstall": "node scripts/copy-sqljs-wasm.mjs"`, `"test": "vitest run"`, `"test:e2e": "playwright test"`, `"seed:verify": "node seed/validate.mjs"`, `"seed:load": "node scripts/seed-load.mjs"`.

- [ ] **Step 6: Placeholder page with footer, build, deploy, repo**

`src/app/page.tsx` renders the word BroGram and a footer "Built by Velocity". Then:
```bash
npm run build
npm i -g vercel && vercel login && vercel link --yes && vercel deploy
git init && git add . && git commit -m "chore: scaffold brogram"
gh repo create brogram --public --source=. --remote=origin --push
```
The first deploy of a new project is production; expect a production URL. Every later `vercel deploy` is a preview.

### Task C0: Test scaffold and contracts guard

**Files:**
- Create: `vitest.config.mts`, `src/lib/contracts.test.ts`

- [ ] **Step 1: Vitest config** per runtime facts (tsconfigPaths + react, jsdom).
- [ ] **Step 2: Contracts guard test**

```ts
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('contracts', () => {
  it('src copy matches docs copy byte for byte', () => {
    expect(readFileSync('src/lib/contracts.ts', 'utf8')).toBe(readFileSync('docs/contracts/brogram-contracts.ts', 'utf8'))
  })
})
```
- [ ] **Step 3: Run** `npm test` and `npm run seed:verify` → both pass (seed already contains `seed/exercises/smoke.json`, five exercises). Commit `test: contracts guard`.

---

## Phase 1: Core

### Task A1: Supabase schema, RLS, auth hook, seed loader, server helpers

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_auth_hook.sql`, `supabase/migrations/0003_integrity.sql`, `scripts/seed-load.mjs`, `src/lib/supabase/server.ts`

**Interfaces:**
- Produces: tables per spec §4; view `exercises_public`; functions `integrity_score(uuid)`, `hook_gate_signup(jsonb)`, `lift_expired_restriction()`; triggers; RLS policies.
- Produces in `src/lib/supabase/server.ts` (`import 'server-only'`): `getUserAndProfile(): Promise<{ user: User | null; profile: { id: string; account_status: AccountStatus; restricted_until: string | null } | null }>` using `getUser()`/`getClaims()`, never `getSession()`; `serviceClient(): SupabaseClient` with the service role key.
- Consumes: `seed/*.json`, `seed/exercises/*.json`, `seed/drills/*.json`.

- [ ] **Step 1: Install CLI and link (non-interactive)**
```bash
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase
supabase init
SUPABASE_ACCESS_TOKEN=... SUPABASE_DB_PASSWORD=... supabase link --project-ref $SUPABASE_PROJECT_REF
```
Never `supabase login`.

- [ ] **Step 2: 0001_init.sql** (complete; adjust nothing without telling the Claude lane)

```sql
create type account_status as enum ('active','warned','restricted','banned');
create type exercise_origin as enum ('seed','generated');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  account_status account_status not null default 'active',
  restricted_until timestamptz,
  invite_code text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table public.invites (
  code text primary key,
  email text not null unique,
  created_by uuid references auth.users,
  redeemed_by uuid references auth.users,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.courses (
  code text primary key, slug text not null unique, title text not null,
  language text not null, secondary_language text, runtime text not null,
  level int not null, prerequisites text[] not null default '{}', topics text[] not null default '{}',
  clo_ids text[] not null default '{}', status text not null default 'live', packages text[] not null default '{}'
);
create table public.clos (
  id text primary key, course text not null references public.courses(code), ordinal int not null,
  outcome text not null, topics text[] not null default '{}', prerequisites text[] not null default '{}',
  patterns text[] not null default '{}', assessable_in_code boolean not null default true, draft boolean not null default false
);
create table public.patterns (id text primary key, name text not null, description text not null, family text not null);
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  clo_id text not null references public.clos(id), language text not null, kind text not null,
  difficulty int not null check (difficulty between 1 and 5), pattern text not null references public.patterns(id),
  title text not null, prompt text not null, starter_code text not null default '',
  tests jsonb not null, reference_solution text not null, origin exercise_origin not null default 'seed',
  parent_exercise_id uuid references public.exercises(id), author_user_id uuid references auth.users on delete set null,
  verified boolean not null default true, tags text[] not null default '{}', fixture text,
  created_at timestamptz not null default now()
);
create index on public.exercises (clo_id, pattern, difficulty);
create table public.attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  exercise_id uuid not null references public.exercises(id), code text not null, results jsonb not null,
  passed boolean not null, duration_ms int not null default 0, hint_count int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.attempts (user_id, created_at desc);
create index on public.attempts (user_id, exercise_id);
create table public.mastery (
  user_id uuid not null references auth.users on delete cascade, clo_id text not null references public.clos(id),
  score int not null default 0, chain int not null default 0, patterns_passed text[] not null default '{}',
  closed boolean not null default false, last_attempt_at timestamptz, primary key (user_id, clo_id)
);
create table public.learner_state (
  user_id uuid primary key references auth.users on delete cascade,
  state jsonb not null, version int not null default 0, updated_at timestamptz not null default now()
);
create table public.integrity_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  type text not null, exercise_id uuid, during_attempt boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.integrity_events (user_id, created_at desc);
create table public.wellness (
  user_id uuid primary key references auth.users on delete cascade,
  prefs jsonb not null default '{}', pomodoro_sessions jsonb not null default '[]',
  water_log jsonb not null default '[]', drill_results jsonb not null default '[]', updated_at timestamptz not null default now()
);
create table public.buddy_messages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('user','assistant')), content text not null, created_at timestamptz not null default now()
);
create table public.drills (
  id text primary key, kind text not null, language text, difficulty int not null check (difficulty between 1 and 5),
  time_limit_s int not null, payload jsonb not null
);
create table public.agent_usage (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  agent text not null, trigger text not null, prompt_tokens int not null default 0, completion_tokens int not null default 0,
  cache_hit_tokens int not null default 0, fallback boolean not null default false, created_at timestamptz not null default now()
);
create index on public.agent_usage (user_id, created_at desc);

-- helper predicates (stable, per-statement)
create function public.is_not_banned() returns boolean language sql stable security definer as $$
  select coalesce((select account_status <> 'banned' from public.profiles where id = (select auth.uid())), false)
$$;
create function public.can_attempt() returns boolean language sql stable security definer as $$
  select coalesce((select account_status in ('active','warned') or (account_status = 'restricted' and restricted_until < now())
    from public.profiles where id = (select auth.uid())), false)
$$;

-- the ONLY client-readable shape of the bank: no reference solution; seed rows plus the caller's own generated rows
create view public.exercises_public as
select id, clo_id, language, kind, difficulty, pattern, title, prompt, starter_code, tests, origin, parent_exercise_id, author_user_id, verified, tags, fixture, created_at
from public.exercises
where public.is_not_banned() and (origin = 'seed' or author_user_id = (select auth.uid()));
-- owner rights on purpose: the base table is not readable by clients
revoke all on public.exercises from anon, authenticated;
revoke all on public.exercises_public from anon, public;
grant select on public.exercises_public to authenticated;

-- learner_state version guard
create function public.learner_state_version_guard() returns trigger language plpgsql as $$
begin
  if new.version <> old.version + 1 then raise exception 'stale learner_state version (expected %, got %)', old.version + 1, new.version; end if;
  new.updated_at := now(); return new;
end $$;
create trigger learner_state_version_guard before update on public.learner_state for each row execute function public.learner_state_version_guard();

-- profile bootstrap and invite redemption on first sign-in (user row exists here)
create function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.wellness (user_id) values (new.id) on conflict do nothing;
  update public.invites set redeemed_at = now(), redeemed_by = new.id where email = lower(new.email) and redeemed_at is null;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- students may never change their own status columns, even if a grant slips later
create function public.profile_guard() returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('authenticated','anon') and (
     new.account_status is distinct from old.account_status
     or new.restricted_until is distinct from old.restricted_until
     or new.invite_code is distinct from old.invite_code) then
    raise exception 'profile status columns are read-only for users';
  end if;
  return new;
end $$;
create trigger profile_guard before update on public.profiles for each row execute function public.profile_guard();

-- restriction expiry is explicit: called by the app layout on load
create function public.lift_expired_restriction() returns void language sql security definer as $$
  update public.profiles set account_status = 'warned'
  where id = (select auth.uid()) and account_status = 'restricted' and restricted_until < now()
$$;
grant execute on function public.lift_expired_restriction to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.courses enable row level security;
alter table public.clos enable row level security;
alter table public.patterns enable row level security;
alter table public.exercises enable row level security;
alter table public.attempts enable row level security;
alter table public.mastery enable row level security;
alter table public.learner_state enable row level security;
alter table public.integrity_events enable row level security;
alter table public.wellness enable row level security;
alter table public.buddy_messages enable row level security;
alter table public.drills enable row level security;
alter table public.agent_usage enable row level security;

create policy "own profile" on public.profiles for select using (id = (select auth.uid()));
revoke update on public.profiles from anon, authenticated;
grant update (display_name, last_seen_at) on public.profiles to authenticated;
create policy "own profile update" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "read curriculum" on public.courses for select using (public.is_not_banned());
create policy "read clos" on public.clos for select using (public.is_not_banned());
create policy "read patterns" on public.patterns for select using (public.is_not_banned());
create policy "read drills" on public.drills for select using (public.is_not_banned());
-- exercises: no client policy at all; service role bypasses RLS
create policy "own attempts" on public.attempts for select using (user_id = (select auth.uid()));
create policy "insert attempts" on public.attempts for insert with check (user_id = (select auth.uid()) and public.can_attempt());
create policy "own mastery" on public.mastery for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own state" on public.learner_state for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "insert integrity" on public.integrity_events for insert with check (user_id = (select auth.uid()));
create policy "own wellness" on public.wellness for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own buddy" on public.buddy_messages for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- invites and agent_usage: no client access; service key only.
```

- [ ] **Step 3: 0002_auth_hook.sql** (read-only hook; redemption happens in `handle_new_user`)

```sql
create function public.hook_gate_signup(event jsonb) returns jsonb language plpgsql security definer as $$
declare
  em text := lower(event->'user'->>'email');
  invites_required boolean := coalesce(current_setting('app.invites_required', true), 'true') = 'true';
begin
  if em is null or em !~ '\.edu\.qa$' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'BroGram is only open to .edu.qa email addresses.'));
  end if;
  if invites_required and not exists (select 1 from public.invites where email = em and redeemed_at is null) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'BroGram is invite-only right now. Ask Velocity for an invite.'));
  end if;
  return '{}'::jsonb;
end $$;
grant execute on function public.hook_gate_signup to supabase_auth_admin;
revoke execute on function public.hook_gate_signup from authenticated, anon, public;
grant select on public.invites to supabase_auth_admin;
```
Then `alter database postgres set app.invites_required = 'true';` (flip to `'false'` after beta). Register the hook in Dashboard → Authentication → Hooks → Before User Created → Postgres function `hook_gate_signup`.

- [ ] **Step 4: 0003_integrity.sql**

```sql
create function public.integrity_score(uid uuid) returns int language sql stable as $$
  select coalesce(sum(case type when 'paste-blocked' then 2 when 'copy-blocked' then 2 when 'printscreen' then 3 when 'blur' then 1 else 0 end), 0)::int
  from public.integrity_events where user_id = uid and created_at > now() - interval '7 days'
$$;
create function public.apply_integrity_escalation() returns trigger language plpgsql security definer as $$
declare s int; paste_in_exercise int; st account_status;
begin
  if new.user_id::text = any (string_to_array(coalesce(current_setting('app.admin_user_ids', true), ''), ',')) then return new; end if;
  s := public.integrity_score(new.user_id);
  select count(*) into paste_in_exercise from public.integrity_events where user_id = new.user_id and exercise_id = new.exercise_id and type = 'paste-blocked';
  select account_status into st from public.profiles where id = new.user_id;
  if st = 'banned' then return new; end if;
  if s >= 40 then
    update public.profiles set account_status = 'banned' where id = new.user_id;
  elsif s >= 20 or paste_in_exercise >= 5 then
    update public.profiles set account_status = 'restricted', restricted_until = greatest(coalesce(restricted_until, now()), now()) + interval '24 hours' where id = new.user_id;
  elsif s >= 10 and st = 'active' then
    update public.profiles set account_status = 'warned' where id = new.user_id;
  end if;
  return new;
end $$;
create trigger integrity_escalation after insert on public.integrity_events for each row execute function public.apply_integrity_escalation();
```
`alter database postgres set app.admin_user_ids = '<musa uuid>';` once Musa has signed in (A6).

- [ ] **Step 5: Push and verify**
```bash
supabase db push
```
In the SQL editor:
- `select public.hook_gate_signup('{"user":{"email":"x@gmail.com"}}'::jsonb);` → error object.
- Insert a throwaway invite for `test@udst.edu.qa`, then the same call for that email → `{}` (and the invite is NOT redeemed yet; redemption is on user creation).
- `set role authenticated; select reference_solution from public.exercises limit 1;` → permission denied. `reset role;`
- `set role anon; select count(*) from public.exercises_public;` → permission denied. `reset role;`

- [ ] **Step 6: Seed loader** `scripts/seed-load.mjs`: reads `seed/courses.json` (the `courses` array only; `coming_soon` tiles are hard-coded in the UI, not seeded), `seed/clos.json`, `seed/patterns.json`, every `seed/exercises/*.json`, and every `seed/drills/*.json` (missing folders are fine); upserts with the service key in this order and with these conflict keys: `patterns` on `id`, `courses` on `code`, `clos` on `id`, `exercises` on a deterministic id `uuidv5(cloId + '|' + title, NAMESPACE)` so re-runs update rather than duplicate, `drills` on `id`. Each table has an explicit column whitelist (snake_case of the JSON keys; keys starting with `$` or not in the whitelist are dropped; `draft` defaults false). Prints a count per table. Run it now: expect courses 6, clos 26, patterns 42, exercises 5, drills 0.

- [ ] **Step 7: Server helpers** `src/lib/supabase/server.ts` with the two exports in Interfaces. Commit `feat(db): schema, rls, auth hook, integrity, seed loader, server helpers`.

### Task A2: App shell, auth, dashboard skeleton

**Files:**
- Create: `src/lib/supabase/{client,middleware}.ts`, `src/middleware.ts`, `src/app/(auth)/login/page.tsx`, `src/app/auth/confirm/route.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/components/shell/*`, `src/store/session.ts`

**Interfaces:**
- Produces: `useSession()` (Zustand: user, profile, learnerState, setLearnerState), `<AppShell>` with nav (Courses, De-rot, Reports, Buddy button) and wellness rail slot.
- Consumes: `getUserAndProfile`, `LearnerState`, `AccountStatus`.

- [ ] **Step 1:** Supabase browser client and middleware per the `@supabase/ssr` App Router guide, using `getClaims()` in middleware.
- [ ] **Step 2:** Login page: one email field, `signInWithOtp({ email, options: { emailRedirectTo: `${origin}/auth/confirm`, shouldCreateUser: true } })`. Show the hook's rejection message verbatim when it errors. Confirm route exchanges `token_hash` with `verifyOtp` and redirects to `/dashboard` or `/onboarding` depending on `learner_state.state.profile.onboardingComplete`.
- [ ] **Step 3:** In `(app)/layout.tsx`: call `rpc('lift_expired_restriction')` then read `profiles.account_status`; banned → sign out and render the one-line message with the Velocity contact; restricted → banner with `restricted_until`, exercise routes redirect to dashboard.
- [ ] **Step 4:** Dashboard skeleton with the sections from spec §12 wired to `useSession()`; designed empty states.
- [ ] **Step 5:** `npm run build` clean. Commit `feat(app): shell, magic link auth, dashboard skeleton`.

### Task C1: Agent modules, agent route, exercise-verify route

**Files:**
- Create: `src/lib/agents/shared.ts`, `src/lib/agents/{profiler,planner,author,diagnoser,coach,reviewer,buddy}.ts`, `src/lib/agents/requests.ts` (per-agent request Zod schemas with caps), `src/lib/agents/fixtures/**`, `src/lib/agents/*.test.ts`, `src/lib/agents/client.ts`, `src/lib/agents/ratelimit.ts`, `src/app/api/agent/route.ts`, `src/app/api/exercises/verify/route.ts`

**Interfaces:**
- Produces: `POST /api/agent` accepting `AgentRequest`, returning `AgentEnvelope | AgentError`; SSE per `AgentStreamFrame` when `agent ∈ {coach, diagnoser, buddy}` and `Accept: text/event-stream`.
- Produces in `client.ts`: `callAgent<A>(req): Promise<AgentEnvelope<AgentReplyOf<A>>>` and `streamAgent<A>(req, onPartial: (p: Partial<AgentReplyOf<A>>) => void): Promise<AgentEnvelope<AgentReplyOf<A>>>` (rejects with `AgentError`).
- Produces: `POST /api/exercises/verify { id }` → `{ ok: true }` when the caller is `author_user_id` of that row; sets `verified=true`.
- Consumes: contracts; `getUserAndProfile`, `serviceClient` from A1; the seven spec files.

- [ ] **Step 1: Shared module**

```ts
// src/lib/agents/shared.ts
import { z } from 'zod'
import type { AgentName, AgentRequest, LearnerProfile, LearnerState } from '@/lib/contracts'
import { AGENT_TOKEN_BUDGETS, AGENT_HARD_CEILING } from '@/lib/contracts'

export interface AgentModule<Req extends AgentRequest, Reply> {
  name: AgentName
  system: string                      // static, contains the word "json"
  schema: z.ZodType<Reply>
  slice(state: Partial<LearnerState>): Record<string, unknown>
  payload(req: Req, hydrated: Record<string, unknown>): Record<string, unknown>
  fallback?(req: Req): Reply          // absent for author
  repair?(req: Req, reply: Reply): Reply          // fixes, never fails; runs before routeCheck
  routeCheck?(req: Req, reply: Reply): string | null
  temperature: number
  maxTokens: number
  streams: boolean
}

export class BudgetExceeded extends Error { constructor(public used: number, public limit: number) { super(`prompt ${used} tokens over ${limit}`) } }

export const approxTokens = (s: string) => Math.ceil(s.length / 3.5)

const TONE: Record<string, string> = {
  playful: 'Be playful and light; a joke is welcome if it is short.',
  supportive: 'Be warm and encouraging; assume the student is trying hard.',
  'tough-love': 'Be blunt and demanding; no cushioning, no insults.',
  direct: 'Be neutral and precise; no small talk.',
}
export function toneSentences(p?: Partial<Pick<LearnerProfile, 'tone' | 'verbosity'>>): string {
  const tone = TONE[p?.tone ?? 'direct'] ?? TONE.direct
  const verb = (p?.verbosity ?? 'short') === 'short' ? 'Keep every field to one or two sentences.' : 'You may use up to four sentences per field where it helps.'
  return `${tone} ${verb}`
}

/** Cache-friendly order, trimmed to budget; throws BudgetExceeded when trimming cannot get under the limit. */
export function buildMessages(mod: AgentModule<any, any>, req: AgentRequest, hydrated: Record<string, unknown>) {
  const slice = mod.slice(req.state)
  const payload = mod.payload(req, hydrated)
  const limit = Math.min(AGENT_TOKEN_BUDGETS[mod.name], AGENT_HARD_CEILING)
  const render = () => [
    { role: 'system' as const, content: mod.system },
    { role: 'user' as const, content: `Learner state (json):\n${JSON.stringify(slice)}\n\n${toneSentences((req.state as any).profile)}\n\nInput (json):\n${JSON.stringify(payload)}` },
  ]
  const cap = (s: unknown, n: number) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s)
  // hard caps first; never trim the student's current code below 20k
  for (const k of ['code', 'currentCode']) if (k in payload) (payload as any)[k] = cap((payload as any)[k], 20000)
  const trims: Array<() => boolean> = [
    () => { const rm = (slice as any).recentMistakes; if (Array.isArray(rm) && rm.length) { rm.pop(); return true } return false },
    () => { const r = (payload as any).results; if (Array.isArray(r)) { let did = false; for (const x of r) for (const k of ['stdout', 'stderr', 'actual']) if (typeof x[k] === 'string' && x[k].length > 200) { x[k] = x[k].slice(0, 200); did = true } return did } return false },
    () => { const m = (payload as any).messages; if (Array.isArray(m) && m.length > 2) { m.shift(); return true } return false },
    () => { if ((payload as any).parent) { delete (payload as any).parent; return true } return false },
    () => { const ex = (payload as any).examples; if (Array.isArray(ex) && ex.length > 1) { ex.pop(); return true } return false },
    () => { const d = (payload as any).diffSinceLastHint; if (typeof d === 'string' && d.length > 2000) { (payload as any).diffSinceLastHint = d.slice(0, 2000); return true } return false },
  ]
  let msgs = render()
  let used = approxTokens(msgs.map(m => m.content).join('\n'))
  while (used > limit) {
    if (!trims.some(t => t())) break
    msgs = render(); used = approxTokens(msgs.map(m => m.content).join('\n'))
  }
  if (used > limit) throw new BudgetExceeded(used, limit)
  return { messages: msgs, promptTokens: used }
}
```

- [ ] **Step 2: One module per agent**, copying the system prompt and Zod schema verbatim from its spec file; `repair` for Coach and Buddy per their specs; `routeCheck` for Planner and Author. Each module's test loads its fixtures folder and asserts `valid-*.json` parse and `invalid-*.json` throw, plus repair and route checks.

- [ ] **Step 3: Request schemas** `requests.ts`: one Zod schema per agent mirroring the contracts, with caps: `code`/`currentCode` ≤ 20,000 chars, `results` ≤ 20, `messages` ≤ 6, `diffSinceLastHint` ≤ 8,000, `answers` ≤ 13, `exampleIds` ≤ 2, `hintsSoFar` ≤ 5, `fixPlan` ≤ 6. `state` accepts only the slice keys the agent may read (unknown keys stripped).

- [ ] **Step 4: Route**

```ts
// src/app/api/agent/route.ts
import { NextResponse } from 'next/server'
import { deepseek } from '@ai-sdk/deepseek'
import { generateObject, streamObject } from 'ai'
import { modules } from '@/lib/agents'
import { requestSchemas } from '@/lib/agents/requests'
import { buildMessages, BudgetExceeded } from '@/lib/agents/shared'
import { checkRate } from '@/lib/agents/ratelimit'
import { getUserAndProfile, serviceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
const MODEL = deepseek('deepseek-v4-flash')
const err = (agent: string, error: string, message: string, status: number) => NextResponse.json({ ok: false, agent, error, message }, { status })

export async function POST(req: Request) {
  const { user, profile } = await getUserAndProfile()
  if (!user || !profile) return err('unknown', 'invalid-request', 'not signed in', 401)
  if (profile.account_status === 'banned') return err('unknown', 'banned', 'account banned', 403)
  const raw = await req.json().catch(() => null)
  const mod = raw && modules[raw.agent as keyof typeof modules]
  if (!mod) return err('unknown', 'invalid-request', 'unknown agent', 400)
  const parsedReq = requestSchemas[mod.name].safeParse(raw)
  if (!parsedReq.success) return err(mod.name, 'invalid-request', parsedReq.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), 400)
  const body = parsedReq.data as any
  const rate = await checkRate(user.id, mod.name, body.trigger, body.exercise?.id)
  if (!rate.ok) return err(mod.name, 'rate-limited', rate.message, 429)

  // server-side hydration: anything the client may not hold comes from the bank with the service key
  const svc = serviceClient()
  const hydrated: Record<string, unknown> = {}
  if (mod.name === 'reviewer' || mod.name === 'diagnoser') {
    const { data } = await svc.from('exercises').select('reference_solution, tests').eq('id', body.exercise.id).single()
    if (!data) return err(mod.name, 'invalid-request', 'unknown exercise', 400)
    hydrated.referenceSolution = data.reference_solution
    hydrated.tests = data.tests
  }
  if (mod.name === 'author') {
    const ids = [...body.exampleIds, ...(body.parentExerciseId ? [body.parentExerciseId] : [])]
    const { data } = await svc.from('exercises').select('*').in('id', ids)
    hydrated.examples = (data ?? []).filter(r => body.exampleIds.includes(r.id))
    hydrated.parent = (data ?? []).find(r => r.id === body.parentExerciseId) ?? null
  }

  let built
  try { built = buildMessages(mod, body, hydrated) }
  catch (e) { if (e instanceof BudgetExceeded) return err(mod.name, 'budget-exceeded', e.message, 413); throw e }
  const { messages, promptTokens } = built
  const usage = { promptTokens, completionTokens: 0, cacheHitTokens: 0 }
  const record = (fallback: boolean) => void svc.from('agent_usage').insert({ user_id: user.id, agent: mod.name, trigger: body.trigger, prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, cache_hit_tokens: usage.cacheHitTokens, fallback })
  const finish = (reply: any, fallback: boolean) => ({ ok: true as const, agent: mod.name, reply, usage, fallback })

  const wantsStream = mod.streams && (req.headers.get('accept') ?? '').includes('text/event-stream')
  if (process.env.AGENT_DRY_RUN === 'true') {
    if (!mod.fallback) return err(mod.name, 'upstream', 'dry run: no fallback for this agent', 502)
    const env = finish(mod.fallback(body), true)
    return wantsStream ? sse([{ partial: env.reply }, { envelope: env }]) : NextResponse.json(env)
  }

  const finalize = (obj: any) => {
    let reply = mod.repair ? mod.repair(body, obj) : obj
    const rc = mod.routeCheck ? mod.routeCheck(body, reply) : null
    return { reply, error: rc }
  }

  if (wantsStream) {
    // streaming agents never retry; the terminal frame carries the validated object or the fallback
    const result = streamObject({ model: MODEL, schema: mod.schema, messages, temperature: mod.temperature, maxOutputTokens: mod.maxTokens })
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (frame: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
        try {
          for await (const partial of result.partialObjectStream) send({ partial })
          const obj = await result.object
          const u = await result.usage; usage.completionTokens = u.outputTokens ?? 0
          const { reply, error } = finalize(obj)
          const env = error ? finish(mod.fallback!(body), true) : finish(reply, false)
          record(env.fallback); send({ envelope: env })
        } catch {
          const env = finish(mod.fallback!(body), true); record(true); send({ envelope: env })
        } finally { controller.close() }
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
  }

  const once = async (extra?: string) => generateObject({ model: MODEL, schema: mod.schema, messages: extra ? [...messages, { role: 'user' as const, content: extra }] : messages, temperature: mod.temperature, maxOutputTokens: mod.maxTokens })
  let obj: any = null, lastError = ''
  for (let attempt = 0; attempt < 2 && obj === null; attempt++) {
    try {
      const r = await once(attempt ? `Your previous reply failed validation: ${lastError}. Reply with valid json matching the schema.` : undefined)
      usage.completionTokens += r.usage.outputTokens ?? 0
      const { reply, error } = finalize(r.object)
      if (error) { lastError = error; continue }
      obj = reply
    } catch (e: any) { lastError = e?.message ?? 'invalid json' }
  }
  if (obj === null) {
    if (!mod.fallback) { record(true); return err(mod.name, 'upstream', lastError, 502) }
    const env = finish(mod.fallback(body), true); record(true); return NextResponse.json(env)
  }
  if (mod.name === 'author') {
    // the route, not the client, writes the bank
    const e = obj.exercise
    const { data } = await svc.from('exercises').insert({ clo_id: e.cloId, language: e.language, kind: e.kind, difficulty: e.difficulty, pattern: e.pattern, title: e.title, prompt: e.prompt, starter_code: e.starterCode, tests: e.tests, reference_solution: e.referenceSolution, origin: 'generated', parent_exercise_id: body.parentExerciseId ?? null, author_user_id: user.id, verified: false, tags: e.tags, fixture: e.fixture ?? null }).select('id').single()
    obj = { exercise: { ...e, id: data?.id } }
  }
  const env = finish(obj, false); record(false); return NextResponse.json(env)
}

function sse(frames: unknown[]) {
  const body = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
```
If the installed `@ai-sdk/deepseek` needs an explicit option to force JSON mode with `generateObject`, read its types under `node_modules` and add it; record the option in `docs/build-log.md`. Prove JSON mode with one live call before Phase 1 closes (C1 Step 7).

- [ ] **Step 5: Verify route** `src/app/api/exercises/verify/route.ts`: `getUserAndProfile()`; body `{ id }`; `update exercises set verified=true where id=? and author_user_id=user.id` with the service key; 404 when no row updated.

- [ ] **Step 6: Rate limiter** `ratelimit.ts`: in-memory buckets keyed `${userId}:${agent}` with windows: coach 1 per 60 s (window resets on `attempt-failed`), buddy 20/h, author 10/h, every other agent 60/h; the coach 5-per-exercise cap is checked with `select hint_count from attempts where user_id=? and exercise_id=? order by created_at desc limit 1` via the service client (counts persist across deploys); judge 30/h (used by A3). Backstop every bucket with `select count(*) from agent_usage where user_id=? and agent=? and created_at > now() - interval '1 hour'`. Unit-tested with a fake clock and a stubbed client.

- [ ] **Step 7: Route tests** with `AGENT_DRY_RUN=true`: each agent's valid request fixture → `ok: true, fallback: true` (author → 502); unknown agent → 400; a Reviewer request carrying a client-supplied `referenceSolution` is rejected by the request schema (unknown key stripped, hydration used); oversize `code` → 400; a body that trims to over budget → 413; streaming request → two frames. Then one **live** call (no dry run) for the Profiler asserting `fallback: false`, run manually and pasted into the build log. Commit `feat(agents): seven modules, agent route, verify route, rate limits`.

### Task C2: Learner State, bank query, chain rule, scoring, ban math

**Files:**
- Create: `src/lib/learner/{compile,trim,bank,chain,score,integrity}.ts` and matching `*.test.ts`

**Interfaces:**
- Produces: `compileLearnerState(profileRow, masteryRows, attemptRows, eventRows, wellnessRow, prev?): LearnerState`; `toExercisePublic(row: Record<string, unknown>): ExercisePublic` (snake_case row → contract shape; every `exercises_public` select in A4/A5 passes through it); `pickFromBank(query: BankQuery, rows: ExercisePublic[]): ExercisePublic | null` (prefers unpassed patterns, then drops the preference, then widens difficulty to ±2, then any unseen on the CLO); `fetchBank(supabase, query): Promise<ExercisePublic[]>`; `nextInChain(mastery: Mastery, passedPattern: PatternId, cloPatterns: PatternId[]): { chain: number; closed: boolean; preferPatterns: PatternId[] }`; `applyPass(m, difficulty, pattern, quality, hintCount)`, `applyFail(m, difficulty)`; `integrityScore(events, now)`, `statusFor(score, pasteInExercise)`.

- [ ] **Step 1: Tests first** (write all listed):
  - `chain`: passing three distinct patterns closes; the same pattern twice does not advance; a fail resets chain to 0 and keeps `patternsPassed`.
  - `score`: `pointsForPass(3, 0, 90)` = 345; `pointsForPass(1, 5, 0)` = 50; `nextMasteryScore(95, true, 5)` = 100; `nextMasteryScore(3, false, 1)` = 0.
  - `integrity`: 5 blurs + 1 paste = 7 → active; 10 → warned; 20 → restricted; 40 → banned; 5 paste in one exercise → restricted regardless; events older than 7 days ignored.
  - `bank`: prefers unpassed pattern; excludes recent ids; widens ±1 then ±2; falls back to any unseen; returns null only when the CLO has nothing unseen; `toExercisePublic` maps every column.
  - `compile`: recentMistakes capped at 10 newest; version increments; streak counts consecutive days by a timezone-safe date key.
- [ ] **Step 2: Implement** to pass. `npm test` green. Commit `feat(learner): state compile, bank pick, chain rule, scoring, integrity`.

---

## Phase 2: Exercise

### Task A3: Runtime adapters

**Files:**
- Create: `src/lib/runtimes/{index,pyodide,pyodide.worker,js,js.worker,web,sql,mongo,judge}.ts`, `src/app/api/judge/route.ts`, `src/lib/runtimes/*.test.ts`

**Interfaces:**
- Produces: `getRuntime(language): RuntimeAdapter`; each adapter implements `warmup / run / abort`. `POST /api/judge` `{ language, code, stdin }` → `{ stdout, stderr, compileOutput, exitCode, timedOut }`.
- Consumes: `RunRequest`, `RunResult`, `TestCase`, `getUserAndProfile`, `checkRate`.

- [ ] **Step 1: Pyodide worker** loads `https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.js`, `loadPyodide()`, posts `ready`. Messages: `{ type: 'packages', names }` (posts progress per package), `{ type: 'run', code, tests, mode: 'function' | 'stdin', fnName }`. Function-mode harness (Python):
```python
import json, sys, io, traceback
results = []
for t in TESTS:
    out = io.StringIO(); err = io.StringIO()
    old = (sys.stdout, sys.stderr); sys.stdout, sys.stderr = out, err
    try:
        args = json.loads(t["input"])
        actual = json.dumps(globals()[FN](*args), default=str)
        passed = actual == t["expected"] or json.loads(actual) == json.loads(t["expected"])
        results.append({"testId": t["id"], "passed": passed, "actual": actual, "expected": t["expected"], "stdout": out.getvalue(), "stderr": err.getvalue(), "failureKind": None if passed else "wrong-answer"})
    except Exception:
        results.append({"testId": t["id"], "passed": False, "actual": "", "expected": t["expected"], "stdout": out.getvalue(), "stderr": traceback.format_exc(), "failureKind": "runtime-error"})
    finally:
        sys.stdout, sys.stderr = old
```
Stdin mode replaces `input()` via `pyodide.setStdin` and compares stripped stdout. The adapter keeps `active` and `standby` workers; on timeout: `active.terminate()`, `active = standby`, spawn a new standby, resolve pending tests as `timeout`.
- [ ] **Step 2: JS/TS worker** wraps code in `new Function` after stripping `export`, TS transpiled with `typescript`'s `transpileModule`; same harness shape.
- [ ] **Step 3: Web adapter** builds `srcdoc` = fixture HTML + student code + a runner that executes each `TestCase.input` as a function body returning `"ok"` or a message and posts results; 5 s timeout removes the iframe.
- [ ] **Step 4: SQL adapter** (sql.js): fresh `Database` per run; `db.run(fixture)`; for each test, replace `__STUDENT__` with the student's query, apply any `/* after: ... */` DML first, `db.exec` and compare `JSON.stringify({columns, values})` to `expected`.
- [ ] **Step 5: Mongo adapter** (mingo): fixture → collection; test `input` `{ op, args }`; run `find`/`aggregate`/`update` and compare serialized output.
- [ ] **Step 6: Judge route** (Judge0): preamble identical to the agent route (401/403, `checkRate(user.id, 'judge')` 30/h, 413 over 64,000 chars, 503 unless `language === 'java' || JUDGE_ALL_LANGUAGES === 'true'`). `POST https://${JUDGE0_HOST}/submissions?base64_encoded=false&wait=true` with `X-RapidAPI-Key`, `X-RapidAPI-Host`, body `{ language_id: 62, source_code, stdin, cpu_time_limit: 10, wall_time_limit: 15 }`; on non-2xx or missing `status.id`, re-POST with `wait=false` and poll `GET /submissions/{token}?base64_encoded=false` every 500 ms up to 10 s. Map `status.id` 3 → pass, 5 → timeout, 6 → compile-error, else runtime-error. Client adapter posts fixture `Main.java` + student `Solution.java` per test with stdin.
- [ ] **Step 7: Tests**: each adapter grades its `seed/exercises/smoke.json` exercise green using the reference as student code (Pyodide via the `pyodide` npm package in Node; web via jsdom; judge via a fetch stub); judge route 401/413/503 cases. Commit `feat(runtimes): six adapters behind RuntimeAdapter`.

### Task A4: Exercise screen, editor, lockdown

**Files:**
- Create: `src/app/(app)/exercise/[id]/page.tsx`, `src/components/exercise/{Editor,PromptPanel,ResultsPanel,FixPlanPanel,HintButton,LockdownOverlay,PredictOutput,SpotTheBug,Trace,SchemaEditor}.tsx`, `src/hooks/useLockdown.ts`, `src/hooks/useExerciseLoop.ts`

**Interfaces:**
- Consumes: `getRuntime`, `callAgent`, `streamAgent`, `fetchBank`, `pickFromBank`, `toExercisePublic`, `nextInChain`, `applyPass/applyFail`, `pointsForPass`, `LOCKDOWN`.
- Produces: `useExerciseLoop(exerciseId)` returning `{ exercise, code, setCode, run, submit, status, results, diagnosis, hints, requestHint, next }`.

- [ ] **Step 1: Editor** = CodeMirror 6 with the language extension by `exercise.language`, `EditorView.domEventHandlers` blocking paste/copy/cut/contextmenu plus the Firefox mousedown fallback, each firing `logIntegrity(type)`.
- [ ] **Step 2: useLockdown** per spec §9 (`keyup` for PrintScreen). Batched inserts, at most one row per second per type. Fake-timer test: 14 s idle no overlay; 15 s overlay; keypress clears; 60 s → one `idle` insert.
- [ ] **Step 3: useExerciseLoop**: Run (free) → `runtime.run` with `tests: []`; Submit → all tests → insert attempt → fail path (Diagnoser via `streamAgent`; hint rule from Global Constraints; Coach via `streamAgent`) or pass path (Reviewer → points → mastery → `nextInChain` → `fetchBank` + `pickFromBank` → `next()`). **Bank-miss branch:** when `pickFromBank` returns null, call the Author with two `exampleIds` from the CLO and `parentExerciseId` (last passed on the CLO, if any); run the returned reference against the tests; on success `POST /api/exercises/verify { id }` and open it; on failure fall back to any bank exercise on the course. A spy test proves agent calls happen only on the seven triggers.
- [ ] **Step 3b: Non-code kinds**: `predict-output` textarea graded by whitespace-normalised compare; `spot-the-bug` clickable line numbers graded by set-equality against `expected` (JSON array); `trace` one input per variable graded per cell against `expected` (JSON object); `schema` through the sql adapter (fixture + student DDL, then the tests' structural queries). These call the Diagnoser on fail with the typed answer as `code` and never call the Coach with a diff.
- [ ] **Step 4: Screen** layout: prompt left, editor centre, results/fix-plan right; wellness strip collapsed at top; overlay above everything.
- [ ] **Step 5:** `npm run seed:load` (smoke exercises), then Playwright smoke locally with `AGENT_DRY_RUN=true`: wrong solution, submit, fix plan, fixed solution passes, next exercise loads with a different pattern. Commit `feat(exercise): screen, editor, lockdown, loop`.

### Task C3: Seed exercise bank (offline generation)

**Files:**
- Create: `scripts/verify-exercise.mjs`, `seed/exercises/<course>.json` (six files). Workflow: `docs/workflows/exercise-bank-generation.js`.

**Interfaces:**
- Produces at launch: 1 exercise per pattern per CLO (about 100), difficulties spread 2–4, verified by execution, plus the five smoke exercises.

- [ ] **Step 1: Node verifier** `scripts/verify-exercise.mjs <file.json>`: for each exercise runs `referenceSolution` against `tests` using the `pyodide` npm package (python), `node:vm` (javascript; `export` stripped), `sql.js` (sql, with the `__STUDENT__` and `/* after: */` conventions), `mingo` (mongo), `jsdom` (web), and Judge0 (java, only when `JUDGE0_API_KEY` is set; otherwise prints `unverified` for those and they are excluded from the merge). Exit non-zero on any failure, printing exercise title and test id.
- [ ] **Step 2: Run the workflow** via the Workflow tool with `args: { perPattern: 1 }`. Java: leave `JUDGE0_API_KEY` unset for this run unless the free-tier quota is recorded in runtime-facts and is at least 200 calls; Java seed exercises then come only from `smoke.json` plus any the workflow verifies during the pilot week.
- [ ] **Step 3:** `npm run seed:verify` passes (it now checks exercises too). Commit `feat(seed): exercise bank (launch size)`.
- [ ] **Step 4: Queue the pilot-week run**: note in `docs/build-log.md` to re-run the workflow with `perPattern: 3` and `JUDGE0_API_KEY` set, then `npm run seed:load`.

### Task C4: Drill items and onboarding fallback questions

**Files:**
- Create: `seed/drills/{predict-output,spot-the-bug,trace,hold-focus,n-back,speed-type}.json` (≥ 20 each), `src/lib/agents/fixtures/profiler-fallback.json`

- [ ] **Step 1:** Run `docs/workflows/drills-generation.js` (one agent per kind). Verify predict-output and trace by execution.
- [ ] **Step 2:** Five either-or fallback questions for the Profiler, each option tagged with its style axis. Commit `feat(seed): drills and profiler fallback`.

### Task C3b: Load the seed (end of Phase 2, Claude lane)

- [ ] As soon as C3 and C4 merge: `npm run seed:load` against the linked project; paste the counts into `docs/build-log.md`. This is a prerequisite for A4 Step 5, A5a, A5b, and C5. Re-run in C6 as a refresh.

---

## Phase 3: Surround

### Task A5a: Onboarding, buddy drawer, wellness rail

**Files:**
- Create: `src/app/(app)/onboarding/page.tsx`, `src/components/buddy/Drawer.tsx`, `src/components/wellness/{Rail,PrayerTimes,WaterStretch,Pomodoro}.tsx`, `src/lib/wellness/prayer.ts`

**Interfaces:**
- Consumes: `callAgent('profiler' | 'planner')`, `streamAgent('buddy')`, `fetchBank`, `WellnessPrefs`, `DEFAULT_WELLNESS`, `learnerState`.

- [ ] **Step 1: Onboarding**: cards driven by Profiler replies; motivation keys merged per turn; on `done`, course choice; fetch up to 30 candidates for the first three CLOs; Planner with trigger `plan-refresh`; write Learner State; dashboard. Empty candidates → the Planner's "still being prepared" focus line.
- [ ] **Step 2: Prayer** `prayer.ts`: Aladhan `timings` with `method=10`, cached by date in `localStorage`, `adhan` fallback with `CalculationMethod.Qatar()`. Toasts 10 min before and at time; queue while the exercise screen's `sessionStorage` attempt flag is set.
- [ ] **Step 3: Water/stretch/pomodoro** per spec with prefs in `wellness.prefs`.
- [ ] **Step 4: Buddy drawer**: last 6 messages, persist to `buddy_messages`, suggestion chip, off-topic reply without cursor.
- [ ] **Step 5:** Build clean, preview deploy, commit `feat(surround): onboarding, buddy, wellness`.

### Task A5b: De-rot, report, admin

**Files:**
- Create: `src/app/(app)/derot/**`, `src/components/derot/{PredictOutput,SpotTheBug,Trace,HoldFocus,NBack,SpeedType}.tsx`, `src/app/(app)/reports/**`, `src/components/report/**`, `src/app/(admin)/admin/**`, `src/app/api/admin/**`

**Interfaces:**
- Consumes: `DrillItem`, `DrillResult`, `drills` table, `learnerState`, `getUserAndProfile`, `serviceClient`, `agent_usage`.

- [ ] **Step 1: De-rot**: six components reading `drills`; countdown; scoring; `drill_results`; `hold-focus` voids on blur/scroll; `speed-type` blocks paste.
- [ ] **Step 2: Report**: A4-ratio page containers, jsPDF + html2canvas-pro behind `next/dynamic({ ssr: false })` in a `'use client'` wrapper.
- [ ] **Step 3: Admin**: every `/api/admin/*` handler and the `(admin)` layout gate with `const ids = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean); if (!user || ids.length === 0 || !ids.includes(user.id)) return 404`. Invites (mint, list), users with score and events, lift/restrict/ban (service key), bank stats per CLO per pattern, agent usage per agent per day from `agent_usage`.
- [ ] **Step 4:** Build clean, preview deploy, commit `feat(surround): derot, report, admin`.

**Capacity valve (Claude lane):** if A5a has not merged when Phase 3 opens, Claude subagents build Step 1 to 3's presentation pieces on branch `claude/A5b-valve` following the Astra operating prompt's UI direction; A5b becomes Astra's review-and-merge of that branch.

### Task C5: Integration tests, Playwright specs, PR reviews

**Files:**
- Create: `e2e/{invite-to-first-exercise,fail-fix-pass,blur-overlay}.spec.ts`, `playwright.config.ts`

- [ ] **Step 1:** Three specs per spec §15 against `npm run dev` with `AGENT_DRY_RUN=true`, a test user created through the service key in setup (session minted with the admin API; magic link not exercised here).
- [ ] **Step 2:** Review every Astra PR against the spec and contracts; reject any agent call outside the seven triggers, any select from `exercises` in client code, any `getSession()` in server code, any institution name, any client-supplied `referenceSolution`.
- [ ] **Step 3:** Commit `test(e2e): three flows`.

---

## Phase 4: Ship

### Task A6: Production deploy

- [ ] `vercel env add` for every variable in `.env.example` (production and preview). Node version 22.x in project settings.
- [ ] `vercel deploy --prod`. Register the auth hook in the Supabase dashboard. Verify a gmail sign-up is rejected on production with the hook message.
- [ ] After Musa signs in once: `vercel env add ADMIN_USER_IDS production` with his uuid, `alter database postgres set app.admin_user_ids = '<uuid>'`, redeploy.
- [ ] Run the three Playwright flows against the latest preview deploy (`AGENT_DRY_RUN=true`, service-key session, only `baseURL` changed).
- [ ] Commit `chore: production`.

### Task C6: Seed refresh and smoke with Musa

- [ ] `npm run seed:load` against production; check counts on the admin bank stats page.
- [ ] Smoke with Musa in the loop: one real `.edu.qa` magic link; one gmail rejection; one Java exercise through Judge0; Pyodide loads pandas on the data science course with visible progress; blur overlay; a paste attempt logs an event; in devtools, `supabase.from('exercises').select('reference_solution')` returns a permission error; one live (non-dry-run) Diagnoser call returns `fallback: false`.
- [ ] Musa mints invites for the beta list and sends the URL.

---

## Self-review checklist (run before handing over)

- Spec coverage: every section §2–§12 maps to a task above. §13 UI direction is enforced through the Astra operating prompt. §14–§15 are Phase 0, 4, and C5.
- No placeholders: every step names files, commands, or code.
- Type consistency: names used across tasks (`getUserAndProfile`, `serviceClient`, `toExercisePublic`, `fetchBank`, `pickFromBank`, `nextInChain`, `callAgent`, `streamAgent`, `getRuntime`, `useLockdown`, `useExerciseLoop`, `compileLearnerState`, `checkRate`) are defined once in the Interfaces block of the task that produces them.
