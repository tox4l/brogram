# BroGram

BroGram is a coding tutor. A student signs in, picks a course, and works
through exercises that are graded where they are written: in the browser. A
small set of DeepSeek-backed agents adapt the plan, the hints, and the pacing
to how that student learns, while a de-rot module keeps a second kind of
practice — reading and reasoning about code rather than writing it — on the
same streak. Progress, mastery per learning outcome, and a downloadable
report all come from the same durable state, so nothing shown to a student is
computed twice in two different ways.

The app is a client-heavy Next.js 16 project deployed on Vercel. Supabase
provides authentication and a Postgres database locked down with row-level
security, so a browser can read and write its own learner state directly
without a server in the middle for the common path. Seven learner-state
agents — Profiler, Planner, Author, Diagnoser, Coach, Reviewer, and Buddy —
sit behind a single route and share one frozen request and reply contract.
Code, HTML/CSS/JS, and SQL/Mongo exercises run and grade in the browser's own
runtimes (Pyodide, a sandboxed iframe, sql.js, and mingo); Java is the one
language that leaves the browser, graded through Judge0. The shapes every
part of the app agrees on — learner state, exercises, agent messages, runtime
requests — are frozen in `src/lib/contracts.ts` and
`src/lib/agents/requests.ts`, and no other file redefines them.

## Running locally

Requires Node.js 22 or later and npm.

```bash
npm install
cp .env.example .env.local   # fill in Supabase, DeepSeek, and Judge0 credentials
supabase db push             # apply migrations to your Supabase project
node scripts/seed-load.mjs   # load courses, CLOs, patterns, exercises, and drills
npm run dev
```

Run the test suites:

```bash
npm test                     # vitest, unit and component tests
npx playwright test          # end-to-end flows; see e2e/README.md for setup
```

## Repository layout

- `docs/` — design notes, frozen contracts reference, and the build log
- `seed/` — course, CLO, pattern, exercise, and drill content plus its loader/validator
- `supabase/` — database migrations (schema, RLS policies, functions)
- `src/` — the Next.js app: routes under `src/app/`, agents under
  `src/lib/agents/`, browser runtimes under `src/lib/runtimes/`, and shared
  contracts under `src/lib/contracts.ts`

## Built by Velocity

Licensed under the MIT License. See `LICENSE`.
