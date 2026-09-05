import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
// Fixed DNS UUID namespace. Changing it would duplicate existing exercises.
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const COLUMNS = {
  patterns: ['id', 'name', 'description', 'family'],
  courses: ['code', 'slug', 'title', 'language', 'secondary_language', 'runtime', 'level', 'prerequisites', 'topics', 'clo_ids', 'status', 'packages'],
  clos: ['id', 'course', 'ordinal', 'outcome', 'topics', 'prerequisites', 'patterns', 'assessable_in_code', 'draft'],
  exercises: ['id', 'clo_id', 'language', 'kind', 'difficulty', 'pattern', 'title', 'prompt', 'starter_code', 'tests', 'reference_solution', 'origin', 'parent_exercise_id', 'author_user_id', 'verified', 'tags', 'fixture', 'created_at'],
  drills: ['id', 'kind', 'language', 'difficulty', 'time_limit_s', 'payload'],
}

export function uuidv5(name, namespace) {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8').digest().subarray(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function readRows(path, key, requireWrapper = false) {
  const data = JSON.parse(await readFile(path, 'utf8'), (key, value) => key.startsWith('$') ? undefined : value)
  const rows = !requireWrapper && Array.isArray(data) ? data : data?.[key]
  if (!Array.isArray(rows)) throw new Error(`${path}: expected a ${key} array`)
  return rows
}

async function readFolder(path, key) {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name).sort()
  const rows = await Promise.all(files.map(file => readRows(join(path, file), key)))
  return rows.flat()
}

function mapRow(table, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`${table}: expected each seed row to be an object`)
  }
  const row = {}
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('$')) continue
    const column = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
    if (COLUMNS[table].includes(column)) row[column] = value
  }
  if (table === 'courses') {
    row.secondary_language ??= null
    row.prerequisites ??= []
    row.topics ??= []
    row.clo_ids ??= []
    row.status ??= 'live'
    row.packages ??= []
  } else if (table === 'clos') {
    row.topics ??= []
    row.prerequisites ??= []
    row.patterns ??= []
    row.assessable_in_code ??= true
    row.draft ??= false
  } else if (table === 'exercises') {
    if (typeof row.clo_id !== 'string' || !row.clo_id || typeof row.title !== 'string' || !row.title) {
      throw new Error('exercises: each row needs cloId and title for its deterministic ID')
    }
    row.id = uuidv5(row.clo_id + '|' + row.title, NAMESPACE)
    row.starter_code ??= ''
    row.origin ??= 'seed'
    row.parent_exercise_id ??= null
    row.author_user_id ??= null
    row.verified ??= true
    row.tags ??= []
    row.fixture ??= null
  } else if (table === 'drills') {
    row.language ??= null
  }
  return row
}

export async function readSeedTables(root = ROOT) {
  const seed = join(root, 'seed')
  const sources = await Promise.all([
    readRows(join(seed, 'patterns.json'), 'patterns'),
    readRows(join(seed, 'courses.json'), 'courses', true),
    readRows(join(seed, 'clos.json'), 'clos'),
    readFolder(join(seed, 'exercises'), 'exercises'),
    readFolder(join(seed, 'drills'), 'items'),
  ])
  return Object.keys(COLUMNS).map((name, index) => ({
    name,
    onConflict: name === 'courses' ? 'code' : 'id',
    rows: sources[index].map(source => mapRow(name, source)),
  }))
}

async function credentials(root, env) {
  let local = {}
  try {
    local = parseEnv(await readFile(join(root, '.env.local'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const values = { ...local }
  for (const [name, value] of Object.entries(env)) {
    if (value?.trim()) values[name] = value
  }
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!values[name]?.trim()) throw new Error(`Missing required variable ${name}. Set it in .env.local or the environment.`)
  }
  return values
}

export async function loadSeed({ root = ROOT, dryRun = false, env = process.env } = {}) {
  let client
  if (!dryRun) {
    const values = await credentials(root, env)
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(values.NEXT_PUBLIC_SUPABASE_URL, values.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }
  const tables = await readSeedTables(root)
  if (dryRun) console.log('Dry run: no database connection.')
  const counts = {}
  for (const { name, onConflict, rows } of tables) {
    if (client && rows.length) {
      const { error } = await client.from(name).upsert(rows, { onConflict, defaultToNull: false })
      if (error) throw new Error(`${name}: seed upsert failed: ${error.message}`)
    }
    counts[name] = rows.length
    console.log(`${name}: ${rows.length}`)
  }
  return counts
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => arg !== '--dry-run')) throw new Error('Usage: node scripts/seed-load.mjs [--dry-run]')
    await loadSeed({ dryRun: args.includes('--dry-run') })
  } catch (error) {
    console.error(`Seed load failed: ${error.message}`)
    process.exitCode = 1
  }
}
