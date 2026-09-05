export const meta = {
  name: 'brogram-exercise-bank',
  description: 'Generate, execute-verify, and critique the BroGram seed exercise bank: one author agent per CLO writing its own file, a verifier that runs reference solutions, a merge into per-course files, and a critic pass',
  phases: [
    { title: 'Author', detail: 'one agent per CLO writes N exercises per pattern into seed/exercises/by-clo/<clo>.json' },
    { title: 'Verify', detail: 'run scripts/verify-exercise.mjs on each per-CLO file; fix in place' },
    { title: 'Merge', detail: 'concatenate per-CLO files into seed/exercises/<course>.json' },
    { title: 'Critique', detail: 'leak check: institution names, pattern names in prompts, duplicate stories' },
  ],
}

// args: { courses?: string[], perPattern?: number, difficulties?: number[] }
// Launch-day defaults: perPattern 1, all live courses. Pilot week: perPattern 3.
const perPattern = (args && args.perPattern) || 1
const difficulties = (args && args.difficulties) || [2, 3, 4]
const onlyCourses = args && args.courses
const byClo = 'seed/exercises/by-clo'

const EXERCISE_FILE_SCHEMA = {
  type: 'object',
  properties: { cloId: { type: 'string' }, file: { type: 'string' }, count: { type: 'number' }, patternsCovered: { type: 'array', items: { type: 'string' } } },
  required: ['cloId', 'file', 'count', 'patternsCovered'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' }, passed: { type: 'number' }, failed: { type: 'number' },
    failures: { type: 'array', items: { type: 'object', properties: { exerciseTitle: { type: 'string' }, reason: { type: 'string' } }, required: ['exerciseTitle', 'reason'] } },
    fixedInPlace: { type: 'boolean' },
  },
  required: ['file', 'passed', 'failed', 'failures', 'fixedInPlace'],
}
const MERGE_SCHEMA = { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, total: { type: 'number' } }, required: ['files', 'total'] }
const CRITIC_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string' }, issuesFound: { type: 'number' }, issuesFixed: { type: 'number' }, remaining: { type: 'array', items: { type: 'string' } } },
  required: ['file', 'issuesFound', 'issuesFixed', 'remaining'],
}

phase('Author')
const inventory = await agent(
  `Read seed/clos.json and seed/courses.json. Return a json object { clos: [{ id, course, language, runtime, outcome, patterns, assessableInCode }] } for every CLO whose course status is "live"${onlyCourses ? ` and whose course code is one of ${JSON.stringify(onlyCourses)}` : ''}. Use the course's language for each CLO (for INFS2201 CLO 5 use "mongo"). Nothing else.`,
  { label: 'inventory', phase: 'Author', model: 'sonnet', effort: 'low',
    schema: { type: 'object', properties: { clos: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, course: { type: 'string' }, language: { type: 'string' }, runtime: { type: 'string' }, outcome: { type: 'string' }, patterns: { type: 'array', items: { type: 'string' } }, assessableInCode: { type: 'boolean' } }, required: ['id', 'course', 'language', 'runtime', 'outcome', 'patterns', 'assessableInCode'] } } }, required: ['clos'] } }
)
const clos = (inventory && inventory.clos) || []
log(`${clos.length} CLOs to author, ${perPattern} per pattern`)

