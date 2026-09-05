import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const loaderUrl = new URL('../../../scripts/seed-load.mjs', import.meta.url)
const serverUrl = new URL('../../../src/lib/supabase/server.ts', import.meta.url)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'brogram-a1-'))
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    assert.ok(root.includes('brogram-a1-'))
    await rm(root, { recursive: true, force: true })
  })
  const json = async (file, value) => {
    const path = join(root, file)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(value))
  }
  await json('seed/patterns.json', { patterns: [{ id: 'trace', name: 'Trace', description: 'Trace values', family: 'logic', note: 'drop' }] })
  await json('seed/courses.json', {
    courses: [{ code: 'C1', slug: 'course', title: 'Course', language: 'python', runtime: 'browser', level: 1, clo_ids: ['C1-1'], note: 'drop' }],
    coming_soon: [{ code: 'DO-NOT-LOAD' }],
  })
  await json('seed/clos.json', { clos: [{ id: 'C1-1', course: 'C1', ordinal: 1, outcome: 'Trace', assessable_in_code: false }] })
  return { root, json }
}

test('seed UUIDv5 agrees with the standard DNS namespace vector', async () => {
  const { uuidv5 } = await import(loaderUrl)
  assert.equal(uuidv5('www.widgets.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '21f7f8de-8051-5b89-8680-0195ef798b6a')
})

test('seed mapping excludes nested files and metadata, preserves grading JSON, and fills defaults', async (t) => {
  const { root, json } = await fixture(t)
  await json('seed/exercises/one.json', { exercises: [{
    id: 'legacy-id', cloId: 'C1-1', title: 'Trace one', language: 'python', kind: 'code', difficulty: 2,
    pattern: 'trace', prompt: 'Trace it', starterCode: 'pass', referenceSolution: 'print(1)',
    tests: [{ id: 't1', input: '', expected: '1', hidden: true, '$note': 'drop' }],
    '$note': 'drop', unexpected: 'drop',
  }] })
  await json('seed/exercises/unverified/ignored.json', { exercises: [{ cloId: 'C1-1', title: 'Do not load' }] })
  await json('seed/drills/one.json', { items: [{ id: 'd1', kind: 'trace', difficulty: 2, timeLimitS: 20, payload: { stepIndex: 1, '$note': 'drop' } }] })
  const { readSeedTables } = await import(loaderUrl)
  const tables = await readSeedTables(root)
  const rows = Object.fromEntries(tables.map(table => [table.name, table.rows]))
  assert.deepEqual(tables.map(({ name, onConflict }) => [name, onConflict]), [
    ['patterns', 'id'], ['courses', 'code'], ['clos', 'id'], ['exercises', 'id'], ['drills', 'id'],
  ])
  assert.equal(rows.courses.length, 1)
  assert.equal(rows.courses[0].note, undefined)
  assert.deepEqual(rows.courses[0].packages, [])
  assert.equal(rows.clos[0].draft, false)
  assert.equal(rows.clos[0].assessable_in_code, false)
  assert.equal(rows.exercises.length, 1)
  assert.match(rows.exercises[0].id, /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  assert.equal(rows.exercises[0].starter_code, 'pass')
  assert.equal(rows.exercises[0].reference_solution, 'print(1)')
  assert.equal(rows.exercises[0].unexpected, undefined)
  assert.equal(rows.exercises[0].$note, undefined)
  assert.deepEqual(rows.exercises[0].tests, [{ id: 't1', input: '', expected: '1', hidden: true }])
  assert.deepEqual(rows.drills[0].payload, { stepIndex: 1 })
  assert.equal(rows.drills[0].time_limit_s, 20)
  const again = await readSeedTables(root)
  assert.equal(again[3].rows[0].id, rows.exercises[0].id)
})

test('dry run needs no credentials, tolerates absent folders, and never fetches', async (t) => {
  const { root } = await fixture(t)
  const { loadSeed } = await import(loaderUrl)
  const previous = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Network forbidden') }
  t.after(() => { globalThis.fetch = previous })
  const counts = await loadSeed({ root, dryRun: true, env: {} })
  assert.deepEqual(counts, { patterns: 1, courses: 1, clos: 1, exercises: 0, drills: 0 })
})

test('live loader names each missing credential before any connection', async (t) => {
  const { root } = await fixture(t)
  const { loadSeed } = await import(loaderUrl)
  await assert.rejects(loadSeed({ root, env: {} }), /NEXT_PUBLIC_SUPABASE_URL/)
  await assert.rejects(loadSeed({ root, env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid' } }), /SUPABASE_SERVICE_ROLE_KEY/)
})

test('live loader uses env over .env.local and sends ordered upserts with conflict keys', async (t) => {
  const { root } = await fixture(t)
  await writeFile(join(root, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL="https://example.invalid"\nSUPABASE_SERVICE_ROLE_KEY="local-test-key"\n')
  const { loadSeed } = await import(loaderUrl)
  const previous = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: new URL(url), options })
    return new Response(null, { status: 201 })
  }
  t.after(() => { globalThis.fetch = previous })
  await loadSeed({ root, env: { SUPABASE_SERVICE_ROLE_KEY: 'environment-test-key' } })
  assert.deepEqual(requests.map(r => [r.url.pathname, r.url.searchParams.get('on_conflict')]), [
    ['/rest/v1/patterns', 'id'], ['/rest/v1/courses', 'code'], ['/rest/v1/clos', 'id'],
  ])
  for (const { options } of requests) {
    const headers = new Headers(options.headers)
    assert.equal(headers.get('apikey'), 'environment-test-key')
    assert.equal(options.method, 'POST')
    assert.match(headers.get('prefer'), /resolution=merge-duplicates/)
  }
  assert.equal(JSON.parse(requests[2].options.body)[0].draft, false)
})

test('a failed table upsert stops before dependent tables', async (t) => {
  const { root } = await fixture(t)
  const { loadSeed } = await import(loaderUrl)
  const previous = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    return new Response(JSON.stringify({ code: '23503', message: 'missing parent', details: '', hint: '' }), { status: 400 })
  }
  t.after(() => { globalThis.fetch = previous })
  await assert.rejects(loadSeed({ root, env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' } }), /patterns.*missing parent/)
  assert.equal(requests.length, 1)
})

function serverHarness({ user = { id: 'u1' }, authError = null, profileError = null, readonlyCookies = false } = {}) {
  const profile = { id: 'u1', account_status: 'restricted', restricted_until: '2026-09-06T00:00:00Z' }
  const calls = []
  const cookieStore = {
    getAll: () => [{ name: 'auth', value: 'cookie' }],
    set: (...args) => { if (readonlyCookies) throw new Error('Readonly cookies'); calls.push(['set', ...args]) },
  }
  const query = {
    select: (columns) => { calls.push(['select', columns]); return query },
    eq: (column, value) => { calls.push(['eq', column, value]); return query },
    maybeSingle: async () => ({ data: profile, error: profileError }),
    single: async () => ({ data: profile, error: profileError }),
  }
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key' }
  let cookieMethods
  const modules = {
    'server-only': {},
    'next/headers': { cookies: async () => cookieStore },
    '@supabase/ssr': { createServerClient: (url, key, options) => {
      calls.push(['ssr', url, key]); cookieMethods = options.cookies
      return { auth: { getUser: async () => { calls.push(['getUser']); return { data: { user }, error: authError } } }, from: (name) => { calls.push(['from', name]); return query } }
    } },
    '@supabase/supabase-js': { createClient: (...args) => { calls.push(['service', ...args]); return { service: true } } },
  }
  const exports = {}
  const source = ts.transpileModule(readFileSync(serverUrl, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(source, { exports, require: (name) => { assert.ok(name in modules, name); return modules[name] }, process: { env } })
  return { exports, calls, env, profile, get cookieMethods() { return cookieMethods } }
}

test('server helpers verify identity, select only its profile, and forward refreshed cookies', async () => {
  const h = serverHarness()
  const result = await h.exports.getUserAndProfile()
  assert.equal(result.user.id, 'u1')
  assert.deepEqual(result.profile, h.profile)
  assert.ok(h.calls.some(c => c[0] === 'getUser'))
  assert.ok(h.calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === 'u1'))
  assert.ok(h.calls.some(c => c[0] === 'select' && c[1] === 'id, account_status, restricted_until'))
  assert.deepEqual(h.cookieMethods.getAll(), [{ name: 'auth', value: 'cookie' }])
  h.cookieMethods.setAll([{ name: 'refreshed', value: 'token', options: { httpOnly: true } }])
  assert.ok(h.calls.some(c => c[0] === 'set' && c[1] === 'refreshed'))
})

test('failed identity verification never reads a profile even if stale user data exists', async () => {
  const h = serverHarness({ authError: { message: 'invalid token' } })
  const result = await h.exports.getUserAndProfile()
  assert.equal(result.user, null)
  assert.equal(result.profile, null)
  assert.ok(h.calls.every(c => c[0] !== 'from'))
})

test('missing user returns null and a profile query outage is surfaced', async () => {
  const h = serverHarness({ user: null })
  const result = await h.exports.getUserAndProfile()
  assert.equal(result.user, null)
  assert.equal(result.profile, null)
  const failing = serverHarness({ profileError: { message: 'database unavailable' } })
  await assert.rejects(failing.exports.getUserAndProfile(), /profile/i)
})

test('readonly Server Component cookies do not break profile retrieval', async () => {
  const h = serverHarness({ readonlyCookies: true })
  await h.exports.getUserAndProfile()
  assert.doesNotThrow(() => h.cookieMethods.setAll([{ name: 'auth', value: 'new', options: {} }]))
})

test('service credentials are required lazily and service client has no session persistence', () => {
  const h = serverHarness()
  h.exports.serviceClient()
  const call = h.calls.find(c => c[0] === 'service')
  assert.equal(call[2], 'service-key')
  assert.equal(call[3].auth.persistSession, false)
  assert.equal(call[3].auth.autoRefreshToken, false)
  assert.equal(call[3].auth.detectSessionInUrl, false)
  delete h.env.SUPABASE_SERVICE_ROLE_KEY
  assert.throws(() => h.exports.serviceClient(), /SUPABASE_SERVICE_ROLE_KEY/)
})
