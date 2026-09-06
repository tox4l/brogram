export const meta = {
  name: 'brogram-lesson-generation',
  description: 'Generate, execute-verify, and critique BroGram lesson walkthroughs: one author agent per CLO writing its own file, a verifier that runs every runnable snippet and check, a merge into per-course files, and an Opus critic pass',
  phases: [
    { title: 'Author', detail: 'one agent per CLO writes one walkthrough into seed/lessons/by-clo/<cloId>.json' },
    { title: 'Verify', detail: 'run scripts/verify-lesson.mjs on each per-CLO file; fix in place' },
    { title: 'Merge', detail: 'concatenate per-CLO files into seed/lessons/<course>.json' },
    { title: 'Critique', detail: 'voice, redundancy, leak and reading-level pass', model: 'opus' },
  ],
}

// args: { courses?: string[], clos?: string[] }
// A partial rerun (e.g. fixing one CLO after a human read) passes clos: ['INFS1101-3'].
// Merge always re-scans the whole by-clo/ directory, so files from earlier runs are
// preserved and re-merged alongside whatever this run authors.
const onlyCourses = args && args.courses
const onlyClos = args && args.clos
const byClo = 'seed/lessons/by-clo'

const INVENTORY_SCHEMA = {
  type: 'object',
  properties: {
    clos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          course: { type: 'string' },
          language: { type: 'string' },
          outcome: { type: 'string' },
          topics: { type: 'array', items: { type: 'string' } },
          patterns: { type: 'array', items: { type: 'string' } },
          assessableInCode: { type: 'boolean' },
          draft: { type: 'boolean' },
          prerequisiteOutcomes: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'course', 'language', 'outcome', 'topics', 'patterns', 'assessableInCode', 'draft', 'prerequisiteOutcomes'],
      },
    },
  },
  required: ['clos'],
}
const AUTHOR_SCHEMA = {
  type: 'object',
  properties: { cloId: { type: 'string' }, path: { type: 'string' }, ok: { type: 'boolean' }, notes: { type: 'string' } },
  required: ['cloId', 'path', 'ok', 'notes'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' }, passed: { type: 'number' }, failed: { type: 'number' }, unverified: { type: 'number' },
    failures: { type: 'array', items: { type: 'object', properties: { lessonId: { type: 'string' }, checkId: { type: 'string' }, reason: { type: 'string' } }, required: ['lessonId', 'checkId', 'reason'] } },
    fixedInPlace: { type: 'boolean' },
  },
  required: ['file', 'passed', 'failed', 'unverified', 'failures', 'fixedInPlace'],
}
const MERGE_SCHEMA = { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, total: { type: 'number' } }, required: ['files', 'total'] }
const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: { course: { type: 'string' }, fixed: { type: 'number' }, rejected: { type: 'array', items: { type: 'string' } } },
  required: ['course', 'fixed', 'rejected'],
}

phase('Author')
const inventory = await agent(
  `Read seed/clos.json and seed/courses.json. Return a json object { clos: [...] } for every CLO whose course status is "live"${onlyCourses ? ` and whose course code is one of ${JSON.stringify(onlyCourses)}` : ''}${onlyClos ? `, restricted further to exactly these CLO ids: ${JSON.stringify(onlyClos)}` : ''}. For each CLO return: id, course, language (the course's language; for INFS2201 CLO 5 use "mongo"), outcome (the CLO's own outcome sentence, verbatim), topics, patterns, assessableInCode (from the seed field "assessable_in_code"), draft (the CLO's own "draft" field, or false if absent), and prerequisiteOutcomes (the outcome sentence of every CLO id listed in this CLO's "prerequisites" array, resolved by id from clos.json; skip an id that does not exist; empty array if there are no prerequisites). Nothing else.`,
  { label: 'inventory', phase: 'Author', model: 'sonnet', effort: 'low', schema: INVENTORY_SCHEMA },
)
const clos = (inventory && inventory.clos) || []
log(`${clos.length} CLOs to author`)

const authorPrompt = (clo) => `You are generating one BroGram lesson (walkthrough) for a single learning outcome, offline. Read docs/prompts/agents/08-lesson-author.md in full and follow it exactly as if you were the agent it describes: it reproduces the spec's author prompt verbatim, the three explicit additions (Java snippets ship runnable:false; a micro-code check carries at most three tests, all visible; every check requires a step the learner takes themselves, never a restatement of the worked example), the exact output JSON shape, the per-language conventions for a micro-code check with no separate fixture field (web/sql/mongo), and the house voice rules. It needs nothing else, but also read src/lib/contracts.ts for LessonBlock/TestCase and seed/lessons/lesson.schema.json for the exact shape if anything is unclear.

The prompt's placeholders, filled in:
Target skill ({clo}): ${JSON.stringify({ id: clo.id, course: clo.course, outcome: clo.outcome, topics: clo.topics, patterns: clo.patterns, assessableInCode: clo.assessableInCode, draft: clo.draft })}
Language ({language}): ${clo.language}
Prerequisite outcomes ({prerequisiteOutcomes}), already finished, never seen again in your prose: ${JSON.stringify(clo.prerequisiteOutcomes)}

Write the lesson yourself to ${byClo}/${clo.id}.json (overwrite; this file is yours alone) as { "lessons": [ <exactly one lesson object, with id and cloId both exactly "${clo.id}" and course exactly "${clo.course}"> ] }. Return json { cloId, path, ok, notes }: path is the file you wrote, ok is true only if you wrote one complete, structurally correct lesson following every rule in 08-lesson-author.md, notes is one short sentence describing what you wrote (or, if ok is false, why).`

