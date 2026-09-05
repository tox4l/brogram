# BroGram build: start prompt

Paste everything below the line into the new Claude Code session opened in this folder (the Codex plugin is loaded there). Before pasting, Musa does the pre-flight list at the bottom.

---

ultracode

You are the Claude lane of a two-lane team building and shipping BroGram today. Your operating prompt is `docs/prompts/claude-operating-prompt.md`. Read it first, then the files it lists, in that order, completely. Everything is decided; nothing in the spec is up for debate. Your job is execution and orchestration.

Facts about this environment you must not rediscover:
- The Codex plugin is installed. Delegate Astra tasks with `/codex:rescue --background --fresh Read docs/prompts/astra-operating-prompt.md, then docs/prompts/astra-tasks/<file>.md, and execute that task fully on branch astra/<id>.` Leave `--model` and `--effort` unset; Codex is already configured for `gpt-6-astra` at `ultra`. You cannot invoke `/codex:status`, `/codex:result`, or `/codex:review` yourself; call the companion script with Bash exactly as the operating prompt shows. Never use `--resume`; deltas are fresh rescues that name the branch. Codex runs one write task at a time in this tree, so Astra tasks are serial; your own lane runs alongside them.
- Ultracode is on. Use Workflow scripts for anything that fans out: the seed exercise bank (`docs/workflows/exercise-bank-generation.js`), the drills (`docs/workflows/drills-generation.js`), and multi-file reviews. Subagents default to Sonnet at max effort; Opus at max effort for review, verification, and the agent modules. Do not spawn Fable subagents unless a task fails twice on Opus for reasoning reasons.
- The runtime facts in `docs/research/runtime-facts.md` were web-verified today and corrected several wrong assumptions: DeepSeek models are `deepseek-v4-flash` and `deepseek-v4-pro`; the public Piston API is whitelist-only so Java uses Judge0 CE; Vercel breaks on pnpm 11 so this repo uses npm; Pyodide timeouts use worker termination with a warm standby, no COOP/COEP. Trust that file over memory.
- This folder is the app root. `docs/` and `seed/` already exist and are part of the deliverable. The `UDST START` folder and `BroGram.pdf` are source material that must never be committed; `.gitignore` already excludes them.
- Musa's pre-flight items (below) are either done or he will hand them to you when a task asks. If a secret is missing when you need it, ask for that one value and keep working on everything else.

Start now:
1. Read the operating prompt and the files it lists.
2. Set up the OpenSpec ledger if `openspec` installs in under two minutes; otherwise use the plan's checkboxes.
3. Kick off Astra on A0 immediately (background). While it runs, do C0 yourself. When A0's URL is back, kick off A1, and start C1 and C2 with Opus subagents. A2 starts when A1's PR is reviewed, and so on down the serial Astra list.
4. Follow the phase table in the plan. Deploy a preview at the end of every phase. Review every Astra PR with a fresh Opus subagent; send deltas back as fresh rescues naming the branch. Get each of your own PRs reviewed with the companion script's `review --base main`.
5. Append one line per decision or lesson to `docs/build-log.md` as you go.
6. At the end of each phase, post one short outcome-first message to Musa with the preview URL, what is red, and what you need.
7. Stop only at the finish line in the operating prompt, with the evidence list filled in.

The deadline is 19:00 Doha time today. It is achievable because the surface is thin and the decisions are made. Go.

---

## Musa's pre-flight (10 minutes, before pasting)

1. **DeepSeek:** API key from platform.deepseek.com. Keep it in your password manager; Vercel will not show it again.
2. **Supabase:** create the project (region closest to Doha), note the project ref, database password, anon key, service role key, and create a personal access token at supabase.com/dashboard/account/tokens (the CLI links non-interactively with it; nobody runs `supabase login`).
3. **Vercel:** `npm i -g vercel` then `vercel login` in a terminal in this folder.
4. **GitHub:** `winget install --id GitHub.cli --source winget`, open a new terminal, `gh auth login`.
5. **Judge0:** rapidapi.com, subscribe to `judge0-ce` Basic (free), copy the `X-RapidAPI-Key`. Write the free-tier quota you see into `docs/research/runtime-facts.md` under Java judge.
6. **Scoop** (for the Supabase CLI): if `scoop` is not installed, run in PowerShell: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser; irm get.scoop.sh | iex`.
7. **Invite list:** the `.edu.qa` emails for the beta, one per line, in a file outside the repo. You will mint them from the admin page at the end.
8. Optional: the INFS1201 syllabus, dropped into the `UDST START` folder, so Claude can replace the drafted CLOs.

Put the keys in `.env.local` in this folder (it is gitignored) so both lanes can read them:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_PROJECT_REF=
SUPABASE_DB_PASSWORD=
SUPABASE_ACCESS_TOKEN=
DEEPSEEK_API_KEY=
JUDGE0_HOST=judge0-ce.p.rapidapi.com
JUDGE0_API_KEY=
JUDGE_PROVIDER=judge0
JUDGE_ALL_LANGUAGES=false
INVITES_REQUIRED=true
AGENT_DRY_RUN=false
ADMIN_USER_IDS=
```

## What is in this package

| Path | What |
|---|---|
| `START-PROMPT.md` | this file |
| `docs/superpowers/specs/2026-09-05-brogram-design.md` | the approved design, every decision |
| `docs/superpowers/plans/2026-09-05-brogram-build-plan.md` | phases, lanes, tasks A0–A6 and C0–C6, with migration SQL and route code |
| `docs/contracts/brogram-contracts.ts` | the frozen TypeScript seam (typechecked) |
| `docs/research/runtime-facts.md` | verified versions, commands, gotchas, and the decisions they changed |
| `docs/prompts/agents/*.md` | the seven DeepSeek agents: system prompts, Zod schemas, fallbacks, fixtures |
| `docs/prompts/claude-operating-prompt.md` | how the Claude lane works |
| `docs/prompts/astra-operating-prompt.md` | how the Astra lane works (Codex XML contract) |
| `docs/prompts/astra-tasks/A0–A6.md` | one prompt per delegated Astra task (A5 is split into A5a and A5b) |
| `seed/exercises/smoke.json` | five hand-written, one per runtime, so the app has real rows from Phase 0 |
| `docs/workflows/*.js` | Workflow scripts for seed exercise and drill generation |
| `seed/courses.json`, `seed/clos.json`, `seed/patterns.json`, `seed/validate.mjs` | curriculum seed, validated |
| `.gitignore` | excludes the source syllabi and secrets |
