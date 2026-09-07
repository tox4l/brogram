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

## v2 (plan: docs/superpowers/plans/2026-09-06-brogram-v2-plan.md; spec: docs/superpowers/specs/2026-09-06-brogram-v2-bro.md)
- [x] T0.0 Dependency and script bootstrap (serial, first, alone) (d7fb7e3)
- [x] T0.1 The contracts PR (36e7508, a76494f; typecheck sweep 7946cc5)
- [x] T0.2 Migrations, seed loader, validator, golden lesson (d7a7946, 5b82340, ff376e9; live apply pending on Musa)
- [x] T0.3 The static curriculum bundle (a43196f, 5d17e33)
- [x] T0.4 TanStack Query provider, hydration, query keys (10a2a9c, 0699430)
- [x] T0.5 Sound manager and motion manager (1f8e4f5, 2528bfe)
- [x] T0.6 Themes: four palettes, tokens, provider, no flash (31e2e30, ae72325)
- [x] T0.7 Shell recomposition (Group C) (9e36834, 5789e7d)
- [x] T1.1 Lesson generation workflow, verifier, and the first batch (8dd010b, 3c4d110, 92f231b, b6dff4f, 52ac7db)
- [x] T1.2 Lesson grading and progress (pure) (96663ee, f15b63e)
- [x] T1.3 The walkthrough screen (Group B) (8388d71, 9c440dd)
- [x] T1.4 Course home and the path map (d84680e, a61508f)
- [x] T1.5 Onboarding once: six local questions (302b44e, 912b94c)
- [x] T1.6 `/courses`, the optimistic course switch, and the proxy matcher (3adfda2, b94b215)
- [ ] T2.1 Data layer: `(app)/layout.tsx` and the dashboard
- [ ] T2.2 The optimistic submit path
- [ ] T2.3 Data layer: Progress and Account
- [ ] T2.4 The wellness dock
- [ ] T2.5 Rewards: XP, levels, streaks, achievement predicates (pure)
- [ ] T2.6 Rewards: celebrations, counters and the trophy shelf
- [ ] T2.7a The voice bank (Group A)
- [ ] T2.7b The copy sweep (Group C, serial, last)
- [ ] T2.8 Honest lockdown and the integrity receipt
- [ ] T2.9a De-rot Arcade: the hub, the run model, score normalisation
- [ ] T2.9b De-rot Playground: six non-coding games
- [ ] T2.10 Agent identity rewrites (copy only, no schema touched)
- [ ] T2.11 Buddy drawer polish
- [ ] T3.1 The bundle budget, generated from a measurement
- [ ] T3.2 Timings, vitals, and the local diagnostics buffer
- [ ] T3.3 e2e updates
- [ ] T3.4 The no-agent-surfaces test
- [ ] T3.5 Openness: the work items that make a fork real
- [ ] T3.6 Whole-branch review (Group B)
- [ ] T3.7 Deploy and the ten-minute acceptance run (Group C)
