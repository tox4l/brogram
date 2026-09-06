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
const cloById = new Map(clos.map((c) => [c.id, c]))
const courseByCode = new Map(courses.map((c) => [c.code, c]))
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

// ---------------------------------------------------------------------------
// Lessons (seed/lessons/*.json), validated against seed/lessons/lesson.schema.json
// ---------------------------------------------------------------------------

const lessonsDir = join(here, 'lessons')
let lessonCount = 0

if (existsSync(lessonsDir)) {
  const schemaPath = join(lessonsDir, 'lesson.schema.json')
  if (!existsSync(schemaPath)) {
    errors.push('seed/lessons/lesson.schema.json is missing')
  } else {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    const defs = schema.$defs ?? {}
    const invariants = schema['x-invariants'] ?? {}

    /** Minimal JSON Schema (2020-12 subset) validator: type, enum, const, required,
     *  properties, additionalProperties:false, items, min/maxItems, min/maxLength,
     *  pattern, minimum, maximum, oneOf, anyOf, $ref. Enough for lesson.schema.json,
     *  no external dependency needed to keep this script runnable with nothing but Node. */
    function resolveRef(ref) {
      const name = ref.replace('#/$defs/', '')
      const target = defs[name]
      if (!target) throw new Error(`unresolved $ref: ${ref}`)
      return target
    }

    function typeOf(value) {
      if (Array.isArray(value)) return 'array'
      if (value === null) return 'null'
      return typeof value
    }

    function check(schemaNode, value, path, out) {
      if (schemaNode.$ref) return check(resolveRef(schemaNode.$ref), value, path, out)

      if (schemaNode.oneOf) {
        const results = schemaNode.oneOf.map((s) => {
          const local = []
          check(s, value, path, local)
          return local
        })
        const passing = results.filter((r) => r.length === 0)
        if (passing.length !== 1) out.push(`${path}: matched ${passing.length} of ${schemaNode.oneOf.length} alternatives (expected exactly 1)`)
        return
      }
      if (schemaNode.anyOf) {
        const results = schemaNode.anyOf.map((s) => {
          const local = []
          check(s, value, path, local)
          return local
        })
        if (!results.some((r) => r.length === 0)) out.push(`${path}: matched none of ${schemaNode.anyOf.length} alternatives`)
        return
      }

      if ('const' in schemaNode && value !== schemaNode.const) {
        out.push(`${path}: expected const ${JSON.stringify(schemaNode.const)}, got ${JSON.stringify(value)}`)
        return
      }
      if (schemaNode.enum && !schemaNode.enum.includes(value)) {
        out.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schemaNode.enum)}`)
        return
      }

      if (schemaNode.type) {
        const t = typeOf(value)
        const ok = schemaNode.type === 'integer' ? (t === 'number' && Number.isInteger(value)) : t === schemaNode.type
        if (!ok) {
          out.push(`${path}: expected type ${schemaNode.type}, got ${t}`)
          return
        }
      }

      if (typeof value === 'string') {
        if (schemaNode.minLength !== undefined && value.length < schemaNode.minLength) out.push(`${path}: shorter than minLength ${schemaNode.minLength}`)
        if (schemaNode.maxLength !== undefined && value.length > schemaNode.maxLength) out.push(`${path}: longer than maxLength ${schemaNode.maxLength}`)
        if (schemaNode.pattern && !new RegExp(schemaNode.pattern).test(value)) out.push(`${path}: does not match pattern ${schemaNode.pattern}`)
      }
      if (typeof value === 'number') {
        if (schemaNode.minimum !== undefined && value < schemaNode.minimum) out.push(`${path}: below minimum ${schemaNode.minimum}`)
        if (schemaNode.maximum !== undefined && value > schemaNode.maximum) out.push(`${path}: above maximum ${schemaNode.maximum}`)
      }

      if (Array.isArray(value)) {
        if (schemaNode.minItems !== undefined && value.length < schemaNode.minItems) out.push(`${path}: fewer than minItems ${schemaNode.minItems}`)
        if (schemaNode.maxItems !== undefined && value.length > schemaNode.maxItems) out.push(`${path}: more than maxItems ${schemaNode.maxItems}`)
        if (schemaNode.items) value.forEach((item, i) => check(schemaNode.items, item, `${path}[${i}]`, out))
      }

      if (typeOf(value) === 'object' && schemaNode.type === 'object') {
        for (const key of schemaNode.required ?? []) {
          if (!(key in value)) out.push(`${path}: missing required property "${key}"`)
        }
        if (schemaNode.additionalProperties === false) {
          const allowed = new Set(Object.keys(schemaNode.properties ?? {}))
          for (const key of Object.keys(value)) {
            if (!allowed.has(key)) out.push(`${path}: unexpected property "${key}"`)
          }
        }
        for (const [key, propSchema] of Object.entries(schemaNode.properties ?? {})) {
          if (key in value) check(propSchema, value[key], `${path}.${key}`, out)
        }
      }
    }

    function validateLesson(schemaRoot, data) {
      const out = []
      check(schemaRoot, data, '$', out)
      return out
    }

    // Text fields a learner actually reads. Code, ids, kinds and enum
    // discriminators are excluded: banning "predict-output" or "search" from
    // a `kind` field or a code identifier would make the schema unusable.
    function proseStrings(lesson) {
      const out = [lesson.title, lesson.hook, lesson.exitLine]
      for (const b of lesson.blocks ?? []) {
        for (const key of ['heading', 'body', 'caption', 'prompt', 'hint', 'explain', 'remember', 'say', 'figure', 'template']) {
          if (typeof b[key] === 'string') out.push(b[key])
        }
        for (const key of ['bullets', 'options', 'why']) {
          if (Array.isArray(b[key])) out.push(...b[key].filter((s) => typeof s === 'string'))
        }
        if (Array.isArray(b.steps)) out.push(...b.steps.map((s) => s.say).filter((s) => typeof s === 'string'))
      }
      return out.filter((s) => typeof s === 'string')
    }

    function codeStrings(lesson) {
      const out = []
      for (const b of lesson.blocks ?? []) {
        for (const key of ['code', 'starterCode', 'referenceSolution']) {
          if (typeof b[key] === 'string') out.push(b[key])
        }
      }
      return out
    }

    const bannedTextPattern = new RegExp(invariants.bannedTextPattern ?? '\\b(CLO|learning outcome|syllabus)\\b', invariants.bannedTextFlags ?? 'i')
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
    const blockOrder = invariants.blockOrder ?? ['concept', 'worked', 'check', 'recap', 'bridge']
    const blockCounts = invariants.blockCounts ?? {}
    const maxBlocks = invariants.maxBlocks ?? 8
    const maxCodeLines = invariants.code?.maxLines ?? 20
    const maxCodeCols = invariants.code?.maxCols ?? 90

    const seenLessonIds = new Map() // id -> file it first appeared in

    const lessonFiles = readdirSync(lessonsDir).filter((n) => n.endsWith('.json') && n !== 'lesson.schema.json').sort()
    for (const file of lessonFiles) {
      let doc
      try {
        doc = load(join('lessons', file))
      } catch (error) {
        errors.push(`lessons/${file}: invalid JSON (${error.message})`)
        continue
      }

      const shapeErrors = validateLesson(schema, doc)
      if (shapeErrors.length) {
        for (const e of shapeErrors) errors.push(`lessons/${file}: ${e}`)
        continue
      }

      for (const lesson of doc.lessons) {
        lessonCount++
        const tag = `lessons/${file}:${lesson.id}`

        if (lesson.id !== lesson.cloId) errors.push(`${tag} id must equal cloId`)
        if (lesson.course !== doc.course) errors.push(`${tag} lesson.course (${lesson.course}) does not match the file's course (${doc.course})`)

        if (seenLessonIds.has(lesson.id)) errors.push(`${tag} duplicate lesson id, also in ${seenLessonIds.get(lesson.id)}`)
        seenLessonIds.set(lesson.id, file)

        const clo = cloById.get(lesson.cloId)
        if (!clo) errors.push(`${tag} unknown cloId ${lesson.cloId}`)
        else if (clo.course !== lesson.course) errors.push(`${tag} cloId ${lesson.cloId} belongs to course ${clo.course}, not ${lesson.course}`)

        const course = courseByCode.get(lesson.course)
        if (course && lesson.language !== course.language && lesson.language !== 'sql' && lesson.language !== 'mongo') {
          errors.push(`${tag} language ${lesson.language} does not match course language ${course.language}`)
        }

        // Block order and counts.
        const counted = {}
        const orderIndex = []
        for (const block of lesson.blocks) {
          counted[block.type] = (counted[block.type] ?? 0) + 1
          if (blockOrder.includes(block.type)) orderIndex.push(block.type)
        }
        for (const kind of blockOrder) {
          const range = blockCounts[kind] ?? { min: 1, max: 1 }
          const n = counted[kind] ?? 0
          if (n < range.min || n > range.max) errors.push(`${tag} needs ${range.min}-${range.max} "${kind}" block(s), found ${n}`)
        }
        const sorted = [...orderIndex].sort((a, b) => blockOrder.indexOf(a) - blockOrder.indexOf(b))
        if (orderIndex.some((kind, i) => kind !== sorted[i])) {
          errors.push(`${tag} blocks are out of order; expected the sequence ${blockOrder.join(' -> ')}`)
        }
        if (lesson.blocks.length > maxBlocks) errors.push(`${tag} has ${lesson.blocks.length} blocks, over the cap of ${maxBlocks}`)

        // Code limits, per block.
        for (const code of codeStrings(lesson)) {
          const lines = code.split('\n')
          if (lines.length > maxCodeLines) errors.push(`${tag} a code block has ${lines.length} lines, over the cap of ${maxCodeLines}`)
          const longest = Math.max(...lines.map((l) => l.length))
          if (longest > maxCodeCols) errors.push(`${tag} a code block has a line ${longest} columns wide, over the cap of ${maxCodeCols}`)
        }

        // Java snippets are static-only until the CheerpJ adapter covers lessons (spec R3.4).
        for (const block of lesson.blocks) {
          if (block.type === 'snippet' && block.language === 'java' && block.runnable !== false) {
            errors.push(`${tag} a Java snippet must have runnable: false`)
          }
        }

        // Prose: no institution/CLO jargon, no pattern ids, no emoji.
        for (const text of proseStrings(lesson)) {
          if (bannedTextPattern.test(text)) errors.push(`${tag} prose contains a banned word: "${text}"`)
          if (emojiPattern.test(text)) errors.push(`${tag} prose contains an emoji: "${text}"`)
          const lower = text.toLowerCase()
          for (const pid of patternIds) {
            if (lower.includes(pid.toLowerCase())) errors.push(`${tag} prose leaks pattern id "${pid}": "${text}"`)
          }
        }
      }
    }
  }
}

if (errors.length) {
  console.error('SEED INVALID')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log(`seed ok: ${courses.length} courses, ${clos.length} CLOs, ${patterns.length} patterns, ${exerciseCount} exercises, ${drillCount} drills, ${lessonCount} lesson${lessonCount === 1 ? '' : 's'}`)
