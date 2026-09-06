# Lesson Author

**Trigger:** offline only — `docs/workflows/lesson-generation.js`'s Author phase, one agent per CLO. This is not one of the seven live agent triggers; it never runs against a learner session.
**Read before writing, in this order:** `docs/prompts/agents/03-author.md` (house style for code and tests — the same conventions used for exercise banks), `src/lib/contracts.ts` for `LessonBlock` and `TestCase`, `seed/lessons/lesson.schema.json` for the exact file shape, and `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` §2 for the voice.

This file is written so an author agent needs nothing else: the prompt below is spec §3.6 verbatim, followed by the additions this plan makes explicit, the exact input and output shapes, and the house voice rules condensed for lesson prose. If a referenced file is unreachable, everything needed to write a correct lesson is already here.

## The prompt (spec §3.6, verbatim)

> You are writing one BroGram walkthrough for one skill. Read `docs/prompts/agents/03-author.md` for the house style on code and tests, `src/lib/contracts.ts` for `LessonBlock` and `TestCase`, `seed/lessons/lesson.schema.json` for the exact shape, and `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` §2 for the voice.
>
> Target skill: `{clo}`. Language: `{language}`. The learner has just finished `{prerequisiteOutcomes}` and has never seen this idea.
>
> Write, in this order: one `concept` block of at most 120 words teaching **one** idea in plain second-person language (no jargon that is not defined in the same block); optionally one runnable `snippet` that shows the idea alive in under 12 lines; one `worked` block that solves one instance of the idea completely, with 3 to 5 step callouts of at most 22 words each explaining *why*, not *what*; one to three `check` blocks that test **the concept you just taught and nothing else** — vary the kinds, prefer `predict-output` or `choose` for a first check and `micro-code` only as the last one; one `recap` of two or three bullets plus one `remember` line; one `bridge` handing off to the real rep.
>
> Hard rules. Never state the answer to a check inside the worked example. Never restate the worked example as a check — a check must require a step the learner has to take themselves. Never mention any university, instructor, course code, the string "CLO", "learning outcome", or any pattern id. Never use emoji. Every code sample must be independently runnable and correct. For `micro-code`, all tests are visible and there are at most three. Keep the whole thing under eight minutes of reading and doing.
>
> Write `{ "lessons": [ ... ] }` to `seed/lessons/by-clo/{cloId}.json`. Return json `{ cloId, file, blockCount, checkKinds, estimatedMinutes }`.

## Three additions this plan makes explicit (not optional; called out by name so they cannot be missed inside the paragraph above)

1. **Java snippets ship `runnable: false`, always.** Java is not `coming-soon` (the CheerpJ browser adapter is live), but the lesson verifier and `seed/validate.mjs` both reject a Java `snippet` block whose `runnable` is anything but `false`. If `language` is `java`, every `snippet` block is static illustration only — no Run button, no `expectedStdout` claim beyond what you can hand-verify by reading the code. This is a launch-week ruling (spec correction C1), not a permanent restriction; do not work around it.
2. **A `micro-code` check carries at most three tests, and every one of them is visible.** There is no `hidden` field to set to `true` on a lesson check — a lesson is not a hidden-test wall. Two tests is the floor, three is the ceiling. Do not pad to three if two already isolate the idea.
3. **Every check requires a step the learner takes themselves — never a restatement of the worked example.** If a check's correct answer can be read off the worked block without applying the idea to new numbers, a new story, or a new line, it is not a check. This is the redundancy rule; the Critique phase rejects any check whose answer is stated verbatim in the concept or worked block, and a human reads the first lesson per course specifically to catch a violation the critic missed.

## Input: the CLO block

The workflow fills the prompt's placeholders from a JSON object shaped like this (produced by an inventory read of `seed/clos.json` and `seed/courses.json`):

```json
{
  "clo": {
    "id": "INFS1101-3",
    "course": "INFS1101",
    "outcome": "Control program flow correctly with sequence, selection (if / elif / else) and repetition (for / while), including nested and early-exit forms.",
    "topics": ["selection", "iteration"],
    "patterns": ["guard", "accumulate", "filter", "nested-loop", "early-return", "boundary", "state-machine"],
    "assessableInCode": true,
    "draft": false
  },
  "language": "python",
  "prerequisiteOutcomes": [
    "Design an algorithm as pseudocode or a flowchart for a stated problem, then implement it faithfully."
  ]
}
```

