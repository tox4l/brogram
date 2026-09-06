# Tasks: brogram-launch

Both lanes tick this file. Task text lives in `docs/superpowers/plans/2026-09-05-brogram-build-plan.md`.

## Phase 0: Bootstrap
- [ ] A0 Scaffold the app and deploy (Astra) — local part done by Claude (scaffold, install, build, commit c4365e6); Vercel deploy and GitHub push wait for Musa's logins
- [x] C0 Test scaffold and contracts guard (Claude)

## Phase 1: Core
- [ ] A1 Supabase schema, RLS, auth hook, seed loader, server helpers (Astra)
- [x] A2 App shell, auth, dashboard skeleton (Astra) — local build and 415 tests green; live Supabase gates and preview pending for Musa; working tree ready for Claude to commit
- [x] C1 Agent modules, agent route, exercise-verify route (Claude) — 5e717fb, 06c64d0, 0819a69, 80244f0; Opus review and Codex cross-review clean after three fix rounds; live DeepSeek call still unproven (no key)
- [x] C2 Learner State, bank query, chain rule, scoring, ban math (Claude) — d3991d8, 039595c, 451b001; Opus review and Codex cross-review both clean after two fix rounds

## Phase 2: Exercise
- [x] A3 Runtime adapters (Astra) — SQL review delta applied; 514 tests and production build green; all worker bundles compiled through a temporary entry then removed. Manual browser infinite-loop timing and live Judge0 remain pending for Musa; working tree ready for Claude to commit.
- [x] A4 Exercise screen, editor, lockdown (Astra) — A2 review delta applied first; 574 tests and production build green; Playwright smoke spec/config collected (1 test). Browser execution and seed-load counts explicitly pending Claude C5 with Supabase configuration. Working tree ready for Claude to review and commit; no git mutations by Astra.
- [x] C3 Seed exercise bank, offline generation (Claude) — 95 exercises at top level (88 verified by execution), 15 Java code exercises in unverified/
- [x] C4 Drill items and onboarding fallback questions (Claude) — 144 drills (69672c6); profiler-fallback.json shipped inside C1 (5e717fb)
- [ ] C3b Load the seed to Supabase (Claude)

## Phase 3: Surround
- [ ] A5a Onboarding, buddy drawer, wellness rail (Astra)
- [ ] A5b De-rot, report, admin (Astra; capacity valve may move presentation pieces to Claude)
- [ ] C5 Integration tests, Playwright specs, PR reviews (Claude)

## Phase 4: Ship
- [ ] A6 Production deploy (Astra)
- [ ] C6 Seed refresh and smoke with Musa (Claude)
