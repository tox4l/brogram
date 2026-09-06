#!/usr/bin/env node
// Builds the static curriculum bundle the browser reads with zero Supabase
// round trips (spec R5.1). Reads seed/*.json, applies the same filters the
// live Supabase queries apply (`status === 'live'`, `verified === true`),
// strips every secret, and writes:
//
//   src/lib/curriculum/generated.ts        COURSES, CLOS, PATTERNS, COURSE_HASHES, BUILD_ID
//   public/curriculum/manifest.json        { buildId, files: { "<CODE>": "<sha1>" } }
//   public/curriculum/course/<CODE>.json   { clos, exercises, lessons }
//   public/curriculum/drills/<kind>.json   DrillItem[]
//
// Usage:
//   node scripts/build-static-curriculum.mjs           writes the files above
//   node scripts/build-static-curriculum.mjs --check    exits non-zero if
//     re-generating from seed/ would produce anything different from what is
//     on disk right now (the CI gate that keeps committed generated.ts honest)
//
// Determinism is load-bearing for --check: every object is written with keys
// in sorted order and every array has a fixed sort (see the comparators
// below), and BUILD_ID is a hash of content, never a timestamp.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// `dirname` twice rather than `new URL('../', import.meta.url)`: the latter
// throws "The URL must be of scheme file" when a test runner (vitest/vite)
// loads this module directly and rewrites import.meta.url to something that
// is not a bare file:// URL. fileURLToPath + dirname works under both `node`
// and a test runner's module loader.
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SEED_DIR = join(ROOT, 'seed')
const EXERCISES_DIR = join(SEED_DIR, 'exercises')
const LESSONS_DIR = join(SEED_DIR, 'lessons')
const DRILLS_DIR = join(SEED_DIR, 'drills')
export const PUBLIC_CURRICULUM_DIR = join(ROOT, 'public', 'curriculum')
const COURSE_DIR = join(PUBLIC_CURRICULUM_DIR, 'course')
const DRILLS_OUT_DIR = join(PUBLIC_CURRICULUM_DIR, 'drills')
const MANIFEST_PATH = join(PUBLIC_CURRICULUM_DIR, 'manifest.json')
export const GENERATED_TS_PATH = join(ROOT, 'src', 'lib', 'curriculum', 'generated.ts')

// Must stay byte-identical to scripts/seed-load.mjs's NAMESPACE/uuidv5: an
// exercise's id here has to match the id Supabase assigns the same row, or
// R5.1b's fall-through to `exercises_public` can never find a match.
const EXERCISE_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function uuidv5(name, namespace) {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Playground games are code, not seeded content (spec §7.9), but they still
// need a drill row so drill_results and streak math need no special case for
// `lane: 'play'`. Restated (not imported) so this script has no runtime
// dependency on a file another Wave-0 task owns — must stay byte-identical to
// scripts/seed-load.mjs's PLAY_GAME_TIME_LIMITS/playDrillItems(), and the
// kind set must stay identical to PLAY_KINDS in src/app/(app)/derot/lib.ts.
const PLAY_GAME_TIME_LIMITS = {
  'follow-the-dot': 75,
  'color-nback': 90,
  reaction: 60,
  rhythm: 60,
  breathe: 90,
  'memory-grid': 90,
}

function playDrillItems() {
  return Object.entries(PLAY_GAME_TIME_LIMITS).map(([kind, timeLimitS]) => ({
    id: `play-${kind}`,
    kind,
    lane: 'play',
    difficulty: 3,
    timeLimitS,
    payload: {},
  }))
}

/**
 * Explicit field pick for a DrillItem, with the same default seed-load.mjs
 * applies for a seed-authored row (`row.lane ??= 'arcade'`). `language` is
 * omitted rather than nulled when absent: unlike the DB column, DrillItem's
 * `language` is an optional TS field, not a nullable one.
 */
function normalizeDrillItem(raw) {
  const item = {
    id: raw.id,
    kind: raw.kind,
    difficulty: raw.difficulty,
    payload: raw.payload,
    timeLimitS: raw.timeLimitS,
    lane: raw.lane ?? 'arcade',
  }
  if (raw.language) item.language = raw.language
  return item
}

function assertDrillLanes(drillsByKind) {
  for (const [kind, items] of drillsByKind) {
    for (const item of items) {
      if (item.lane !== 'arcade' && item.lane !== 'play') {
        throw new Error(`build-static-curriculum: drill ${kind}/${item.id} has an invalid lane "${item.lane}"`)
      }
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'), (key, value) => (key.startsWith('$') ? undefined : value))
}

/** Direct-child *.json files only, sorted, so a nested folder (e.g. seed/exercises/unverified/) is never included. */
function jsonFilesIn(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key])
    return out
  }
  return value
}

