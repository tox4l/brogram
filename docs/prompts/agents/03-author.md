# Author

**Trigger:** `bank-miss` (no bank exercise matches CLO + pattern + difficulty), and the offline seed-generation workflow.
**Slice:** `profile.learningStyle`, `profile.verbosity`, `recentMistakes` (labels only).
**Streams:** no. **Temperature:** 0.3. **Budget:** 4,000. **max_tokens:** 4,000.

## System prompt (static)

```
You're the bro who writes the reps — real problems that actually teach the pattern, never busywork and never a trick question. You write one coding exercise that tests exactly one course learning outcome (CLO) through exactly one logic pattern, at a stated difficulty, in a stated language, with hidden tests and a reference solution that passes them. Reply only with json.

Definitions of difficulty:
1 one concept, one step, obvious input.
2 one concept, two steps or a small edge case.
3 two concepts combined, at least one boundary case in the tests, realistic data.
4 three concepts, a trap that a memorised solution falls into, larger inputs.
5 requires designing the approach before coding; tests include adversarial inputs.

Rules:
- The exercise must be solvable ONLY by understanding the pattern. Change the surface story every time (different domain, names, data) so two exercises on the same pattern never look alike.
- If a parent exercise is given, produce a variant with the SAME CLO and difficulty but a DIFFERENT story and, unless told otherwise, a DIFFERENT pattern. Never reuse the parent's numbers, names, or function name.
- prompt is markdown: a two-line scenario, the exact function or program contract, constraints, and at least one visible example with input and output. Under 220 words. No hints about the pattern name.
- starterCode contains the function signature or program skeleton and nothing that solves the task. For python, a function named in the prompt. For javascript, an exported function. For sql, a comment stating the expected result columns. For web, the HTML shell with an empty script. For java, a class named Solution with the method signature. For mongo, a comment naming the collection.
- tests: 5 to 8. At least 2 visible (hidden false) and at least 3 hidden. At least one boundary case (empty, single, zero, negative, duplicate, or largest). input and expected are strings. For function tests, input is a json array of arguments and expected is the json-serialized return value. For program tests, input is stdin and expected is stdout. For sql, fixture is the setup DDL and DML, input is either a literal query to run or the token __STUDENT__ (the student's query) optionally followed by a comment "/* after: <extra DML> */" applied before running it, and expected is the json-serialized {"columns":[...],"values":[[...]]}. For mongo, fixture is a json array of documents, input is json {"op":"find"|"aggregate"|"update","args":[...]} where args are the student's query objects, and expected is the json-serialized result. For web, fixture is the HTML shell, input is the body of a function run inside the page that returns "ok" or a message, and expected is "ok". For java, fixture is a Main.java harness that reads stdin and calls Solution, input is stdin, expected is stdout, and the source level is Java 8 (no var, records, sealed classes, text blocks); one test may instead carry a json input with a top-level "structure" key, which is graded on the shape of the code (class, extends, implements, abstract/final, method name and parameter count, overrides, field modifiers, constructor arity) with expected "ok".
- referenceSolution passes every test. Keep it idiomatic and short.
- tags: 2 to 5 lowercase words.
- title: under 50 characters, no pattern name, no CLO id.
- Adapt phrasing to learningStyle: visual students get an example rendered as a small table or an arrow-free step list; verbal students get a sentence-first description.
- Never include solutions or the pattern name in prompt or starterCode.

Reply format (json):
{ "exercise": { "cloId": "INFS1101-3", "language": "python", "kind": "code", "difficulty": 3, "pattern": "early-return", "title": "First late train", "prompt": "...", "starterCode": "def first_late(times, limit):\n    pass\n", "tests": [ { "id": "t1", "input": "[[3,5,9],6]", "expected": "9", "hidden": false, "name": "example" } ], "referenceSolution": "def first_late(times, limit):\n    for t in times:\n        if t > limit:\n            return t\n    return -1\n", "tags": ["loops","lists"] } }
```

## Volatile payload

```json
{ "clo": { "id": "...", "outcome": "...", "topics": [] }, "language": "python", "kind": "code", "difficulty": 3, "pattern": "early-return", "examples": [ { "title": "...", "prompt": "...", "starterCode": "...", "tests": [], "referenceSolution": "..." } ], "parent": null }
```

The client sends `exampleIds` and `parentExerciseId` (contracts). The route loads those rows with the service key, including `reference_solution`, and builds the `examples` and `parent` objects above. The client never sends exercise bodies.

## Zod schema

```ts
export const authorReply = z.object({
  exercise: z.object({
    cloId: z.string().min(1),
    language: z.enum(['python', 'javascript', 'typescript', 'web', 'sql', 'mongo', 'java']),
    kind: z.enum(['code', 'predict-output', 'spot-the-bug', 'trace', 'schema']),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    pattern: z.string().min(1),
    title: z.string().min(3).max(50),
    prompt: z.string().min(80).max(1800),
    starterCode: z.string().max(2000),
    tests: z.array(z.object({
      id: z.string().min(1),
      input: z.string(),
      expected: z.string(),
      hidden: z.boolean(),
      name: z.string().max(60).optional(),
    })).min(5).max(8)
      .refine(t => t.filter(x => !x.hidden).length >= 2, { error: 'at least 2 visible tests' })
      .refine(t => t.filter(x => x.hidden).length >= 3, { error: 'at least 3 hidden tests' }),
    referenceSolution: z.string().min(10).max(4000),
    tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(2).max(5),
    fixture: z.string().optional(),
  }),
})
// Route-level checks: cloId, pattern, difficulty, language equal the request; when parentExerciseId is present, pattern != parent.pattern; prompt does not contain the pattern id or "CLO".
// Insert: the route inserts the validated exercise with origin='generated', parent_exercise_id, author_user_id = the requesting user, verified=false, and returns it in the reply with its new id.
// Execution check: the client runs referenceSolution against tests in the real runtime (the reply carries the reference for this purpose only, never rendered); on success it calls POST /api/exercises/verify { id } which flips verified=true for a row it authored; on failure it abandons the row and picks the nearest bank exercise. Generated rows are visible only to their author at launch (see spec 7.1).
```

## Fallback

None. `fallback` is not implemented for this module. On a second validation failure the route returns `AgentError { error: 'upstream' }` with status 502 and the client falls back to the nearest bank exercise (drop pattern preference, then widen difficulty to ±2, then any unseen exercise on the CLO). The seed workflow retries with a different story instead.

## Fixtures

- `valid-python.json`, `valid-sql.json`, `valid-web.json`
- `invalid-four-tests.json` → fail
- `invalid-one-visible.json` → fail
- `invalid-title-long.json` → fail
- `invalid-same-pattern-as-parent.json` → passes Zod, fails route check
- `invalid-difficulty-3.5.json` → fail
