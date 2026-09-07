# E2E (Playwright)

The v2 flows from spec §15 and Wave 3's own acceptance block, run against `npm run dev` with
`AGENT_DRY_RUN=true` and a test user minted through the Supabase service key. Every test starts with
`test.skip(...)` when the required env vars are missing, so the suite is safe to run without a project
wired up — it simply reports every Supabase-backed spec as skipped.

## Specs

- `invite-to-first-exercise.spec.ts` — sign-in → the six onboarding questions (no loading state between
  cards) → course picker → course home → a walkthrough (when one leads) → the first rep.
- `fail-fix-pass.spec.ts` — fail a submit, get a fix plan, ask for a hint, pass, chain continues. The
  `graded` verdict paints before each `attempts` save lands, not after. Mints its own one-off `.edu.qa`
  account per run (random email, full teardown).
- `blur-overlay.spec.ts` — open a smoke exercise, blur the window, assert the lockdown overlay, focus
  back, assert it's gone and an `integrity_events` row was written; then three PrintScreen presses,
  which never draw an overlay and surface one honest line on the third press.
- `onboarding-once.spec.ts` — the six questions once, then two course switches that call the Planner in
  the background but never reach the Profiler again (R4.4's named assertion).
- `walkthrough.spec.ts` — open a walkthrough, run its snippet, miss a check then get it right, finish,
  land on the rep for the same CLO.
- `dock-and-theme.spec.ts` — the wellness dock through all five placements plus a collapse, all four
  themes, reload — every choice survives.
- `consecutive-runs.spec.ts` / `python-run.spec.ts` — pre-v2 runtime-loop coverage, owned by the
  exercise-loop lane, not this task.

`invite-to-first-exercise` and `blur-overlay` share one reused `.edu.qa` account (`E2E_TEST_EMAIL`) since
`playwright.config.ts` runs with `workers: 1`; each resets that account's `learner_state`, `attempts`,
`integrity_events` and `profiles.account_status` before and after it runs, so order between them doesn't
matter. `onboarding-once`, `walkthrough` and `dock-and-theme` each mint their own one-off `.edu.qa`
account instead (fresh learner state per run, full teardown).

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

## Java specs (opt-in)

The two specs under `e2e/java/` are excluded from the default suite: both need
`public/java/tools.jar` (gitignored, produced by `npm run prepare:java`) and both
load the CheerpJ runtime from its vendor CDN, so the normal suite must not depend
on them. Neither needs Supabase.

```
RUN_JAVA_E2E=1 npx playwright test e2e/java/java-runtime.spec.ts --project=chromium
RUN_JAVA_BANK=1 npx playwright test e2e/java/verify-java-bank.spec.ts --project=chromium
```

- `java-runtime.spec.ts` grades smoke.json's "Shapes report" through the real
  adapter (5/5) and asserts that broken source comes back as `compile-error`;
  it also runs an inline battery of reflection-based exit-vector probes
  against the in-JVM security manager (denied, worker survives) and an inline
  battery of legitimate Java features (streams, lambdas, `java.time`, ...) to
  prove the guard does not collaterally break them. One documented residual
  remains — see the "declared-member gate" comment above `exploitBank` in that
  file and the runtime report's known-limits section.
- `verify-java-bank.spec.ts` certifies every code exercise in
  `seed/exercises/INFS3102.json` plus the smoke exercise, prints the table, and
  fails if any reference solution stops passing its own tests. Run it after any
  change to the Java engine or to a Java exercise.

Both drive the development-only page `/preview/java-verify` and inject the
exercises with `page.addInitScript`; reference solutions are read in Node and
never bundled into the app. Add `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000` to
reuse a dev server you already have.

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
