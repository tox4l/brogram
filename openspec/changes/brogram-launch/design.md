# Design: brogram-launch

The design is spec sections 3 to 9 of `docs/superpowers/specs/2026-09-05-brogram-design.md`:

- Section 3: System shape (browser, Vercel routes, Supabase)
- Section 4: Data model and RLS
- Section 5: Learner State and per-agent slices
- Section 6: Agent layer (seven modules, JSON mode, budgets, rate limits)
- Section 7: Exercise bank and the loop (chain rule, difficulty)
- Section 8: Code execution (RuntimeAdapter, timeouts, Judge0 for Java)
- Section 9: Lockdown and integrity escalation

Types are frozen in `docs/contracts/brogram-contracts.ts`. Versions and gotchas are in `docs/research/runtime-facts.md`.
