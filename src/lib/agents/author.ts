import { z } from 'zod'
import type { AuthorReply, AuthorRequest } from '@/lib/contracts'
import type { AgentModule } from './shared'

/** The route adds the parent row it hydrated with the service key so the variant check can run. */
export type AuthorRouteRequest = AuthorRequest & { parent?: { id: string; pattern: string } | null }

const system = `You're the bro who writes the reps — real problems that actually teach the pattern, never busywork and never a trick question. You write one coding exercise that tests exactly one course learning outcome (CLO) through exactly one logic pattern, at a stated difficulty, in a stated language, with hidden tests and a reference solution that passes them. Reply only with json.

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
{ "exercise": { "cloId": "INFS1101-3", "language": "python", "kind": "code", "difficulty": 3, "pattern": "early-return", "title": "First late train", "prompt": "...", "starterCode": "def first_late(times, limit):\\n    pass\\n", "tests": [ { "id": "t1", "input": "[[3,5,9],6]", "expected": "9", "hidden": false, "name": "example" } ], "referenceSolution": "def first_late(times, limit):\\n    for t in times:\\n        if t > limit:\\n            return t\\n    return -1\\n", "tags": ["loops","lists"] } }`

/**
 * Kinds the exercise screen grades by comparing ONE typed answer against `expected`: the printed
 * output, a json array of 1-based line numbers, or a json object of variable to value. More than one
 * test with distinct expecteds would make the exercise unpassable by construction.
 * `seed/validate.mjs` keeps the 5-to-8 rule for committed seed files, where these kinds repeat the
 * single answer across the battery; only exercises the Author writes at runtime take the rule below.
 */
const SINGLE_ANSWER_KINDS = new Set(['predict-output', 'spot-the-bug', 'trace'])
const readsOneAnswer = (kind: string) => SINGLE_ANSWER_KINDS.has(kind)

const authorExercise = z.object({
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
  })).min(1).max(8),
  referenceSolution: z.string().min(10).max(4000),
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(2).max(5),
  fixture: z.string().optional(),
})
  .refine(e => !readsOneAnswer(e.kind) || e.tests.length === 1, { error: 'this kind carries exactly 1 test, the answer the student types' })
  .refine(e => !readsOneAnswer(e.kind) || e.tests[0]?.hidden === false, { error: 'the single answer test is visible' })
  .refine(e => readsOneAnswer(e.kind) || e.tests.length >= 5, { error: 'at least 5 tests' })
  .refine(e => readsOneAnswer(e.kind) || e.tests.filter(t => !t.hidden).length >= 2, { error: 'at least 2 visible tests' })
  .refine(e => readsOneAnswer(e.kind) || e.tests.filter(t => t.hidden).length >= 3, { error: 'at least 3 hidden tests' })

export const authorReply = z.object({ exercise: authorExercise })

interface ExerciseRow {
  title?: string
  prompt?: string
  starter_code?: string
  tests?: unknown
  reference_solution?: string
  pattern?: string
}

const asExample = (row: ExerciseRow) => ({
  title: row.title,
  prompt: row.prompt,
  starterCode: row.starter_code,
  tests: row.tests,
  referenceSolution: row.reference_solution,
})

export const author: AgentModule<AuthorRouteRequest, AuthorReply> = {
  name: 'author',
  system,
  schema: authorReply,
  slice: state => ({
    profile: { learningStyle: state.profile?.learningStyle, verbosity: state.profile?.verbosity },
    recentMistakes: (state.recentMistakes ?? []).map(m => m.label),
  }),
  payload: (req, hydrated) => {
    const parent = hydrated.parent as ExerciseRow | null | undefined
    return {
      clo: { id: req.clo.id, outcome: req.clo.outcome, topics: req.clo.topics },
      language: req.language,
      kind: req.kind,
      difficulty: req.difficulty,
      pattern: req.pattern,
      examples: ((hydrated.examples as ExerciseRow[] | undefined) ?? []).map(asExample),
      parent: parent ? { pattern: parent.pattern, ...asExample(parent) } : null,
    }
  },
  routeCheck(req, reply) {
    const e = reply.exercise
    if (e.cloId !== req.clo.id) return `cloId ${e.cloId} is not the requested ${req.clo.id}`
    if (e.language !== req.language) return `language ${e.language} is not the requested ${req.language}`
    if (e.difficulty !== req.difficulty) return `difficulty ${e.difficulty} is not the requested ${req.difficulty}`
    if (e.pattern !== req.pattern) return `pattern ${e.pattern} is not the requested ${req.pattern}`
    if (req.parentExerciseId && req.parent && e.pattern === req.parent.pattern) return 'the variant reuses the parent pattern'
    if (e.prompt.includes(req.pattern)) return `prompt names the pattern ${req.pattern}`
    if (e.prompt.includes('CLO')) return 'prompt mentions CLO'
    return null
  },
  temperature: 0.3,
  maxTokens: 4000,
  streams: false,
}
