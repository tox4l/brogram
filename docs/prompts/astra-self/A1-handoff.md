# A1 offline handoff

The offline implementation and verification are complete. No network, database connection, real credentials, branch switch, CLI installation, or remote mutation was used. Git metadata permissions prevented exclude cleanup and commit; files remain in the shared workspace.

## Files

- `supabase/migrations/0001_init.sql`
- `supabase/migrations/0002_auth_hook.sql`
- `supabase/migrations/0003_integrity.sql`
- `supabase/config.toml`
- `scripts/seed-load.mjs`
- `src/lib/supabase/server.ts` (real implementation replaces the excluded placeholder)
- `docs/prompts/astra-self/A1.md`
- `docs/prompts/astra-self/A1.offline.test.mjs`
- `docs/prompts/astra-self/A1-handoff.md`

The three migrations were extracted directly from Task A1's SQL fences and checked for exact string equality. The only addition is the specifically requested final line of 0002: `alter database postgres set app.invites_required = 'true';`. Config contains only `project_id = "brogram"` plus a final newline.

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
tests 11
suites 0
pass 11
fail 0
cancelled 0
skipped 0
todo 0
```

Tests cover the standard UUIDv5 vector, deterministic exercise IDs, metadata and column filtering, preservation of hidden expected values and drill payload keys, missing optional folders, no-fetch dry run, required variables, .env.local/environment precedence, upsert ordering/conflicts, failure propagation, verified user/profile filtering, cookie writes, readonly cookies, and service-role isolation. The initial run failed on the absent loader and on placeholder auth/error behavior; the final run passed. A separate local fetch interception using the actual seed bank verified all five ordered POST payloads, conflict keys, and unique IDs without network.

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

## Local API evidence for Claude's build log

- Installed versions: Next 16.3.4, `@supabase/ssr` 0.12.6, `@supabase/supabase-js` 2.115.0.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`: cookies() is asynchronous; set(name, value, options) is supported in Route Handlers/Server Functions and unavailable during Server Component rendering.
- `node_modules/@supabase/ssr/src/createServerClient.ts`: create a fresh client per request; use getAll/setAll, not deprecated get/set/remove; proxy/middleware must handle refresh when rendering cannot write cookies.
- `node_modules/@supabase/auth-js/src/GoTrueClient.ts`: getUser returns UserResponse. The helper denies identity when its error is non-null and never calls getSession.
- `node_modules/@supabase/postgrest-js/src/PostgrestTransformBuilder.ts`: maybeSingle permits a missing profile; actual query errors are surfaced instead of returning stale data.
- `node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts`: upsert supports onConflict and defaultToNull; false sends missing=default, avoiding null in heterogeneous seed rows. Explicit SQL defaults are also mapped.
- `node_modules/@types/node/util.d.ts`: parseEnv parses dotenv content without a dependency or changing process.env. Environment values override .env.local values; dry run does not read .env.local or construct a client.
- Exercise namespace is the fixed DNS UUID namespace `6ba7b810-9dad-11d1-80b4-00c04fd430c8`; IDs hash the UTF-8 string `cloId + '|' + title`. Keep this namespace stable across future seed runs.

## Pending Git steps for Musa or the Claude lane

The sandbox permits reading Git metadata but denied its writes. Removing the exact exclude entry failed with `Access to the path '.../.git/info/exclude' is denied.` The required path-scoped git add failed twice, with a five-second wait between attempts:

```text
fatal: Unable to create 'C:/Users/musal/OneDrive/Desktop/V/Brogram/.git/index.lock': Permission denied
```

No index lock was removed, permissions changed, branch switched, or commit claimed. Run from an authorized PowerShell in the repository:

```powershell
$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = 'C:/Users/musal/OneDrive/Desktop/V/Brogram'
$excludePath = Join-Path (Get-Location).Path '.git/info/exclude'
$excludeText = [System.IO.File]::ReadAllText($excludePath)
$updatedExclude = [regex]::Replace($excludeText, '(?m)^/?src/lib/supabase/server\.ts\r?\n?', '')
[System.IO.File]::WriteAllText($excludePath, $updatedExclude, [System.Text.UTF8Encoding]::new($false))
git add supabase scripts/seed-load.mjs src/lib/supabase/server.ts docs/prompts/astra-self
git diff --cached --name-only
git commit --only -m "feat(db): schema, rls, auth hook, integrity, seed loader, server helpers" -- supabase scripts/seed-load.mjs src/lib/supabase/server.ts docs/prompts/astra-self
```

The path-scoped commit preserves any separately staged Claude changes. Retry an index.lock collision after five seconds; an access-denied error needs a shell authorized to write Git metadata.

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

1. **Claude: correct the SQL profile guard in a reviewed follow-up before live rollout.** In the verbatim plan, profile_guard checks auth.role(), the JWT role, while apply_integrity_escalation and lift_expired_restriction are SECURITY DEFINER. A request from an authenticated user retains its JWT role inside those functions, so their status updates are expected to hit the guard and roll back. This is a static review finding, not a live database result. Preserve ordinary users' inability to update status when correcting it.
2. **Claude: reconcile the spec's banned-user read rule.** The verbatim `own attempts` and `own state` policies test ownership without is_not_banned, although spec section 2 says banned users cannot read attempts or learner_state. The exercise view's ban filter is present as required. No SQL was changed beyond the exact requested blocks.
3. **Claude: record local A1 progress and API notes in the shared ledger/build log.** Both already contained concurrent Claude edits and are outside the user's staging allowlist. Keep full A1 pending until Git and live Supabase steps finish. The task file's hook-redemption expectation should be corrected to match the read-only hook in the plan.
4. Seed upserts are idempotent per table, not a cross-table transaction; a failure can leave earlier tables updated, and rerunning resumes by upsert. Current95 versus expected110 reflects the actual approved top-level files, not a loader omission.
5. A2 must supply proxy/middleware cookie refresh for Server Component use. Database permissions, deployed auth behavior, and real uploads remain unverified until Musa performs the pending steps.
