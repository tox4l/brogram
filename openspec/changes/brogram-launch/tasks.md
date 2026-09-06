# Tasks: brogram-launch

Both lanes tick this file. Task text lives in `docs/superpowers/plans/2026-09-05-brogram-build-plan.md`.

## Phase 0: Bootstrap
- [x] A0 Scaffold the app and deploy — scaffold, install, build, commit by Claude; repo created and pushed to https://github.com/tox4l/brogram on 2026-09-06; Vercel deploy is Musa's (import the repo)
- [x] C0 Test scaffold and contracts guard (Claude)

## Phase 1: Core
- [x] A1 Supabase schema, RLS, auth hook, seed loader, server helpers — migrations applied 2026-09-06 over Postgres (pooler ap-south-1) and recorded in supabase_migrations; all SQL checks pass; ONE manual step left: register public.hook_gate_signup under Authentication, Hooks, Before User Created
- [x] A2 App shell, auth, dashboard skeleton (Astra) — local build and 415 tests green; live Supabase gates and preview pending for Musa; working tree ready for Claude to commit
- [x] C1 Agent modules, agent route, exercise-verify route (Claude) — 5e717fb, 06c64d0, 0819a69, 80244f0; Opus review and Codex cross-review clean after three fix rounds; live DeepSeek check green on 2026-09-06 (profiler, planner, coach stream valid; round 6 fixed allowSystemInMessages and thinking off)
- [x] C2 Learner State, bank query, chain rule, scoring, ban math (Claude) — d3991d8, 039595c, 451b001; Opus review and Codex cross-review both clean after two fix rounds

## Phase 2: Exercise
- [x] A3 Runtime adapters (Astra) — SQL review delta applied; 514 tests and production build green; all worker bundles compiled through a temporary entry then removed. Manual browser infinite-loop timing and live Judge0 remain pending for Musa; working tree ready for Claude to commit.
- [x] A4 Exercise screen, editor, lockdown (Astra) — A2 review delta applied first; 574 tests and production build green; Playwright smoke spec/config collected (1 test). Browser execution and seed-load counts explicitly pending Claude C5 with Supabase configuration. Working tree ready for Claude to review and commit; no git mutations by Astra.
- [x] C3 Seed exercise bank, offline generation (Claude) — 95 exercises at top level (88 verified by execution), 15 Java code exercises in unverified/
- [x] C4 Drill items and onboarding fallback questions (Claude) — 144 drills (69672c6); profiler-fallback.json shipped inside C1 (5e717fb)
- [x] C3b Load the seed to Supabase (Claude) — 2026-09-06: patterns 42, courses 6, clos 26, exercises 95, drills 144

## Phase 3: Surround
- [x] A5a Onboarding, buddy drawer, wellness rail (built by Claude subagents under the capacity valve while Codex was down; 1b51977, 1741a41, 8dc981f plus fix rounds; Opus review clean after fixes; live walk-through pending Supabase)
- [x] A5b De-rot, report, admin (Claude under the capacity valve; components 8743575, ccf018e, 4874144; pages eb531e2, 104c109, 2792249 plus fix rounds; Opus review clean after fixes; live walk-through pending Supabase)
- [x] C5 Integration tests, Playwright specs, PR reviews (Claude) — three flows (5c37091) RUN GREEN against the real project on 2026-09-06 (3b7f24d); every Astra task reviewed

## Phase 4: Ship
- [ ] A6 Production deploy (Astra)
- [ ] C6 Seed refresh and smoke with Musa (Claude)