const authored = await pipeline(
  clos,
  (clo) => agent(authorPrompt(clo), { label: `author:${clo.id}`, phase: 'Author', schema: AUTHOR_SCHEMA, model: 'sonnet', effort: 'high' }),
  (result, clo) => {
    if (!result || !result.ok) return Promise.resolve({ clo, authored: result, verify: null })
    return agent(
      `Run \`node scripts/verify-lesson.mjs ${result.path} --json\` (it executes every runnable snippet in the real runtime and asserts its stdout, executes every predict-output check's code and asserts it under the declared normalization, runs every micro-code check's referenceSolution against its tests, and structurally checks spot-the-bug and fill-blank). Parse the single json line it prints. If "failed" is greater than 0, FIX the failing block(s) in place in ${result.path} -- correct the code, the expectedStdout/expected value, or the referenceSolution so the lesson is genuinely correct; never delete or weaken a check to make it pass -- then re-run the same command until failed is 0 or you have tried 3 times. "unverified" greater than 0 means the lesson's language is java, which is expected and not a failure to fix; just confirm its snippet(s) already have runnable:false and leave it. Return json { file, passed, failed, unverified, failures: [{lessonId, checkId, reason}], fixedInPlace }.`,
      { label: `verify:${clo.id}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet', effort: 'high' },
    ).then((verify) => ({ clo, authored: result, verify }))
  },
)

const done = authored.filter(Boolean).filter((d) => d.authored && d.authored.ok)
const stillFailing = done.filter((d) => d.verify && d.verify.failed > 0)
log(`Authored ${done.length}/${clos.length} CLOs; ${stillFailing.length} still failing verification after fix attempts`)

phase('Merge')
const merged = await agent(
  `Read every file in ${byClo}/. For each course code (the part of each file name before the dash, e.g. "INFS1101" from "INFS1101-3.json"), concatenate every one of that course's files' "lessons" arrays, sorted by lesson id, into seed/lessons/<course>.json as { "$note": "BroGram lessons. One lesson per CLO. No institution names, no pattern ids, no emoji.", "course": "<course>", "lessons": [...] } (overwrite).${onlyCourses ? ` Only write files for these courses: ${JSON.stringify(onlyCourses)}; leave every other course's existing file untouched.` : ''} Exclude any lesson whose id appears in this run's still-failing list, which is ${JSON.stringify(stillFailing.map((d) => d.clo.id))}. Then run \`node seed/validate.mjs\`; it must print "seed ok" with a lesson count. Return json { files, total }.`,
  { label: 'merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet', effort: 'medium' },
)

phase('Critique')
const files = (merged && merged.files) || []
const critiqued = await parallel(files.map((f) => () => agent(
  `Read ${f}, a merged BroGram lesson file for one course. Critic checklist -- reject and fix in place, lesson by lesson: (1) any voice violation from spec section 2.3: a line opening with "Your", an emoji anywhere, over-length celebration copy, or the word "bro" anywhere (a lesson sits on the real-talk side of the tone dial, never the hype side, so "bro" does not belong in one at all); (2) any check whose correct answer is stated verbatim in the concept or worked block -- rewrite the check so it genuinely requires the learner's own step; (3) any lesson with estimatedMinutes over 8; (4) any duplicated story, character name, or variable-naming tic repeated across two or more lessons in this file; (5) any leak: an institution name, a pattern id from seed/patterns.json used as the pattern's name, or the string "CLO". Fix every issue you find in place -- rewrite prose, retitle, adjust estimatedMinutes, change a story's nouns -- without changing a block's shape or a runnable check's correctness, then run \`node scripts/verify-lesson.mjs ${f}\` and \`node seed/validate.mjs\` again and confirm both still pass; if a fix breaks either, revert that one fix rather than leaving the file broken. Return json { course, fixed, rejected: [] }: fixed is how many issues you corrected, rejected lists, as short strings, any issue you found but judged unsafe to fix yourself (leave those lessons as they are rather than guessing).`,
  { label: `critic:${f.split('/').pop()}`, phase: 'Critique', schema: CRITIQUE_SCHEMA, model: 'opus', effort: 'high' },
)))

return {
  authored: done.map((d) => ({ cloId: d.clo.id, path: d.authored.path, notes: d.authored.notes, verify: d.verify })),
  merged,
  critiques: critiqued.filter(Boolean),
  unverified: stillFailing.map((d) => ({ cloId: d.clo.id, failures: d.verify ? d.verify.failures : [] })),
}
