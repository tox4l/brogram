export const meta = {
  name: 'brogram-drills',
  description: 'Generate the six de-rot drill item banks (predict-output, spot-the-bug, trace, hold-focus, n-back, speed-type), verify the executable ones, and write seed/drills/<kind>.json',
  phases: [
    { title: 'Generate', detail: 'one agent per drill kind' },
    { title: 'Verify', detail: 'execute predict-output and trace snippets; sanity-check the rest' },
  ],
}

const perKind = (args && args.perKind) || 24
const KINDS = [
  { kind: 'predict-output', payload: '{ language, snippet, expectedOutput }', rule: 'snippet 3-12 lines, deterministic, no input(), prints exactly expectedOutput. Languages: python (60%), javascript (30%), sql (10%, snippet is a CREATE+INSERT+SELECT against an in-memory table, expectedOutput is the rows as "a|b" lines).' },
  { kind: 'spot-the-bug', payload: '{ language, snippet, bugLines: number[], explanation }', rule: 'snippet 5-14 lines with exactly one planted bug; bugLines lists the 1-based line(s); explanation one sentence. Languages: python, javascript, sql, java.' },
  { kind: 'trace', payload: '{ language, snippet, stepIndex, variables: string[], expected: Record<string,string> }', rule: 'snippet is a loop or recursion 4-10 lines; stepIndex is which loop iteration (1-based) to freeze at; expected maps each variable to its value as a string at the END of that iteration.' },
  { kind: 'hold-focus', payload: '{ passage, question, options: string[4], answerIndex }', rule: 'passage is 200-400 words of accurate technical explanation about programming or computer science (no institution names), question is answerable only from the passage, exactly 4 options.' },
  { kind: 'n-back', payload: '{ n, tokens: string[], language }', rule: 'n is 1, 2, or 3; tokens is a sequence of 20-30 code tokens (keywords, operators, identifiers) with at least 5 true n-back matches planted.' },
  { kind: 'speed-type', payload: '{ language, snippet }', rule: 'snippet 3-8 lines of real idiomatic code, no trailing whitespace, tabs replaced by 4 spaces.' },
]

const GEN_SCHEMA = { type: 'object', properties: { kind: { type: 'string' }, file: { type: 'string' }, count: { type: 'number' } }, required: ['kind', 'file', 'count'] }
const VER_SCHEMA = { type: 'object', properties: { kind: { type: 'string' }, checked: { type: 'number' }, fixed: { type: 'number' }, removed: { type: 'number' } }, required: ['kind', 'checked', 'fixed', 'removed'] }

phase('Generate')
const results = await pipeline(
  KINDS,
  k => agent(
    `Generate ${perKind} de-rot drill items of kind "${k.kind}" for BroGram (a coding tutor for university students; English only; no emoji; no institution names). Read docs/contracts/brogram-contracts.ts for the DrillItem type. Each item: { id: "${k.kind}-NNN", kind: "${k.kind}", language?, difficulty: 1-5 (spread evenly), timeLimitS (predict-output 20-60, spot-the-bug 30-90, trace 45-120, hold-focus 120-240, n-back 60-90, speed-type 30-120, scaled with difficulty), payload: ${k.payload} }.
Rules for this kind: ${k.rule}
Write { "items": [...] } to seed/drills/${k.kind}.json (overwrite). Return json { kind, file, count }.`,
    { label: `gen:${k.kind}`, phase: 'Generate', schema: GEN_SCHEMA, model: 'sonnet', effort: 'high' }
  ),
  (g, k) => {
    if (!g) return null
    const verifyRule = k.kind === 'predict-output'
      ? 'Execute every python snippet with `node -e` via the pyodide npm package (or `python` if available) and every javascript snippet with node; compare stdout to expectedOutput exactly. Fix expectedOutput when the snippet is right and the answer is wrong; fix the snippet when it does not run. Remove any item you cannot make deterministic.'
      : k.kind === 'trace'
        ? 'Execute each snippet with instrumentation (print the variables at the end of each iteration) in python or node and confirm expected matches at stepIndex. Fix expected values from the real run. Remove items whose stepIndex exceeds the iteration count.'
        : k.kind === 'spot-the-bug'
          ? 'For each item, confirm the code on bugLines is actually wrong and the rest is right by reasoning line by line; make sure exactly one bug exists. Fix or remove.'
          : 'Check every item matches the payload shape and rules; fix or remove.'
    return agent(
      `Read ${g.file}. ${verifyRule} Write the corrected file back. Return json { kind: "${k.kind}", checked, fixed, removed }.`,
      { label: `verify:${k.kind}`, phase: 'Verify', schema: VER_SCHEMA, model: 'sonnet', effort: 'high' }
    )
  }
)
return results.filter(Boolean)
