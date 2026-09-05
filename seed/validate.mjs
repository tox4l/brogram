// Validates seed integrity. Run: node seed/validate.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const load = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'))

const { courses } = load('courses.json')
const { clos } = load('clos.json')
const { patterns } = load('patterns.json')

const patternIds = new Set(patterns.map((p) => p.id))
const cloIds = new Set(clos.map((c) => c.id))
const courseCodes = new Set(courses.map((c) => c.code))
const errors = []

for (const p of patterns) {
  for (const k of ['id', 'name', 'description', 'family']) if (typeof p[k] !== 'string' || !p[k]) errors.push(`pattern ${p.id ?? '?'} missing ${k}`)
}
for (const c of courses) {
  for (const id of c.clo_ids) if (!cloIds.has(id)) errors.push(`course ${c.code} references missing CLO ${id}`)
  for (const p of c.prerequisites) if (!courseCodes.has(p)) errors.push(`course ${c.code} prerequisite ${p} not a course`)
}
for (const clo of clos) {
  if (!courseCodes.has(clo.course)) errors.push(`CLO ${clo.id} references missing course ${clo.course}`)
  for (const p of clo.patterns) if (!patternIds.has(p)) errors.push(`CLO ${clo.id} unknown pattern ${p}`)
  for (const pre of clo.prerequisites) if (!cloIds.has(pre)) errors.push(`CLO ${clo.id} unknown prerequisite ${pre}`)
  if (clo.patterns.length < 3) errors.push(`CLO ${clo.id} has fewer than 3 patterns; the 3-different-patterns rule cannot close it`)
}

// Exercises (optional folder). Each file: { exercises: [...] }
const exDir = join(here, 'exercises')
let exerciseCount = 0
if (existsSync(exDir)) {
  const banned = /\b(udst|university|instructor|professor|syllabus)\b|\bCLO\b/i
  const titles = new Set()
  for (const f of readdirSync(exDir).filter((n) => n.endsWith('.json'))) {
    const { exercises } = load(join('exercises', f))
    for (const e of exercises) {
      exerciseCount++
      const tag = `${f}:${e.title ?? '?'}`
      if (!cloIds.has(e.cloId)) errors.push(`${tag} unknown cloId ${e.cloId}`)
      if (!patternIds.has(e.pattern)) errors.push(`${tag} unknown pattern ${e.pattern}`)
      if (!(e.difficulty >= 1 && e.difficulty <= 5)) errors.push(`${tag} bad difficulty`)
      if (!e.title || e.title.length > 50) errors.push(`${tag} title missing or over 50 chars`)
      if (banned.test(e.prompt ?? '') || banned.test(e.title ?? '')) errors.push(`${tag} prompt/title contains a banned word`)
      if ((e.prompt ?? '').toLowerCase().includes(e.pattern)) errors.push(`${tag} prompt leaks the pattern id`)
      const tests = e.tests ?? []
      if (tests.length < 5 || tests.length > 8) errors.push(`${tag} needs 5-8 tests`)
      if (tests.filter((t) => !t.hidden).length < 2) errors.push(`${tag} needs 2 visible tests`)
      if (tests.filter((t) => t.hidden).length < 3) errors.push(`${tag} needs 3 hidden tests`)
      if (!e.referenceSolution) errors.push(`${tag} missing referenceSolution`)
      const key = `${e.cloId}|${e.title}`
      if (titles.has(key)) errors.push(`${tag} duplicate cloId+title`)
      titles.add(key)
    }
  }
}

// Drills (optional folder). Each file: { items: [...] }
const drDir = join(here, 'drills')
let drillCount = 0
if (existsSync(drDir)) {
  for (const f of readdirSync(drDir).filter((n) => n.endsWith('.json'))) {
    const { items } = load(join('drills', f))
    for (const d of items) {
      drillCount++
      if (!d.id || !d.kind || !d.payload || !(d.difficulty >= 1 && d.difficulty <= 5) || !(d.timeLimitS > 0)) errors.push(`drill ${f}:${d.id ?? '?'} malformed`)
    }
  }
}

if (errors.length) {
  console.error('SEED INVALID')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log(`seed ok: ${courses.length} courses, ${clos.length} CLOs, ${patterns.length} patterns, ${exerciseCount} exercises, ${drillCount} drills`)
