# A1 offline handoff

A1 landed as `6fc5e6e`; A2 subsequently landed as `e118855`. The seven-file A1 hardening delta is applied and remains unstaged and uncommitted for the Claude lane. No network, database connection, real credentials, branch change, CLI installation, or Git metadata write was used for this delta. All SQL remains unexecuted; there is no local Postgres.

## Files changed by this hardening delta

- `supabase/migrations/0001_init.sql`
- `supabase/migrations/0002_auth_hook.sql`
- `supabase/migrations/0003_integrity.sql`
- `scripts/seed-load.mjs`
- `docs/prompts/astra-self/A1.md`
- `docs/prompts/astra-self/A1.offline.test.mjs`
- `docs/prompts/astra-self/A1-handoff.md`

The unpushed migrations are hardened in place: authenticated holds only SELECT on the exercise view, the view has a security barrier, all six SECURITY DEFINER functions fix search_path to public then pg_temp, the auth hook role has schema usage, and integrity escalation tolerates whitespace around admin-ID commas without extending an existing future restriction. The database-level invite setting is now a manual SQL-editor step below. Earlier fixes to the profile guard and banned-user read policies are preserved.

## Verification evidence

`node scripts/seed-load.mjs --dry-run` (exit 0):

```text
Dry run: no database connection.
patterns: 42
courses: 6
clos: 26
exercises: 95
drills: 144
```

The current top-level exercise files total 95: DSAI2201 16, INFS1101 19, INFS1201 20, INFS2101 14, INFS2201 19, INFS3102 2, smoke 5. Nested `unverified/` content is intentionally excluded by the user's top-level rule. No seed data was changed to match the older expected 110.

`node --test docs/prompts/astra-self/A1.offline.test.mjs` (exit 0):

```text
tests 15
suites 0
pass 15
fail 0
cancelled 0
skipped 0
todo 0
```

Tests cover the standard UUIDv5 vector, deterministic exercise IDs, metadata and column filtering, preservation of hidden expected values and drill payload keys, missing optional folders, no-fetch dry run, required variables, .env.local/environment precedence, upsert ordering/conflicts, failure propagation, verified user/profile filtering, cookie writes, readonly cookies, and service-role isolation. Four new regressions exercise empty, spaces-only, mixed-whitespace, and undefined environment credentials against synthetic .env.local values through the actual client with fetch intercepted locally. All four failed before the merge fix (11 pass, 4 fail), then passed after it (15 pass, 0 fail). Nonblank URL/key overrides and rejection of missing or blank credentials without a local fallback also pass.

All three migrations were re-read in full for SQL/PLpgSQL syntax, with an independent static review of the hardening changes. No syntax concerns were found. This is a source review, not a database execution or proof of deployed privileges; all SQL and the post-push probes below remain unexecuted.

## Historical original A1 verification (not rerun for this delta)

`npm.cmd test` (exit 0):

```text
Test Files  22 passed (22)
     Tests  210 passed (210)
  Start at  22:40:02
  Duration  5.57s (environment 95%, import 2%, transform 2%, tests 1%)
```

`npm.cmd run build` (exit 0):

```text
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/agent
└ ƒ /api/exercises/verify

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

`npx.cmd tsc --noEmit` (exit 0): no output.

Existing tooling notices remain: Next ignores an ancestor package-lock.json outside this repository; Vitest recommends native Vite tsconfig paths instead of the configured plugin. Neither check failed. Configuration belongs to other task paths and was not changed.

## Original A1 local API evidence for Claude's build log

- Installed versions: Next 16.3.4, `@supabase/ssr` 0.12.6, `@supabase/supabase-js` 2.115.0.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`: cookies() is asynchronous; set(name, value, options) is supported in Route Handlers/Server Functions and unavailable during Server Component rendering.
- `node_modules/@supabase/ssr/src/createServerClient.ts`: create a fresh client per request; use getAll/setAll, not deprecated get/set/remove; proxy/middleware must handle refresh when rendering cannot write cookies.
- `node_modules/@supabase/auth-js/src/GoTrueClient.ts`: getUser returns UserResponse. The helper denies identity when its error is non-null and never calls getSession.
- `node_modules/@supabase/postgrest-js/src/PostgrestTransformBuilder.ts`: maybeSingle permits a missing profile; actual query errors are surfaced instead of returning stale data.
- `node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts`: upsert supports onConflict and defaultToNull; false sends missing=default, avoiding null in heterogeneous seed rows. Explicit SQL defaults are also mapped.
- `node_modules/@types/node/util.d.ts`: parseEnv parses dotenv content without a dependency or changing process.env. With this hardening delta, only environment values that remain nonblank after trim override .env.local values; dry run does not read .env.local or construct a client.
- Exercise namespace is the fixed DNS UUID namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8`; IDs hash the UTF-8 string `cloId + '|' + title`. Keep this namespace stable across future seed runs.

## Git status for Musa and the Claude lane

The earlier Git steps are complete:

- A1: `6fc5e6e` — `feat(db): schema, rls, auth hook, integrity, seed loader, server helpers`.
- A2 followed as `e118855` — `feat(app): shell, magic link auth, dashboard skeleton`.
- `src/lib/supabase/server.ts` is tracked and its exclude entry is absent. No .git/info/exclude edit is outstanding.

Read-only Git inspection confirmed this record. Only the seven-file hardening delta listed above awaits the Claude lane's review and commit. This run did not stage, commit, edit Git metadata, create a branch, or switch branches.

## Pending Supabase steps for Musa

All of the following were explicitly skipped for this offline run. Run in PowerShell with the real values supplied locally (never committed):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
supabase init
$env:SUPABASE_ACCESS_TOKEN = '<SUPABASE_ACCESS_TOKEN>'
$env:SUPABASE_DB_PASSWORD = '<SUPABASE_DB_PASSWORD>'
$env:SUPABASE_PROJECT_REF = '<SUPABASE_PROJECT_REF>'
supabase link --project-ref $env:SUPABASE_PROJECT_REF
supabase db push
node scripts/seed-load.mjs
```