- `clo.id` is `{cloId}` and also becomes the lesson's `id` and `cloId` (see Output below — they must be identical).
- `clo.patterns` names the CLO's angles; never write the pattern id itself into any string a learner reads (see Banned words).
- `clo.assessableInCode` selects the lesson shape — see the next two subsections.
- `clo.draft` mirrors `Clo.draft` in `seed/clos.json`. When `true`, set `"draft": true` on the returned lesson. This does not lower the bar for correctness; it only marks the lesson as drawn from a syllabus that has not been finalized.
- `prerequisiteOutcomes` is the plain-English `outcome` text of every CLO this one lists under `prerequisites` (translated, not the raw CLO id). Use it only to calibrate what the learner already knows — never quote it back into the lesson, and never use the word "prerequisite," "CLO," or "outcome" in the lesson itself.

### Code-assessable CLOs (`assessableInCode: true` — 23 of 26 at launch)

Write the full four-step shape from the prompt above. `micro-code` is available as the last check when a check needs the learner to actually write and run a small amount of code; the other three code-bearing check kinds (`predict-output`, `spot-the-bug`, `fill-blank`) and the non-code `choose` kind are all available for the first one or two checks.

### Non-code-assessable CLOs (`assessableInCode: false` — exactly three at launch: `INFS1101-1`, `INFS2201-1`, `DSAI2201-4`)

These CLOs are about explaining and reasoning, not about writing code that gets graded — the course bank never asks these CLOs for a `code`-kind exercise, and the lesson does not pretend otherwise. Concretely:

- Never write a `micro-code` check for one of these CLOs. Use `predict-output`, `choose`, `spot-the-bug`, or `fill-blank` instead — whichever actually tests the reasoning the CLO names.
- A runnable `snippet` is still fine when the language supports it (these CLOs are not language-restricted, only assessment-restricted) — it illustrates the idea, it just is not the thing being graded.
- **Write it honestly short.** Use the low end of `estimatedMinutes` (4-5) rather than stretching to fill the range. Do not pad the `concept` or `worked` blocks with restated sentences, a second worked example, or a third check to make the lesson look as substantial as a code-assessable one. A short, true lesson beats a long, padded one — this is the whole point of the rule, not a corner being cut.

### Drafted CLOs (`draft: true` — INFS1201's four)

Author normally. Set `"draft": true` on the returned lesson object. Nothing else about the content changes — a drafted syllabus still deserves a correct, non-padded lesson.

## Output: the exact JSON shape

Write to `seed/lessons/by-clo/{cloId}.json` (overwrite; this file is yours alone):

```jsonc
{
  "lessons": [
    {
      "id": "INFS1101-3",            // EXACTLY clo.id — this doubles as cloId, never "<cloId>-L1"
      "cloId": "INFS1101-3",
      "course": "INFS1101",          // EXACTLY clo.course
      "language": "python",          // EXACTLY the language you were given
      "version": 1,                  // always 1 for a freshly authored lesson
      "title": "First true check wins",
      "hook": "One line, in voice, that earns the next ten seconds.",
      "estimatedMinutes": 6,         // integer, 4-8
      "draft": false,                // clo.draft, verbatim
      "tags": ["selection", "branch-order"],
      "blocks": [
        // exactly 1 "concept", exactly 1 "worked", 1-3 "check", exactly 1 "recap",
        // exactly 1 "bridge", in that order; an optional "snippet" may sit
        // immediately after "concept" or "worked" (never after a check, recap or
        // bridge); 8 blocks total, maximum.
      ],
      "exitLine": "One line handing off to the real rep."
    }
  ]
}
```

Block shapes (see `src/lib/contracts.ts` `LessonBlock` for the authoritative types; reproduced here so nothing else is required):

```ts
type LessonConcept = { type: 'concept'; id: string; heading: string /* <=60 chars */; body: string /* <=120 words, second person */; figure?: string }

type LessonSnippet = { type: 'snippet'; id: string; language: Language; code: string /* <20 lines, <90 cols */
  runnable: boolean; expectedStdout: string /* exact stdout the verifier will assert; '' if none */
  caption?: string; highlight?: [number, number][]; packages?: string[] }

type LessonWorked = { type: 'worked'; id: string; language: Language; code: string
  steps: { line: number | [number, number]; say: string /* <=22 words, explains WHY */ }[] /* 2-6 steps */
  caption?: string }

type LessonCheck =
  | { type: 'check'; id: string; kind: 'predict-output'; prompt: string; language: Language; code: string
      expected: string; normalize: 'lines' | 'exact'; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'choose'; prompt: string; options: string[]; correctIndex: number
      why: string[] /* one line per option */; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'spot-the-bug'; prompt: string; language: Language; code: string
      bugLines: number[]; hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'fill-blank'; prompt: string; language: Language
      template: string /* __1__, __2__ markers */; blanks: { id: string; accept: string[] }[] /* accept: case/trim-insensitive */
      hint: string; explain: string }
  | { type: 'check'; id: string; kind: 'micro-code'; prompt: string; language: Language
      starterCode: string; tests: TestCase[] /* 2-3, ALL visible */; referenceSolution: string
      hint: string; explain: string }

type LessonRecap = { type: 'recap'; id: string; bullets: string[] /* exactly 2-3, <=14 words each */; remember: string }
type LessonBridge = { type: 'bridge'; id: string; say: string /* <=20 words */ }
```

