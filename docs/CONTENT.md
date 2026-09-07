# Authoring a course

BroGram's curriculum is data, not code. Every course, learning outcome,
pattern, exercise, drill, and lesson lives under `seed/` as plain JSON. There
is no code change involved in adding a course, retiring one, or replacing the
whole syllabus lineup — you edit `seed/`, verify it, load it, and rebuild.
This is what makes the "static curriculum bundle" claim in `README.md` true:
nothing about the app is tied to these six courses in particular.

None of the steps below need a DeepSeek key, a Vercel account, or anyone's
permission. They need Node and, for the loading step, a Supabase project
(your own — see `SETUP.md` for a local one).

## 1. The five files that make up a course

| File | Shape | Purpose |
|---|---|---|
| `seed/courses.json` | `{ courses: Course[] }` | One row per course: code, title, language, level, prerequisites, the ordered `clo_ids` that make up its path, `status` (`live`, `coming-soon`, or `draft`). |
| `seed/clos.json` | `{ clos: CLO[] }` | One row per learning outcome (CLO): which course it belongs to, its `outcome` sentence, the `patterns` it draws from, and its own prerequisite CLOs. |
| `seed/patterns.json` | `{ patterns: Pattern[] }` | The logic-pattern taxonomy every exercise and lesson tags itself with (`accumulate`, `filter`, `nested-loop`, `refactor-to-class`, `sql-join`, ...). Closing a CLO requires passing exercises with three *different* patterns in a row — see `README.md`'s "how the learning model works" section. |
| `seed/exercises/<COURSE>.json`, `seed/exercises/by-clo/<cloId>.json` | `{ exercises: Exercise[] }` | The graded practice bank. Each exercise names a `cloId`, a `pattern`, `tests` (visible and hidden), and a `referenceSolution` that must actually pass those tests. |
| `seed/lessons/<COURSE>.json`, `seed/lessons/by-clo/<cloId>.json` | `{ course, lessons: Lesson[] }` | The walkthroughs: one per CLO, made of `LessonBlock`s (concept prose, a worked example, and checks the learner does inline). Shape is `seed/lessons/lesson.schema.json`. |
| `seed/drills/<kind>.json` | `DrillItem[]` | De-rot content: reading-and-reasoning items (`predict-output`, `spot-the-bug`, `trace`, `n-back`, `speed-type`, `hold-focus`) that never touch a course's exercise bank. |

`Exercise`, `LessonBlock`, `TestCase`, `Course`, `CLO`, and `Pattern` are all
typed in `src/lib/contracts.ts` — read that file, not this one, for the exact
field list. This document is the workflow around those types, not a copy of
them.

## 2. Shipping a different syllabus — the two ways to do it

### By hand (no AI, no special tooling — always available)

Add a course to `seed/courses.json`, its CLOs to `seed/clos.json`, and write
exercises and a lesson per CLO directly as JSON, following the shape of an
existing course's files. This is the guaranteed path: it needs nothing but a
text editor, and it is exactly how the verifiers and loader below expect
content to arrive regardless of who or what wrote it.

A few rules the verifiers and the app enforce, worth knowing before you
write a single exercise:

- **No institution names, no "CLO", no instructor voice** anywhere a learner
  can read it (prompt, title, starter code, walkthrough copy). Course codes
  like `INFS1101` are internal keys only; the UI never shows them raw.
- **Never put a pattern's id in an exercise's prompt or title.** The pattern
  is metadata for the Author agent and the mastery engine, not something the
  learner is told to look for.
- **Every exercise needs a real, passing `referenceSolution`.** The verifier
  (§3 below) runs it for real; a solution that does not pass its own tests
  fails the gate, not a human reviewer's guess.
- **A CLO needs at least three patterns** across its exercises — one CLO
  cannot be closed by passing the same pattern three times, and
  `seed/validate.mjs` rejects a CLO with fewer than three declared patterns
  outright.

### With the authoring workflows (Claude Code, for scale)

For fanning a whole course out at once, two Workflow-tool scripts exist and
were used to build the launch bank:

- `docs/workflows/exercise-bank-generation.js` — one agent per CLO writes
  exercises into `seed/exercises/by-clo/<cloId>.json`, an execution step runs
  every `referenceSolution` for real, a merge step concatenates per-CLO files
  into `seed/exercises/<COURSE>.json`, and a critique pass checks for leaked
  institution names, pattern ids in prompts, and duplicate story premises.
