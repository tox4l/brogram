<task>
Execute Task A1 from docs/superpowers/plans/2026-09-05-brogram-build-plan.md: install the Supabase CLI via Scoop, link the project, write the three migrations EXACTLY as given in the plan (0001_init, 0002_auth_hook, 0003_integrity), push them, verify the hook function rejects a gmail address and accepts an invited .edu.qa address in the SQL editor, and write scripts/seed-load.mjs that upserts seed/courses.json, seed/clos.json, seed/patterns.json, seed/exercises/*.json (if present), and seed/drills/*.json (if present) using the service role key. Branch: astra/A1.
</task>

<context>
Musa provides SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ACCESS_TOKEN in .env.local. Never run `supabase login`; export SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD and run `supabase link --project-ref $SUPABASE_PROJECT_REF` (runtime-facts, Supabase). If any of the four is missing, stop and report exactly which.
This task also creates src/lib/supabase/server.ts exporting getUserAndProfile() and serviceClient() with the exact signatures in the operating prompt's ownership block, because Claude's routes import them in Phase 1.
The hook must be registered in the Supabase Dashboard under Authentication, Hooks, Before User Created, as the Postgres function public.hook_gate_signup. You cannot do that from the CLI; report it as the one manual step for Musa with the exact function name.
</context>

<end_state>
- supabase db push succeeds; all tables, view, functions, triggers, and policies exist.
- select public.hook_gate_signup('{"user":{"email":"x@gmail.com"}}'::jsonb) returns the 403 error object.
- With an invites row for test@udst.edu.qa, the same call for that email returns {} and marks the invite redeemed.
- exercises_public omits reference_solution and keeps every test's expected value (verify with a select). Running `set role authenticated; select reference_solution from public.exercises limit 1;` in the SQL editor errors with permission denied; `set role anon; select count(*) from public.exercises_public;` also errors.
- An authenticated update of profiles.restricted_until or account_status is rejected (test with a throwaway user and `set role authenticated` plus a request.jwt.claim.sub setting, or through the app after A2).
- node scripts/seed-load.mjs prints counts for courses (6), clos (26), patterns (42), and exercises and drills (0 if those seed folders do not exist yet; the loader must not fail on a missing folder).
- Tables drills and agent_usage exist with RLS enabled; drills readable by non-banned users; agent_usage has no client policy.
</end_state>

<verification_loop>
Paste the output of supabase db push, the three SQL checks, and the seed loader. If any policy references a column that does not exist, fix the migration, do not skip the policy.
</verification_loop>

<action_safety>
Never run supabase db reset against the linked remote. Do not alter the contracts. If a column type in the plan conflicts with a contracts type, keep the contracts type and note it.
</action_safety>