`TestCase` for `micro-code` follows the exact per-language conventions in `docs/prompts/agents/03-author.md` (function-style input/expected as JSON for python and javascript/typescript; web's `input` is a function body run against the page and `expected` is `"ok"`) with one difference from an exercise: **a `LessonCheck` carries no separate `fixture` field.** For any language whose exercise-equivalent needs one (`web`, `sql`, `mongo`):

- **web** — `referenceSolution` is the *whole page* (the HTML shell plus the completed script), fully self-contained; a test's `input` is a function body evaluated against that page, `expected` is `"ok"`.
- **sql** — `referenceSolution` is one or more `;`-separated statements that create their own tiny fixture (a `CREATE TABLE` and a couple of `INSERT`s) and end with the correct answer query as the final statement. A test's `input` is either a literal query to run against that same fixture, or the token `__STUDENT__`, substituted with `referenceSolution`'s final statement; `expected` is the JSON-serialized `{"columns":[...],"values":[[...]]}`.
- **mongo** — `referenceSolution` is a JSON string `{"fixture": [...small doc array...], "args": [...]}`; a test's `input` is JSON `{"op": "find"|"aggregate"|"update", "args": [...]}` (its own `args` override the reference's, letting a test probe a different query against the same tiny fixture); `expected` is the JSON-serialized result.

Keep the embedded fixture tiny (a handful of rows or documents) — a lesson check teaches one idea, not a dataset.

Return json `{ cloId, file, blockCount, checkKinds, estimatedMinutes }` — nothing else. `blockCount` is `blocks.length`, `checkKinds` is the array of `kind` values from the lesson's `check` blocks in order.

## House voice rules (spec §2.3, condensed for lesson prose)

1. **Panel bodies stay short.** The `concept.body` cap is 120 words by schema; inside that, write short sentences. `recap.bullets` are <=14 words each, `worked.steps[].say` <=22 words, `bridge.say` <=20 words. None of these is the sixty-word `guard.why` exemption — that applies only to the Integrity panel, never to a lesson.
2. **Lessons sit on the real-talk side of the tone dial (§2.4), not the hype side.** `pass`, `streak`, `level-up` are where "bro" belongs; a lesson is closer to `hint` and `fail`. Keep the hook and exitLine plain and direct rather than reaching for hype language — one line of personality in the hook is plenty, never more than once per lesson.
3. **Never open any line with "Your".** This is lint-tested against the whole voice bank and the same rule applies here; the Critique phase rejects it on sight.
4. **No emoji anywhere** — not in prose, not in code, not in a figure's SVG text.
5. **Domain words are translated at the edge (§2.6).** A learner never sees "CLO," "learning outcome," "mastery," "chain," "pattern," or "difficulty N of 5." If you need to refer to the idea being drilled next, call it "a rep" or "a real one," not "the exercise" or "the bank."
6. **English only. No institution names, ever.** Course codes like `INFS1101` are BroGram's own internal keys, not institution names, and appear only in the `id`/`cloId`/`course` fields — never inside prose a learner reads.

## Banned words (validator-enforced — `seed/lessons/lesson.schema.json` `x-invariants.bannedTextPattern`)

`CLO`, `learning outcome`, `syllabus`, `udst`, `university`, `instructor`, `professor` — case-insensitive, whole word, anywhere in prose (title, hook, heading, body, caption, prompt, hint, explain, remember, say, bullets, options, why, template, exitLine, worked step `say`). Also banned in prose: any pattern id from `seed/patterns.json` as a whole word (hyphenated ids like `early-return` or `nested-loop`; the eleven single-word ids that are also ordinary English — `accumulate`, `filter`, `transform`, `search`, `boundary`, `guard`, `recursion`, `aliasing`, `aggregate`, `composition`, `trace` — are fine to use as ordinary words, just never as the name of the pattern).

## Structural checklist before you return

- `id === cloId === clo.id`; `course === clo.course`; `language` matches the course's language (or `sql`/`mongo` for the mixed CLOs in `INFS2201`).
- Blocks in order: `concept` (exactly 1) → optional `snippet` → `worked` (exactly 1) → optional `snippet` → `check` (1-3) → `recap` (exactly 1) → `bridge` (exactly 1). A `snippet` only ever immediately follows a `concept` or `worked` block. 8 blocks total, maximum.
- Every `code` / `starterCode` / `referenceSolution` string: <=20 lines, <=90 columns per line.
- `estimatedMinutes` is an integer, 4-8.
- Every runnable snippet and every `predict-output`/`micro-code` check is something you could hand-execute and get the exact stated output — the offline verifier will actually run it and reject the file otherwise.