function canonicalJson(value) {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`
}

function sha1(content) {
  return createHash('sha1').update(content).digest('hex')
}

/** The secrecy strips (R5.1) are asserted here, not only in the test that reads the written files. */
export function assertNoSubstring(value, needle, context) {
  if (JSON.stringify(value).includes(needle)) {
    throw new Error(`build-static-curriculum: "${needle}" survived the ${context} strip`)
  }
}

/**
 * Per-`type` (and, for `check`, per-`kind`) field allowlists mirroring
 * `LessonPublicBlock` (src/lib/contracts.ts) field-for-field. This is an
 * allowlist, not a denylist: a block or check kind not named here is a
 * build error, not a silently-passed-through payload — the same fail-closed
 * shape `buildModel` already uses for an unknown `cloId`.
 */
const LESSON_BLOCK_FIELDS = {
  concept: ['type', 'id', 'heading', 'body', 'figure'],
  snippet: ['type', 'id', 'language', 'code', 'runnable', 'caption', 'highlight', 'packages'],
  worked: ['type', 'id', 'language', 'code', 'steps', 'caption'],
  recap: ['type', 'id', 'bullets', 'remember'],
  bridge: ['type', 'id', 'say'],
}

const LESSON_CHECK_FIELDS = {
  'predict-output': ['type', 'id', 'kind', 'prompt', 'language', 'code', 'expected', 'normalize', 'hint', 'explain'],
  choose: ['type', 'id', 'kind', 'prompt', 'options', 'correctIndex', 'why', 'hint', 'explain'],
  'spot-the-bug': ['type', 'id', 'kind', 'prompt', 'language', 'code', 'bugLines', 'hint', 'explain'],
  'fill-blank': ['type', 'id', 'kind', 'prompt', 'language', 'template', 'blanks', 'hint', 'explain'],
  'micro-code': ['type', 'id', 'kind', 'prompt', 'language', 'starterCode', 'tests', 'hint', 'explain'],
}

function pickKnownFields(source, allowedKeys) {
  const allowed = new Set(allowedKeys)
  const out = {}
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) out[key] = source[key]
  }
  return out
}

/**
 * Projects one lesson block to its public shape. Throws — failing the build
 * closed, exit non-zero, with the lesson id and the offending type/kind — on
 * a block `type` or check `kind` this table does not recognise, instead of
 * shipping an unknown shape's fields (including any secret it might carry)
 * untouched.
 */
export function projectLessonBlock(lesson, block) {
  if (block.type === 'check') {
    const fields = LESSON_CHECK_FIELDS[block.kind]
    if (!fields) {
      throw new Error(`build-static-curriculum: lesson ${lesson.id}: unknown check kind "${block.kind}"`)
    }
    return pickKnownFields(block, fields)
  }
  const fields = LESSON_BLOCK_FIELDS[block.type]
  if (!fields) {
    throw new Error(`build-static-curriculum: lesson ${lesson.id}: unknown block type "${block.type}"`)
  }
  return pickKnownFields(block, fields)
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// ---------------------------------------------------------------------------
// Read seed/, normalize snake_case -> the contract shape
// ---------------------------------------------------------------------------

export function readSeed() {
  const coursesRaw = readJson(join(SEED_DIR, 'courses.json'))
  const closRaw = readJson(join(SEED_DIR, 'clos.json'))
  const patternsRaw = readJson(join(SEED_DIR, 'patterns.json'))

  // seed/exercises/unverified/ is a directory, not a *.json file, so
  // jsonFilesIn already excludes it; nothing generated may come from there.
  const exercises = []
  for (const file of jsonFilesIn(EXERCISES_DIR)) {
    const { exercises: rows } = readJson(join(EXERCISES_DIR, file))
    for (const row of rows ?? []) exercises.push({ ...row, $file: file })
  }

  const lessons = []
  for (const file of jsonFilesIn(LESSONS_DIR)) {
    if (file === 'lesson.schema.json') continue
    const data = readJson(join(LESSONS_DIR, file))
    for (const lesson of data.lessons ?? []) lessons.push({ ...lesson, $file: file })
  }

  const drills = new Map()
  for (const file of jsonFilesIn(DRILLS_DIR)) {
    const kind = file.replace(/\.json$/, '')
    const { items } = readJson(join(DRILLS_DIR, file))
    drills.set(kind, items ?? [])
  }

  return { coursesRaw, closRaw, patternsRaw, exercises, lessons, drills }
}

/**
 * Normalizes every seed row to the contract shape (src/lib/contracts.ts) and
 * applies the same filters the live Supabase queries apply: `verified` seed
 * exercises only (missing the field defaults to verified, exactly as
 * scripts/seed-load.mjs's `row.verified ??= true` does for the DB row), every
 * course and CLO regardless of status (coming-soon still needs to render).
 */
export function buildModel() {
  const { coursesRaw, closRaw, patternsRaw, exercises, lessons, drills } = readSeed()

  const patterns = patternsRaw.patterns.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    family: p.family,
  }))

  const courses = coursesRaw.courses
    .map((c) => {
      const course = {
        code: c.code,
        slug: c.slug,
        title: c.title,
        language: c.language,
        runtime: c.runtime,
        level: c.level,
        prerequisites: c.prerequisites ?? [],
        topics: c.topics ?? [],
        cloIds: c.clo_ids ?? [],
        status: c.status,
      }
      if (c.secondary_language) course.secondaryLanguage = c.secondary_language
      if (c.packages) course.packages = c.packages
      return course
    })
    // by level then code (determinism rule)
    .sort((a, b) => cmp(a.level, b.level) || cmp(a.code, b.code))

  const clos = closRaw.clos
    .map((c) => {
      const clo = {
        id: c.id,
        course: c.course,
        ordinal: c.ordinal,
        outcome: c.outcome,
        topics: c.topics ?? [],
        prerequisites: c.prerequisites ?? [],
        patterns: c.patterns ?? [],
        assessableInCode: c.assessable_in_code,
      }
      if (typeof c.draft === 'boolean') clo.draft = c.draft
      return clo
    })
    // by course then ordinal (determinism rule; also what closFor() relies on)
    .sort((a, b) => cmp(a.course, b.course) || cmp(a.ordinal, b.ordinal))

  const courseByCloId = new Map(clos.map((c) => [c.id, c.course]))

  const exercisesFull = exercises
    .filter((e) => e.verified !== false)
    .map((e) => {
      if (!courseByCloId.has(e.cloId)) {
        throw new Error(`build-static-curriculum: ${e.$file}: exercise "${e.title}" has unknown cloId ${e.cloId}`)
      }
      const exercise = {
        id: uuidv5(`${e.cloId}|${e.title}`, EXERCISE_ID_NAMESPACE),
        cloId: e.cloId,
        language: e.language,
        kind: e.kind,
        difficulty: e.difficulty,
        pattern: e.pattern,
        title: e.title,
        prompt: e.prompt,
        starterCode: e.starterCode ?? '',
        tests: e.tests,
        referenceSolution: e.referenceSolution,
        origin: e.origin ?? 'seed',
        tags: e.tags ?? [],
      }
      if (e.parentExerciseId) exercise.parentExerciseId = e.parentExerciseId
      if (e.fixture) exercise.fixture = e.fixture
      return exercise
    })
    // by cloId then pattern then difficulty then title (determinism rule)
    .sort(
      (a, b) =>
        cmp(a.cloId, b.cloId) || cmp(a.pattern, b.pattern) || cmp(a.difficulty, b.difficulty) || cmp(a.title, b.title),
    )

  const lessonsFull = lessons
    .map((l) => {
      const course = l.course ?? courseByCloId.get(l.cloId)
      if (!course) {
        throw new Error(`build-static-curriculum: ${l.$file}: lesson "${l.id}" has unknown cloId ${l.cloId}`)
      }
      return {
        id: l.id,
        cloId: l.cloId,
        course,
        language: l.language,
        version: l.version,
        title: l.title,
        hook: l.hook,
        estimatedMinutes: l.estimatedMinutes,
        draft: l.draft,
        tags: l.tags ?? [],
        blocks: l.blocks,
        exitLine: l.exitLine,
      }
    })
    // by cloId (determinism rule; one lesson per CLO so this is a total order)
    .sort((a, b) => cmp(a.cloId, b.cloId))

  // Every seed-authored drill defaults to lane 'arcade' (mirrors
  // scripts/seed-load.mjs's mapRow), and the six Playground kinds are
  // synthesized with lane 'play' exactly as seed-load.mjs's playDrillItems()
  // does — none of this comes from seed/drills/*.json, which carries no
  // `lane` key at all.
  const drillsByKind = new Map()
  for (const [kind, items] of drills) drillsByKind.set(kind, items.map(normalizeDrillItem))
  for (const item of playDrillItems()) drillsByKind.set(item.kind, [normalizeDrillItem(item)])
  assertDrillLanes(drillsByKind)

  return { patterns, courses, clos, exercisesFull, lessonsFull, drills: drillsByKind, courseByCloId }
}

// ---------------------------------------------------------------------------
// Strip secrets — an explicit field allowlist per shape, asserted after
// ---------------------------------------------------------------------------

export function stripExerciseSecrets(exercisesFull) {
  const stripped = exercisesFull.map((exercise) => {
    const copy = { ...exercise }
    delete copy.referenceSolution
    return copy
  })
  assertNoSubstring(stripped, 'referenceSolution', 'exercise')
  return stripped
}

/**
 * Every lesson block is rebuilt from `projectLessonBlock`'s per-type/per-kind
 * allowlist (fails the build on an unrecognised type or check kind), and
 * `assertNoSubstring` still runs afterward as a second, independent guard —
 * belt and braces, not either/or.
 */
export function projectLessonPublic(lessonsFull) {
  const projected = lessonsFull.map((lesson) => ({
    ...lesson,
    blocks: lesson.blocks.map((block) => projectLessonBlock(lesson, block)),
  }))
  assertNoSubstring(projected, 'referenceSolution', 'lesson micro-code check')
  assertNoSubstring(projected, 'expectedStdout', 'lesson snippet')
  return projected
}

// ---------------------------------------------------------------------------
// Render generated.ts
// ---------------------------------------------------------------------------

function renderGeneratedTs({ buildId, courses, clos, patterns, courseHashes }) {
  const lines = [
    '// GENERATED FILE. Produced by scripts/build-static-curriculum.mjs from seed/*.json.',
    '// Do not hand-edit — run `node scripts/build-static-curriculum.mjs` to regenerate.',
    '// `node scripts/build-static-curriculum.mjs --check` fails the build if this file is stale.',
    '',
    "import type { Clo, Course, CourseCode } from '../contracts'",
    '',
    `export const BUILD_ID: string = ${JSON.stringify(buildId)}`,
    '',
    `export const COURSES: readonly Course[] = ${JSON.stringify(sortKeysDeep(courses), null, 2)}`,
    '',
    `export const CLOS: readonly Clo[] = ${JSON.stringify(sortKeysDeep(clos), null, 2)}`,
    '',
    `export const PATTERNS: readonly { id: string; name: string; description: string; family: string }[] = ${JSON.stringify(sortKeysDeep(patterns), null, 2)}`,
    '',
    `export const COURSE_HASHES: Readonly<Record<CourseCode, string>> = ${JSON.stringify(sortKeysDeep(courseHashes), null, 2)}`,
    '',
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Compute / write / check artifacts
// ---------------------------------------------------------------------------

/** Map<absolutePath, fileContent>. Nothing is written to disk here. */
export function computeArtifacts() {
  const { patterns, courses, clos, exercisesFull, lessonsFull, drills, courseByCloId } = buildModel()
  const exercisesPublic = stripExerciseSecrets(exercisesFull)
  const lessonsPublic = projectLessonPublic(lessonsFull)

  const liveCodes = courses.filter((c) => c.status === 'live').map((c) => c.code)

  // code -> file content string. Only live courses get a per-course file
  // (R5.1); a coming-soon course still appears in COURSES below.
  const courseFileContent = new Map()
  for (const code of liveCodes) {
    const bundle = {
      clos: clos.filter((c) => c.course === code),
      exercises: exercisesPublic.filter((e) => courseByCloId.get(e.cloId) === code),
      lessons: lessonsPublic.filter((l) => l.course === code),
    }
    courseFileContent.set(code, canonicalJson(bundle))
  }

  const courseHashes = {}
  for (const [code, content] of courseFileContent) courseHashes[code] = sha1(content)

  // BUILD_ID is a hash of content, never a timestamp, so --check is stable.
  const buildId = sha1(
    Object.keys(courseHashes)
      .sort()
      .map((code) => `${code}:${courseHashes[code]}`)
      .join('|'),
  )

  const artifacts = new Map()
  artifacts.set(GENERATED_TS_PATH, renderGeneratedTs({ buildId, courses, clos, patterns, courseHashes }))
  artifacts.set(MANIFEST_PATH, canonicalJson({ buildId, files: courseHashes }))
  for (const [code, content] of courseFileContent) artifacts.set(join(COURSE_DIR, `${code}.json`), content)
  for (const [kind, items] of drills) artifacts.set(join(DRILLS_OUT_DIR, `${kind}.json`), canonicalJson(items))

  return artifacts
}

function cleanStale(dir, expectedPaths) {
  if (!existsSync(dir)) return
  const expected = new Set(expectedPaths.map((p) => resolve(p)))
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (!expected.has(resolve(full))) rmSync(full, { recursive: true, force: true })
  }
}

/** Writes every artifact to disk and removes stale course/drill files that are no longer expected. */
export function writeArtifacts(artifacts) {
  const paths = [...artifacts.keys()]
  cleanStale(
    COURSE_DIR,
    paths.filter((p) => p.startsWith(COURSE_DIR)),
  )
  cleanStale(
    DRILLS_OUT_DIR,
    paths.filter((p) => p.startsWith(DRILLS_OUT_DIR)),
  )

  for (const [path, content] of artifacts) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
}

/**
 * A checkout with `core.autocrlf=true` and no `.gitattributes` (this
 * machine's default) rewrites a committed LF file to CRLF on disk with zero
 * real content drift. Comparing after normalizing both sides keeps `--check`
 * honest about actual drift instead of the host's line-ending settings.
 */
function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n')
}

/** Compares artifacts against what is on disk without writing anything. */
export function checkArtifacts(artifacts) {
  const mismatches = []

  for (const [path, content] of artifacts) {
    if (!existsSync(path)) {
      mismatches.push(`missing: ${path}`)
      continue
    }
    if (normalizeEol(readFileSync(path, 'utf8')) !== normalizeEol(content)) mismatches.push(`stale: ${path}`)
  }

  for (const dir of [COURSE_DIR, DRILLS_OUT_DIR]) {
    if (!existsSync(dir)) continue
    const expected = new Set([...artifacts.keys()].filter((p) => p.startsWith(dir)).map((p) => resolve(p)))
    for (const name of readdirSync(dir)) {
      const full = resolve(join(dir, name))
      if (statSync(full).isFile() && !expected.has(full)) mismatches.push(`extra: ${full}`)
    }
  }

  return { ok: mismatches.length === 0, mismatches }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const check = process.argv.includes('--check')
  const artifacts = computeArtifacts()

  if (check) {
    const { ok, mismatches } = checkArtifacts(artifacts)
    if (!ok) {
      console.error('static curriculum is out of date; run `node scripts/build-static-curriculum.mjs`')
      for (const mismatch of mismatches) console.error(` - ${mismatch}`)
      process.exitCode = 1
      return
    }
    console.log(`static curriculum check ok: ${artifacts.size} files match seed/`)
    return
  }

  writeArtifacts(artifacts)
  console.log(`static curriculum built: ${artifacts.size} files`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`build-static-curriculum failed: ${error.message}`)
    process.exitCode = 1
  })
}
