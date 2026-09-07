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
Every language runs and grades in the browser's own runtimes — Pyodide, a
sandboxed iframe, sql.js, and mingo — and Java joins them through CheerpJ, a
WebAssembly JVM loaded from its vendor's CDN under the free Community License
that compiles submissions in a Worker with the real OpenJDK 8 `javac` from a
self-hosted `tools.jar` (GPLv2 with the Classpath Exception, fetched at install
time and never committed; see `public/java/README.md`), with tree-sitter
checking a submission's structure where output alone cannot. The
shapes every part of the app agrees on — learner state, exercises, agent messages, runtime
requests — are frozen in `src/lib/contracts.ts` and
`src/lib/agents/requests.ts`, and no other file redefines them.

## How the learning model works

The distinctive part of BroGram is not DeepSeek — it's what every agent call
reads and writes. A learner's whole state lives in one row, typed as
`LearnerState` in `src/lib/contracts.ts`: their profile and style, the
Planner's chosen path through a course's learning outcomes, per-outcome
mastery, a rolling window of recent mistakes, streaks, points, and integrity
score, all under one `version` that increments on every write so a stale
agent reply can never overwrite a newer one. Every one of the seven agents —
Profiler, Planner, Author, Diagnoser, Coach, Reviewer, Buddy — reads only the
narrow slice of that state its job needs and returns a reply shaped by a
frozen Zod schema; nothing about the app's behaviour lives inside a prompt
that isn't also checked in code. An agent call happens for exactly seven
reasons (`AgentTrigger` in `src/lib/contracts.ts`) — an onboarding answer, a
plan refresh, a bank miss, a failed attempt, a hint request, a passed
attempt, a message to Buddy — and never on a keystroke, a timer, a lesson
block, or any other UI event; `callAgent`/`streamAgent` in
`src/lib/agents/client.ts` is the one place in the codebase that can reach
the model, and a test (`src/lib/agents/no-agent-surfaces.test.tsx`) asserts
zero calls across every screen and interaction that isn't one of those
seven.

Progress is measured by pattern, not by exercise. `seed/patterns.json` names
around 40 reusable logic patterns — `accumulate`, `filter`, `nested-loop`,
`sql-join`, `refactor-to-class`, and so on — grouped into families
(control-flow, data, oop, sql, reading...), and every exercise, lesson check,
and generated variant tags itself with exactly one. A learning outcome only
closes once a learner has passed exercises using three *different* patterns
in a row, which is what stops "got lucky on one style of problem" from
reading as mastery, and it's the same taxonomy the Author agent uses to keep
a generated variant from reusing the pattern of the exercise it's varying.
Because this is a browser-graded product, none of this depends on a server
judge or a particular model: the taxonomy, the mastery rule, and the state
schema are what make BroGram teach the way it does, and every one of them is
plain, forkable code and data under `src/lib/` and `seed/`.

## Running locally

Requires Node.js 22 or later and npm.

```bash
npm install
cp .env.example .env.local   # fill in Supabase and DeepSeek credentials; Java runs in the browser (NEXT_PUBLIC_JUDGE_PROVIDER=browser)
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

## Credits

Java runs in the browser on [CheerpJ](https://cheerpj.com) by
[Leaning Technologies](https://leaningtech.com), loaded from the vendor's CDN
under its free Community License, and compiles with OpenJDK 8's `javac`
(GPLv2 with the Classpath Exception, fetched at install time). Anyone forking
this project and redeploying it is distributing their own application and takes
their own position on the CheerpJ licence — the Community License is granted to
a project, not inherited with the source. See `public/java/README.md` and
`public/java/TOOLS-JAR-LICENSE.md`.

## Built by Velocity

BroGram's own source is licensed under the MIT License. See `LICENSE`.