const authorPrompt = (clo) => `You are generating seed exercises for BroGram. Read docs/prompts/agents/03-author.md and follow its system prompt EXACTLY as if you were that agent, including the json shape for a single exercise and the TestCase conventions per language. Also read seed/patterns.json for pattern definitions, docs/contracts/brogram-contracts.ts for the Exercise and TestCase types, and seed/exercises/smoke.json for five worked examples of the exact file format.

Target CLO: ${JSON.stringify(clo)}
Language: ${clo.language}. Kind: ${clo.assessableInCode ? 'code (you may include up to two predict-output or spot-the-bug items)' : 'predict-output, spot-the-bug, or trace only (this CLO is not code-assessable)'}.
For EACH pattern in the CLO's patterns list, write ${perPattern} exercise(s), spreading difficulties across ${JSON.stringify(difficulties)}. Every exercise must have a DIFFERENT story/domain from every other exercise you write. Never mention any university, institution, instructor, or the string "CLO" in prompt, title, or starterCode. Never put the pattern id in the prompt or title.

Write { "exercises": [ ... ] } to ${byClo}/${clo.id}.json (overwrite; this file is yours alone). Each exercise object: cloId, language, kind, difficulty, pattern, title, prompt, starterCode, tests (5-8, >=2 visible, >=3 hidden, one boundary), referenceSolution, tags, and fixture when the runtime needs one. Return json { cloId, file, count, patternsCovered }.`

const authored = await pipeline(
  clos,
  clo => agent(authorPrompt(clo), { label: `author:${clo.id}`, phase: 'Author', schema: EXERCISE_FILE_SCHEMA, model: 'sonnet', effort: 'high' }),
  (summary, clo) => {
    if (!summary) return null
    return agent(
      `Run \`node scripts/verify-exercise.mjs ${summary.file}\` (it executes every reference solution against its tests using real runtimes). If any exercise fails, FIX it in place in ${summary.file}: correct the reference solution or the expected values so the exercise is genuinely correct (never delete tests to make it pass; never weaken a boundary test), then re-run until the verifier exits 0 or you have tried 3 times. For java exercises when JUDGE0_API_KEY is not set, the verifier reports "unverified"; leave those and report them as failures with reason "unverified". Return json { file, passed, failed, failures: [{exerciseTitle, reason}], fixedInPlace }.`,
      { label: `verify:${clo.id}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet', effort: 'high' }
    ).then(v => ({ clo, summary, verify: v }))
  }
)

const done = authored.filter(Boolean)
const stillFailing = done.filter(d => d.verify && d.verify.failed > 0)
log(`Authored ${done.length}/${clos.length} CLOs; ${stillFailing.length} have unverified exercises`)

phase('Merge')
const merged = await agent(
  `Read every file in ${byClo}/. For each course code (the part of the file name before the dash), concatenate the exercises arrays into seed/exercises/<course>.json as { "exercises": [...] } (overwrite). Exclude any exercise whose reference could not be verified: the verify reports are ${JSON.stringify(done.map(d => ({ file: d.summary.file, failures: d.verify ? d.verify.failures : [] })))}; drop exercises whose title appears in a failures list. Then delete the ${byClo}/ directory and run \`node seed/validate.mjs\`; it must print "seed ok". Return json { files, total }.`,
  { label: 'merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet', effort: 'medium' }
)

phase('Critique')
const files = (merged && merged.files) || []
const critiques = await parallel(files.map(f => () => agent(
  `Read ${f}. For every exercise check: (1) no institution, university, instructor, or course-code strings anywhere; (2) the pattern id does not appear in prompt or title; (3) the string "CLO" does not appear in prompt or title; (4) no two exercises share a story (same nouns/domain); (5) title under 50 chars; (6) at least 2 visible and 3 hidden tests; (7) prompt under 220 words and contains at least one example. Fix every issue in place (rewrite stories, retitle, adjust tests) without changing referenceSolution semantics, then run \`node scripts/verify-exercise.mjs ${f}\` and \`node seed/validate.mjs\` again and make sure both still pass. Return json { file, issuesFound, issuesFixed, remaining: [] }.`,
  { label: `critic:${f.split('/').pop()}`, phase: 'Critique', schema: CRITIC_SCHEMA, model: 'sonnet', effort: 'high' }
)))

return {
  authored: done.map(d => ({ clo: d.clo.id, count: d.summary.count, patterns: d.summary.patternsCovered, verify: d.verify })),
  merged,
  critiques: critiques.filter(Boolean),
  unverified: stillFailing.map(d => ({ clo: d.clo.id, failures: d.verify.failures })),
}