`supabase/config.toml` already exists with the requested project_id; inspect any init prompt about the existing config and retain project_id `brogram`. The loader needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in .env.local or the environment. No supabase login or remote database reset is part of this handoff.

Register **public.hook_gate_signup** in Supabase Dashboard → Authentication → Hooks → Before User Created → Postgres function.

After applying the migrations, run this owner-only statement manually in the Supabase SQL editor; it is deliberately outside the migration because the migration role may not own the database:

```sql
alter database postgres set app.invites_required = 'true';
```

The hook's coalesce default already requires invites when the setting is absent. Database-level settings only reach new GoTrue database connections; existing pooled connections keep their prior setting until they reconnect. The same timing applies when manually changing this to `'false'` after beta.

After applying the migrations, run these SQL editor checks. The invite test is rolled back so it leaves no test invite:

```sql
select public.hook_gate_signup('{"user":{"email":"x@gmail.com"}}'::jsonb);
-- Expected: error.http_code = 403.

begin;
insert into public.invites (code, email)
values ('a1-check-' || gen_random_uuid()::text, 'test@udst.edu.qa')
on conflict (email) do update set redeemed_at = null, redeemed_by = null;
select public.hook_gate_signup('{"user":{"email":"test@udst.edu.qa"}}'::jsonb);
-- Expected: {}. Calling the hook does NOT redeem the invite.
select redeemed_at, redeemed_by from public.invites where email = 'test@udst.edu.qa';
-- Expected: both null; actual user creation performs redemption.
rollback;

select grantee, privilege_type from information_schema.role_table_grants where table_name = 'exercises_public';
-- Expected: exactly authenticated SELECT, plus postgres and service_role grants.
-- No other authenticated privileges and no anon or PUBLIC grants.

set role authenticated;
delete from public.exercises_public where false;
-- Must return permission denied, even though no rows would be deleted.
-- Run RESET separately after the error.
reset role;

set role authenticated;
select reference_solution from public.exercises limit 1;
-- Expected: permission denied. Run RESET separately after the error.
reset role;

set role anon;
select count(*) from public.exercises_public;
-- Expected: permission denied. Run RESET separately after the error.
reset role;
```

With a real active throwaway user, verify exercises_public omits reference_solution and keeps tests.expected, authenticated profile status/restriction updates are denied, banned accounts cannot read exercises_public, and restricted accounts cannot insert attempts. Confirm every table has RLS, drills is readable only by non-banned users, and agent_usage has no client policy. Verify real magic-link rejection and invite redemption when auth creates the user. These checks were not run offline.

## Delta requests and residual risks

1. **Claude: review and commit this seven-file hardening delta.** No additional implementation delta is requested. Shared ledger/build-log files remain under the Claude lane's control and were not touched.
2. Database permissions, restriction timing, deployed auth behavior, and real uploads remain unverified until the pending Supabase steps run. All SQL is unexecuted; no local Postgres is available.
3. Seed upserts are idempotent per table, not a cross-table transaction; a failure can leave earlier tables updated, and rerunning resumes by upsert. The current 95 exercises reflect the approved top-level files, not a loader omission.
