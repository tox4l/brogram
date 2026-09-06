# E2E (Playwright)

Three flows from spec §15, run against `npm run dev` with `AGENT_DRY_RUN=true` and a test user minted
through the Supabase service key. No Supabase project is wired up in this sandbox, so these specs are
written and type-checked here but not executed — every test starts with `test.skip(...)` when the
required env vars are missing.

## Specs

- `fail-fix-pass.spec.ts` — fail a submit, get a fix plan, ask for a hint, pass, chain continues. Mints
  its own one-off `.edu.qa` account per run (random email, full teardown).
- `invite-to-first-exercise.spec.ts` — invite exists → session minted → onboarding (Profiler dry-run
  cards, both phases) → pick a live course → dashboard → open the first exercise.
- `blur-overlay.spec.ts` — open a smoke exercise, blur the window, assert the lockdown overlay, focus
  back, assert it's gone and an `integrity_events` row was written.

`invite-to-first-exercise` and `blur-overlay` share one reused `.edu.qa` account (`E2E_TEST_EMAIL`) since
`playwright.config.ts` runs with `workers: 1`; each resets that account's `learner_state`, `attempts`,
and `integrity_events` before and after it runs, so order between them doesn't matter.

## Run locally

1. Set env vars (e.g. in `.env.local`, already read by `npm run dev`, or exported in your shell before
   the `playwright test` invocation):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `E2E_TEST_EMAIL` — any address ending in `.edu.qa`, e.g. `e2e@brogram.edu.qa`
2. Load the seed (including `seed/exercises/smoke.json`, which these specs read from directly):
   ```
   node scripts/seed-load.mjs
   ```
3. Run the specs. `playwright.config.ts` already starts `npm run dev` with `AGENT_DRY_RUN=true` for you:
   ```
   npx playwright test
   ```

## Run against a preview deploy

Point `PLAYWRIGHT_BASE_URL` at the deploy (A6 does this without changing anything else); the config skips
its own `webServer` whenever that variable is set:

```
PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app npx playwright test
```

The preview must itself be running with `AGENT_DRY_RUN=true` and the same seed loaded for these specs to
pass; the four env vars above are still required locally to mint the session and read/reset rows through
the service key.

## Not covered here

The real magic-link email delivery and the real Supabase auth hook are manual checks under C6. These
specs mint a session directly from the token `supabase.auth.admin.generateLink` returns (the same
technique `fail-fix-pass` already used), which exercises everything downstream of the link except the
email itself.
