# Change: brogram-launch

## Why

Ship BroGram to production on 2026-09-05 by 19:00 Doha time: all seven subsystems live, invite-only, on Vercel and Supabase.

## What

The full first build as approved in `docs/superpowers/specs/2026-09-05-brogram-design.md`. That document is the source of truth; this change does not restate it.

## Scope

- Spec: `docs/superpowers/specs/2026-09-05-brogram-design.md` (sections 1 to 18)
- Contracts (frozen): `docs/contracts/brogram-contracts.ts`
- Plan: `docs/superpowers/plans/2026-09-05-brogram-build-plan.md`
- Runtime facts: `docs/research/runtime-facts.md`

## Lanes

- Claude lane: agent prompts and modules, agent route, Learner State, bank, scoring, seed generation, tests, review of Astra PRs.
- Astra lane (Codex): schema, migrations, RLS, auth hook, app shell, screens, runtimes, lockdown, wellness, de-rot, report, admin, deploy.
- Musa: projects, secrets, invite list, PR approval, taste calls.