- `docs/workflows/lesson-generation.js` — the same four-phase shape
  (author → verify → merge → critique), writing into
  `seed/lessons/by-clo/<cloId>.json` then `seed/lessons/<COURSE>.json`, with
  `docs/prompts/agents/08-lesson-author.md` as the one lesson-writing agent's
  complete house style.

Both are run through Claude Code's Workflow tool (see `START-PROMPT.md`),
which fans the per-CLO agent calls out in parallel and journals progress so a
run can resume. Neither script talks to DeepSeek or the live `/api/agent`
route — offline content generation and the seven runtime agent triggers are
different things entirely (see `README.md`). This path is a convenience for
authoring at scale, not a requirement: everything it produces is the same
plain JSON the by-hand path writes, and every file it touches still has to
pass the same verifiers before it counts.

## 3. Verify

Two execution-based verifiers, one per content type. Both actually *run*
what they check — a reference solution against its tests, a `predict-output`
snippet's real stdout — rather than trusting the JSON's own claims.

```bash
node scripts/verify-exercise.mjs seed/exercises/<COURSE>.json
node scripts/verify-lesson.mjs seed/lessons/<COURSE>.json
```

Both accept multiple files on one command line. Both print a per-item result
(`ok`, a failure with the actual-vs-expected diff, or `skipped`/`unverified`
for kinds their runtime can't execute in Node) and a summary line, and both
exit non-zero if anything failed — safe to wire into a fork's own CI.

**Java is the one exception.** Neither verifier runs Java in-process (no JVM
in Node); `verify-exercise.mjs` reports `absent` for a Java exercise unless
`JUDGE_PROVIDER=judge0` and `JUDGE0_API_KEY` are set, and `verify-lesson.mjs`
reports `unverified` for a Java lesson and hard-fails a Java `snippet` that
claims `runnable: true` (Java runs in the *learner's* browser through
CheerpJ — see `public/java/README.md` — never on the machine authoring
content). A Java-heavy fork should expect to certify those exercises by
running them through the same browser runtime the app ships, not this
verifier.

Then verify the whole seed tree's cross-references (a CLO's `patterns` all
exist, a course's `clo_ids` all exist, no orphaned prerequisite, at least
three patterns per CLO, no institution name in any exercise field):

```bash
npm run seed:verify
```

This is `node seed/validate.mjs`; a clean run prints one summary line
(`seed ok: 6 courses, 26 CLOs, ...`).

## 4. Load

```bash
npm run seed:load
```

Upserts every row in `seed/` into your Supabase project's `courses`, `clos`,
`patterns`, `exercises`, `drills`, `lessons`, and `achievements` tables,
keyed by a deterministic UUIDv5 so re-running it after an edit updates rows
in place instead of duplicating them. Needs `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` — see `SETUP.md` for where those
come from on a local project.

Add `--dry-run` to see the row counts it would write without opening a
database connection at all — useful for checking a big seed edit parses
before you touch a real project:

```bash
node scripts/seed-load.mjs --dry-run
```

## 5. Rebuild

The browser never queries Supabase for course content directly (spec R5.1):
it reads a static bundle generated from `seed/` at build time, so a loaded
seed change is invisible to the app until that bundle is regenerated.

```bash
npm run curriculum:build
```

Writes `src/lib/curriculum/generated.ts` (the `COURSES`, `CLOS`, `PATTERNS`
constants and a content-hash `BUILD_ID`) and `public/curriculum/**` (one
manifest plus one JSON file per course and per drill kind, secrets stripped —
a lesson's or exercise's `referenceSolution` and a lesson check's
`expectedStdout` never appear in anything under `public/`). `npm run build`
runs this automatically as its `prebuild` step, so a production build always
picks up whatever is in `seed/` at build time; running it by hand is only
for seeing the effect during `npm run dev`, which does not watch `seed/`.

`npm run curriculum:check` re-runs the same generation in memory and exits
non-zero if the result would differ from what is committed — the gate that
keeps `src/lib/curriculum/generated.ts` from drifting out of sync with
`seed/` in a fork's own CI.

## 6. The order that actually matters

Steps 3 and 5 are independent of step 4 — you can verify and rebuild without
ever touching a database, which is exactly what a fork with no Supabase
project yet can do to confirm its new content is well-formed. Loading (step
4) only matters once you have a project to load into. The one order that is
fixed: verify before load (a malformed row you load anyway is a bug you find
in the running app instead of at the command line), and load before rebuild
only matters for `BUILD_ID` staleness, not correctness — the static bundle
is generated from `seed/` on disk, not from what is currently loaded in any
database.
