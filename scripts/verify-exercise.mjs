#!/usr/bin/env node
// Runs referenceSolution against tests for every exercise in one or more
// exercise bank JSON files. See docs/prompts/agents/03-author.md for the
// TestCase conventions per language.
import fs from 'node:fs'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { normalizeJavaSolution } from './lib/java-normalize.mjs'

const TEST_TIMEOUT_MS = 10_000
const PACKAGE_IMPORT_RE = {
  numpy: /\bimport\s+numpy\b|\bfrom\s+numpy\b/,
  pandas: /\bimport\s+pandas\b|\bfrom\s+pandas\b/,
  matplotlib: /\bimport\s+matplotlib\b|\bfrom\s+matplotlib\b/,
  'scikit-learn': /\bimport\s+sklearn\b|\bfrom\s+sklearn\b/,
}

function truncate(value, n = 200) {
  const s = String(value ?? '')
  return s.length > n ? s.slice(0, n) + '...' : s
}

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

/** Exact-string match, else parsed-JSON deep equality. */
function compare(actual, expected) {
  if (actual === expected) return true
  try {
    return deepEqual(JSON.parse(actual), JSON.parse(expected))
  } catch {
    return false
  }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const result = (id, passed, actual, expected, extra = {}) => ({ id, passed, actual, expected, ...extra })

// -- python (pyodide) --------------------------------------------------------

let pyodideInstance = null
async function getPyodide() {
  if (!pyodideInstance) {
    const { loadPyodide } = await import('pyodide')
    pyodideInstance = await loadPyodide()
  }
  return pyodideInstance
}

function detectPyFunctionName(starterCode, referenceSolution) {
  const m = starterCode.match(/def\s+(\w+)\s*\(/)
  if (m) return m[1]
  const all = [...referenceSolution.matchAll(/def\s+(\w+)\s*\(/g)]
  return all.length ? all.at(-1)[1] : null
}

async function runPython(exercise) {
  const pyodide = await getPyodide()
  for (const [pkg, re] of Object.entries(PACKAGE_IMPORT_RE)) {
    if (re.test(exercise.referenceSolution)) await pyodide.loadPackage([pkg])
  }

  const funcName = detectPyFunctionName(exercise.starterCode, exercise.referenceSolution)
  const isFunctionTest = /def\s+\w+\s*\(/.test(exercise.starterCode)
  const results = []

  for (const test of exercise.tests) {
    let stdout = []
    let stderr = []
    pyodide.setStdout({ batched: (s) => stdout.push(s) })
    pyodide.setStderr({ batched: (s) => stderr.push(s) })
    const globals = pyodide.toPy({})
    try {
      await withTimeout(
        (async () => {
          if (isFunctionTest) {
            pyodide.runPython(exercise.referenceSolution, { globals })
            const code = [
              'import json',
              `__args = json.loads(${JSON.stringify(test.input)})`,
              `__result = ${funcName}(*__args)`,
              '__out = json.dumps(__result, default=str)',
            ].join('\n')
            pyodide.runPython(code, { globals })
            const actual = globals.get('__out')
            results.push(result(test.id, compare(actual, test.expected), actual, test.expected, { stderr: stderr.join('\n') }))
          } else {
            const lines = test.input.split('\n')
            let i = 0
            pyodide.setStdin({ stdin: () => (i < lines.length ? lines[i++] : null) })
            pyodide.runPython(exercise.referenceSolution, { globals })
            const actual = stdout.join('\n').trim()
            results.push(result(test.id, compare(actual, test.expected.trim()), actual, test.expected, { stderr: stderr.join('\n') }))
          }
        })(),
        TEST_TIMEOUT_MS,
      )
    } catch (err) {
      const stderrMsg = err.message === 'timeout' ? 'timeout' : `${err.message}\n${stderr.join('\n')}`
      results.push(result(test.id, false, '', test.expected, { stderr: stderrMsg }))
    } finally {
      globals.destroy()
    }
  }
  return results
}

// -- javascript / typescript (node:vm) ---------------------------------------

function stripExports(code) {
  return code
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+function/g, 'function')
    .replace(/export\s+const/g, 'const')
    .replace(/export\s+class/g, 'class')
    .replace(/export\s*\{[^}]*\}\s*;?/g, '')
}

let tsModule
async function transpileIfTs(code, language) {
  if (language !== 'typescript') return code
  if (tsModule === undefined) {
    const mod = await import('typescript').then((m) => m.default ?? m).catch(() => null)
    // Only usable if it exposes the classic transpileModule API.
    tsModule = mod?.transpileModule ? mod : null
  }
  if (!tsModule) return code
  return tsModule.transpileModule(code, { compilerOptions: { module: tsModule.ModuleKind.ESNext } }).outputText
}

function detectJsFunctionName(starterCode) {
  const fn = starterCode.match(/(?:export\s+)?function\s+(\w+)\s*\(/)
  if (fn) return fn[1]
  return starterCode.match(/(?:export\s+)?const\s+(\w+)\s*=/)?.[1] ?? null
}

async function runJs(exercise) {
  const stripped = stripExports(exercise.referenceSolution)
  const transpiled = await transpileIfTs(stripped, exercise.language)
  const funcName = detectJsFunctionName(exercise.starterCode) ?? detectJsFunctionName(exercise.referenceSolution)
  const results = []

  for (const test of exercise.tests) {
    const context = vm.createContext({})
    try {
      vm.runInContext(transpiled, context, { timeout: TEST_TIMEOUT_MS })
      context.__args = JSON.parse(test.input)
      const actual = vm.runInContext(`JSON.stringify(${funcName}(...__args))`, context, { timeout: TEST_TIMEOUT_MS })
      results.push(result(test.id, compare(actual, test.expected), actual, test.expected))
    } catch (err) {
      const timedOut = /timed out/i.test(err.message)
      results.push(result(test.id, false, '', test.expected, { stderr: timedOut ? 'timeout' : err.message }))
    }
  }
  return results
}

// -- sql (sql.js) -------------------------------------------------------------

let sqlJsModule = null
async function getSqlJs() {
  if (!sqlJsModule) sqlJsModule = await import('sql.js').then((m) => m.default()).then((SQL) => SQL)
  return sqlJsModule
}

function execFirstResultSet(db, query) {
  const res = db.exec(query)
  return res.length ? { columns: res[0].columns, values: res[0].values } : { columns: [], values: [] }
}

// Each test gets its own database, freshly loaded from fixture: the smoke
// fixture's "after: <DML>" tests each assume a clean slate, not the
// cumulative effect of earlier tests' "after" DML.
async function runSql(exercise, { schemaMode = false } = {}) {
  const SQL = await getSqlJs()
  const results = []

  for (const test of exercise.tests) {
    const db = new SQL.Database()
    try {
      if (exercise.fixture) db.run(exercise.fixture)
      if (schemaMode) db.run(exercise.referenceSolution)

      let input = test.input
      if (!schemaMode && input.includes('__STUDENT__')) {
        input = input.replace('__STUDENT__', exercise.referenceSolution.trim().replace(/;\s*$/, ''))
      }
      const afterMatch = input.match(/\/\*\s*after:\s*([\s\S]*?)\*\//)
      if (afterMatch) {
        db.run(afterMatch[1].trim())
        input = input.replace(afterMatch[0], '').trim()
      }
      const actualObj = execFirstResultSet(db, input)
      results.push(result(test.id, deepEqual(actualObj, JSON.parse(test.expected)), JSON.stringify(actualObj), test.expected))
    } catch (err) {
      results.push(result(test.id, false, '', test.expected, { stderr: err.message }))
    } finally {
      db.close()
    }
  }
  return results
}

// -- mongo (mingo) -------------------------------------------------------------

async function runMongo(exercise) {
  // Query/Aggregator come from the top-level package, not the mingo/query
  // and mingo/aggregator subpaths: only the top-level classes carry the
  // default operator set (comparison, logical, etc) pre-registered.
  const { Query, Aggregator } = await import('mingo')
  const { updateMany } = await import('mingo/updater')

  const fixtureDocs = JSON.parse(exercise.fixture)
  const fixtureHasId = fixtureDocs.some((d) => Object.hasOwn(d, '_id'))
  const results = []

  for (const test of exercise.tests) {
    try {
      const spec = JSON.parse(test.input)
      // The reference solution is a JSON string of the query objects the
      // student writes; if a test carries no args, verify against the
      // reference itself.
      const args = spec.args?.length ? spec.args : JSON.parse(exercise.referenceSolution)
      const docs = JSON.parse(JSON.stringify(fixtureDocs))
      let actualValue
      if (spec.op === 'find') actualValue = new Query(args[0]).find(docs, args[1]).all()
      else if (spec.op === 'aggregate') actualValue = new Aggregator(args[0]).run(docs)
      else if (spec.op === 'update') {
        updateMany(docs, args[0], args[1])
        actualValue = docs
      } else throw new Error(`unknown op: ${spec.op}`)

      if (!fixtureHasId && Array.isArray(actualValue)) {
        for (const doc of actualValue) if (doc && typeof doc === 'object') delete doc._id
      }
      results.push(result(test.id, deepEqual(actualValue, JSON.parse(test.expected)), JSON.stringify(actualValue), test.expected))
    } catch (err) {
      results.push(result(test.id, false, '', test.expected, { stderr: err.message }))
    }
  }
  return results
}

// -- web (jsdom) ----------------------------------------------------------------

async function runWeb(exercise) {
  const html = (exercise.fixture ?? '') + exercise.referenceSolution
  const results = []
  for (const test of exercise.tests) {
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    try {
      const actual = String(dom.window.eval(`(function(){ ${test.input} })()`))
      results.push(result(test.id, compare(actual, test.expected), actual, test.expected))
    } catch (err) {
      results.push(result(test.id, false, '', test.expected, { stderr: err.message }))
    } finally {
      dom.window.close()
    }
  }
  return results
}

// -- java (Judge0 CE) -------------------------------------------------------------

async function runJava(exercise) {
  const host = process.env.JUDGE0_HOST ?? 'judge0-ce.p.rapidapi.com'
  const results = []
  for (const test of exercise.tests) {
    try {
      const res = await fetch(`https://${host}/submissions?base64_encoded=false&wait=true`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-RapidAPI-Key': process.env.JUDGE0_API_KEY,
          'X-RapidAPI-Host': host,
        },
        body: JSON.stringify({
          language_id: 62,
          source_code: `${exercise.fixture}\n${normalizeJavaSolution(exercise.referenceSolution)}`,
          stdin: test.input,
          cpu_time_limit: 10,
          wall_time_limit: 15,
        }),
      })
      const body = await res.json()
      const actual = (body.stdout ?? '').trim()
      results.push(result(test.id, actual === test.expected.trim(), actual, test.expected, { stderr: body.stderr ?? body.compile_output ?? '' }))
    } catch (err) {
      results.push(result(test.id, false, '', test.expected, { stderr: err.message }))
    }
  }
  return results
}

// -- main -------------------------------------------------------------------------

function runExercise(exercise) {
  switch (exercise.language) {
    case 'python':
      return runPython(exercise)
    case 'javascript':
    case 'typescript':
      return runJs(exercise)
    case 'sql':
      return runSql(exercise, { schemaMode: exercise.kind === 'schema' })
    case 'mongo':
      return runMongo(exercise)
    case 'web':
      return runWeb(exercise)
    case 'java':
      return runJava(exercise)
    default:
      throw new Error(`unsupported language: ${exercise.language}`)
  }
}

function reportFailure(exercise, results) {
  const f = results.find((r) => !r.passed)
  const stderrPart = f.stderr ? ` stderr: ${truncate(f.stderr)}` : ''
  console.log(`FAIL: ${exercise.title} test ${f.id}: expected ${truncate(f.expected)} got ${truncate(f.actual)}${stderrPart}`)
}

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage: node scripts/verify-exercise.mjs <file.json> [file2.json ...]')
    process.exit(1)
  }

  let passed = 0
  let failed = 0
  let absent = 0
  let skipped = 0

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const exercise of data.exercises ?? []) {
      if (['predict-output', 'spot-the-bug', 'trace'].includes(exercise.kind)) {
        console.log(`skipped: ${exercise.title} (${exercise.kind})`)
        skipped++
        continue
      }
      if (exercise.language === 'java' && process.env.JUDGE_PROVIDER !== 'judge0' && !process.env.JUDGE0_API_KEY) {
        console.log(`absent: ${exercise.title} (no judge provider)`)
        absent++
        continue
      }

      let results
      try {
        results = await runExercise(exercise)
      } catch (err) {
        results = exercise.tests.map((t) => result(t.id, false, '', t.expected, { stderr: err.message }))
      }

      if (results.every((r) => r.passed)) {
        console.log(`ok: ${exercise.title} (${results.length}/${results.length})`)
        passed++
      } else {
        reportFailure(exercise, results)
        failed++
      }
    }
  }

  console.log(`${passed} passed, ${failed} failed, ${absent} absent, ${skipped} skipped`)
  process.exitCode = failed > 0 ? 1 : 0
}

main()
