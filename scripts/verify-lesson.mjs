#!/usr/bin/env node
// Verifies BroGram lesson files: seed/lessons/<COURSE>.json and
// seed/lessons/by-clo/<cloId>.json (both hold { course, lessons: Lesson[] },
// see seed/lessons/lesson.schema.json). Sibling of scripts/verify-exercise.mjs
// and deliberately self-contained: verify-exercise.mjs is not owned by this
// task and none of its runner functions are exported, so the engines below
// are re-implemented against the same libraries (pyodide, node:vm, sql.js,
// mingo, jsdom) rather than imported, and verify-exercise.mjs's behaviour is
// untouched. See docs/prompts/agents/08-lesson-author.md for the authoring
// side of every convention referenced here.
//
// Per lesson, per spec section 3.6 and the T1.1 brief:
//   1. every `snippet` block with runnable:true is executed and its stdout
//      must equal `expectedStdout` exactly.
//   2. every `predict-output` check's `code` is executed and its stdout must
//      equal `expected` under the declared `normalize` ('lines': per-line
//      trim + collapse internal whitespace + drop trailing blank lines,
//      mirroring src/components/derot/scoring.ts normalizeOutput; 'exact':
//      strict string equality).
//   3. every `micro-code` check's `referenceSolution` is run against its
//      tests (2-3, all visible) and every test must pass.
//   4. every `spot-the-bug` check's `bugLines` are checked structurally
//      against the code's own line count (no execution: a bug line is a
//      location, not something the runtime can confirm is "buggy").
//   5. every `fill-blank` template's __N__ markers must match the blank ids
//      1:1, and filling the template with each blank's accept[0] must
//      produce code that parses in the declared language.
// Java lessons are never executed here (no in-process JVM) and report
// "unverified"; a Java `snippet` with runnable !== false is a hard failure
// (spec R3.4 / lesson.schema.json x-invariants.javaSnippetsNotRunnable).
//
// A LessonCheck (unlike an Exercise) carries no separate `fixture` field, so
// for any language whose exercise-equivalent needs one (web, sql, mongo) a
// `micro-code` check's `referenceSolution` must be fully self-contained --
// see docs/prompts/agents/08-lesson-author.md "Output" section for the exact
// per-language convention this verifier assumes:
//   web:   referenceSolution is the whole page (HTML shell + completed
//          script); a test's `input` is a function body run against that
//          page and `expected` is "ok" (identical to the exercise convention).
//   sql:   referenceSolution is one or more ';'-separated statements that
//          build their own tiny fixture, ending with the answer query as the
//          final statement; a test's `input` is a literal query or the token
//          __STUDENT__ (substituted with that final statement); `expected`
//          is JSON {"columns":[...],"values":[[...]]}.
//   mongo: referenceSolution is JSON {"fixture":[...docs],"args":[...]}; a
//          test's `input` is JSON {"op":"find"|"aggregate"|"update","args":[...]}
//          (its own args override the reference's); `expected` is the
//          JSON-serialized result.
//
// Usage: node scripts/verify-lesson.mjs <file.json> [file2.json ...] [--json]
// Exit code: 0 if no check failed anywhere (unverified Java lessons do not
// count as a failure); 1 otherwise. Failures are printed with the lesson id
// and the failing block/check id.

import fs from 'node:fs'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const TEST_TIMEOUT_MS = 10_000

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

/** Exact-string match, else parsed-JSON deep equality (mirrors verify-exercise.mjs). */
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

/** mirrors src/components/derot/scoring.ts normalizeOutput exactly (read-only reference; not imported). */
function normalizeOutput(value) {
  const lines = String(value ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}

function fail(out, lessonId, checkId, reason) {
  out.push({ lessonId, checkId, reason })
}

// -- python (pyodide) --------------------------------------------------------

let pyodideInstance = null
async function getPyodide() {
  if (!pyodideInstance) {
    const { loadPyodide } = await import('pyodide')
    pyodideInstance = await loadPyodide()
  }
  return pyodideInstance
}

async function capturePythonStdout(code) {
  const pyodide = await getPyodide()
  await pyodide.loadPackagesFromImports(code)
  const chunks = []
  pyodide.setStdout({ batched: (s) => chunks.push(s) })
  pyodide.setStderr({ batched: () => {} })
  const globals = pyodide.toPy({})
  try {
    await withTimeout(Promise.resolve(pyodide.runPython(code, { globals })), TEST_TIMEOUT_MS)
    return chunks.length ? chunks.join('\n') + '\n' : ''
  } finally {
    globals.destroy()
  }
}

function detectPyFunctionName(starterCode, referenceSolution) {
  const m = (starterCode ?? '').match(/def\s+(\w+)\s*\(/)
  if (m) return m[1]
  const all = [...referenceSolution.matchAll(/def\s+(\w+)\s*\(/g)]
  return all.length ? all.at(-1)[1] : null
}

async function runPythonMicroCodeTests(check) {
  const pyodide = await getPyodide()
  await pyodide.loadPackagesFromImports(check.referenceSolution)
  const funcName = detectPyFunctionName(check.starterCode, check.referenceSolution)
  const results = []
  for (const test of check.tests) {
    const globals = pyodide.toPy({})
    try {
      pyodide.setStdout({ batched: () => {} })
      pyodide.setStderr({ batched: () => {} })
      await withTimeout(
        (async () => {
          pyodide.runPython(check.referenceSolution, { globals })
          const code = [
            'import json',
            `__args = json.loads(${JSON.stringify(test.input)})`,
            `__result = ${funcName}(*__args)`,
            '__out = json.dumps(__result, default=str)',
          ].join('\n')
          pyodide.runPython(code, { globals })
          const actual = globals.get('__out')
          results.push({ id: test.id, passed: compare(actual, test.expected), actual, expected: test.expected })
        })(),
        TEST_TIMEOUT_MS,
      )
    } catch (err) {
      results.push({ id: test.id, passed: false, actual: '', expected: test.expected, error: err.message })
    } finally {
      globals.destroy()
    }
  }
  return results
}

async function pythonParses(code) {
  try {
    const pyodide = await getPyodide()
    pyodide.runPython(`compile(${JSON.stringify(code)}, '<fill-blank>', 'exec')`)
    return true
  } catch {
    return false
  }
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
    tsModule = mod?.transpileModule ? mod : null
  }
  if (!tsModule) return code
  return tsModule.transpileModule(code, { compilerOptions: { module: tsModule.ModuleKind.ESNext } }).outputText
}

function detectJsFunctionName(starterCode) {
  const fn = (starterCode ?? '').match(/(?:export\s+)?function\s+(\w+)\s*\(/)
  if (fn) return fn[1]
  return (starterCode ?? '').match(/(?:export\s+)?const\s+(\w+)\s*=/)?.[1] ?? null
}

async function captureJsStdout(code, language) {
  const lines = []
  const context = vm.createContext({ console: { log: (...args) => lines.push(args.map(String).join(' ')) } })
  const transpiled = await transpileIfTs(code, language)
  vm.runInContext(transpiled, context, { timeout: TEST_TIMEOUT_MS })
  return lines.length ? lines.join('\n') + '\n' : ''
}

async function runJsMicroCodeTests(check) {
  const stripped = stripExports(check.referenceSolution)
  const transpiled = await transpileIfTs(stripped, check.language)
  const funcName = detectJsFunctionName(check.starterCode) ?? detectJsFunctionName(check.referenceSolution)
  const results = []
  for (const test of check.tests) {
    const context = vm.createContext({})
    try {
      vm.runInContext(transpiled, context, { timeout: TEST_TIMEOUT_MS })
      context.__args = JSON.parse(test.input)
      const actual = vm.runInContext(`JSON.stringify(${funcName}(...__args))`, context, { timeout: TEST_TIMEOUT_MS })
      results.push({ id: test.id, passed: compare(actual, test.expected), actual, expected: test.expected })
    } catch (err) {
      results.push({ id: test.id, passed: false, actual: '', expected: test.expected, error: err.message })
    }
  }
  return results
}

function jsParses(code) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(code)
    return true
  } catch {
    return false
  }
}

// -- web (jsdom) ---------------------------------------------------------------

function captureWebStdout(code) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously' })
  const lines = []
  dom.window.console.log = (...args) => lines.push(args.map(String).join(' '))
  let out = ''
  try {
    dom.window.eval(code)
    out = lines.length ? lines.join('\n') + '\n' : ''
  } finally {
    dom.window.close()
  }
  return out
}

function runWebMicroCodeTests(check) {
  const results = []
  for (const test of check.tests) {
    const dom = new JSDOM(check.referenceSolution, { runScripts: 'dangerously' })
    try {
      const actual = String(dom.window.eval(`(function(){ ${test.input} })()`))
      results.push({ id: test.id, passed: compare(actual, test.expected), actual, expected: test.expected })
    } catch (err) {
      results.push({ id: test.id, passed: false, actual: '', expected: test.expected, error: err.message })
    } finally {
      dom.window.close()
    }
  }
  return results
}

// -- sql (sql.js) ---------------------------------------------------------------

let sqlJsModule = null
async function getSqlJs() {
  if (!sqlJsModule) sqlJsModule = await import('sql.js').then((m) => m.default()).then((SQL) => SQL)
  return sqlJsModule
}

function execFirstResultSet(db, query) {
  const res = db.exec(query)
  return res.length ? { columns: res[0].columns, values: res[0].values } : { columns: [], values: [] }
}

function splitSqlStatements(script) {
  return script
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function captureSqlStdout(code) {
  const SQL = await getSqlJs()
  const db = new SQL.Database()
  try {
    const statements = splitSqlStatements(code)
    const last = statements.pop()
    for (const stmt of statements) db.run(stmt + ';')
    if (!last) return ''
    const res = db.exec(last)
    if (!res.length) return ''
    return res[0].values.map((row) => row.join(', ')).join('\n') + '\n'
  } finally {
    db.close()
  }
}

async function runSqlMicroCodeTests(check) {
  const SQL = await getSqlJs()
  const statements = splitSqlStatements(check.referenceSolution)
  const answerStmt = statements.pop() ?? ''
  const fixtureSql = statements.map((s) => s + ';').join('\n')
  const results = []
  for (const test of check.tests) {
    const db = new SQL.Database()
    try {
      if (fixtureSql) db.run(fixtureSql)
      const input = test.input.includes('__STUDENT__') ? test.input.replace('__STUDENT__', answerStmt) : test.input
      const actualObj = execFirstResultSet(db, input)
      results.push({ id: test.id, passed: deepEqual(actualObj, JSON.parse(test.expected)), actual: JSON.stringify(actualObj), expected: test.expected })
    } catch (err) {
      results.push({ id: test.id, passed: false, actual: '', expected: test.expected, error: err.message })
    } finally {
      db.close()
    }
  }
  return results
}

async function sqlParses(code) {
  try {
    const SQL = await getSqlJs()
    const db = new SQL.Database()
    try {
      db.run(code)
      return true
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

// -- mongo (mingo) ---------------------------------------------------------------

async function captureMongoStdout(code) {
  const { Query, Aggregator } = await import('mingo')
  const { updateMany } = await import('mingo/updater')
  const spec = JSON.parse(code)
  const docs = JSON.parse(JSON.stringify(spec.fixture ?? []))
  let actualValue
  if (spec.op === 'find') actualValue = new Query(spec.args[0]).find(docs, spec.args[1]).all()
  else if (spec.op === 'aggregate') actualValue = new Aggregator(spec.args[0]).run(docs)
  else if (spec.op === 'update') {
    updateMany(docs, spec.args[0], spec.args[1])
    actualValue = docs
  } else throw new Error(`unknown op: ${spec.op}`)
  return JSON.stringify(actualValue) + '\n'
}

async function runMongoMicroCodeTests(check) {
  const { Query, Aggregator } = await import('mingo')
  const { updateMany } = await import('mingo/updater')
  const ref = JSON.parse(check.referenceSolution)
  const results = []
  for (const test of check.tests) {
    try {
      const spec = JSON.parse(test.input)
      const args = spec.args?.length ? spec.args : ref.args
      const docs = JSON.parse(JSON.stringify(ref.fixture ?? []))
      let actualValue
      if (spec.op === 'find') actualValue = new Query(args[0]).find(docs, args[1]).all()
      else if (spec.op === 'aggregate') actualValue = new Aggregator(args[0]).run(docs)
      else if (spec.op === 'update') {
        updateMany(docs, args[0], args[1])
        actualValue = docs
      } else throw new Error(`unknown op: ${spec.op}`)
      results.push({ id: test.id, passed: deepEqual(actualValue, JSON.parse(test.expected)), actual: JSON.stringify(actualValue), expected: test.expected })
    } catch (err) {
      results.push({ id: test.id, passed: false, actual: '', expected: test.expected, error: err.message })
    }
  }
  return results
}

function mongoParses(code) {
  try {
    JSON.parse(code)
    return true
  } catch {
    return false
  }
}

// -- dispatch -------------------------------------------------------------------

async function captureStdout(language, code) {
  switch (language) {
    case 'python':
      return capturePythonStdout(code)
    case 'javascript':
    case 'typescript':
      return captureJsStdout(code, language)
    case 'web':
      return captureWebStdout(code)
    case 'sql':
      return captureSqlStdout(code)
    case 'mongo':
      return captureMongoStdout(code)
    default:
      throw new Error(`unsupported language for stdout capture: ${language}`)
  }
}

async function runMicroCodeTests(check) {
  switch (check.language) {
    case 'python':
      return runPythonMicroCodeTests(check)
    case 'javascript':
    case 'typescript':
      return runJsMicroCodeTests(check)
    case 'web':
      return runWebMicroCodeTests(check)
    case 'sql':
      return runSqlMicroCodeTests(check)
    case 'mongo':
      return runMongoMicroCodeTests(check)
    default:
      throw new Error(`unsupported language for micro-code: ${check.language}`)
  }
}

async function codeParses(code, language) {
  switch (language) {
    case 'python':
      return pythonParses(code)
    case 'javascript':
    case 'web':
      return jsParses(code)
    case 'typescript':
      return jsParses(await transpileIfTs(code, 'typescript'))
    case 'sql':
      return sqlParses(code)
    case 'mongo':
      return mongoParses(code)
    default:
      return true // java: never executed here, structural checks only.
  }
}

// -- per-block / per-check verification ------------------------------------------

async function verifySnippet(lesson, block, failures) {
  if (block.language === 'java') {
    if (block.runnable !== false) fail(failures, lesson.id, block.id, 'a Java snippet must have runnable: false')
    return
  }
  if (block.runnable !== true) return
  try {
    const actual = await captureStdout(block.language, block.code)
    if (actual !== block.expectedStdout) {
      fail(failures, lesson.id, block.id, `stdout mismatch: expected ${truncate(JSON.stringify(block.expectedStdout))} got ${truncate(JSON.stringify(actual))}`)
    }
  } catch (err) {
    fail(failures, lesson.id, block.id, `snippet execution error: ${err.message}`)
  }
}

async function verifyPredictOutput(lesson, check, failures) {
  try {
    const actual = await captureStdout(check.language, check.code)
    const ok = check.normalize === 'exact' ? actual === check.expected : normalizeOutput(actual) === normalizeOutput(check.expected)
    if (!ok) {
      fail(failures, lesson.id, check.id, `predict-output mismatch (${check.normalize}): expected ${truncate(JSON.stringify(check.expected))} got ${truncate(JSON.stringify(actual))}`)
    }
  } catch (err) {
    fail(failures, lesson.id, check.id, `predict-output execution error: ${err.message}`)
  }
}

async function verifyMicroCode(lesson, check, failures) {
  try {
    const results = await runMicroCodeTests(check)
    const bad = results.filter((r) => !r.passed)
    for (const r of bad) {
      fail(failures, lesson.id, check.id, `test ${r.id} failed: expected ${truncate(r.expected)} got ${truncate(r.actual)}${r.error ? ` (${truncate(r.error)})` : ''}`)
    }
  } catch (err) {
    fail(failures, lesson.id, check.id, `micro-code execution error: ${err.message}`)
  }
}

function verifySpotTheBug(lesson, check, failures) {
  const lineCount = check.code.split('\n').length
  for (const line of check.bugLines) {
    if (!(line >= 1 && line <= lineCount)) {
      fail(failures, lesson.id, check.id, `bugLines contains ${line}, outside the code's ${lineCount} lines`)
    }
  }
}

async function verifyFillBlank(lesson, check, failures) {
  const markerIds = [...check.template.matchAll(/__([^_]+)__/g)].map((m) => m[1])
  const blankIds = check.blanks.map((b) => b.id)
  const markerSet = new Set(markerIds)
  const blankSet = new Set(blankIds)
  const sameSize = markerSet.size === blankSet.size
  const sameMembers = sameSize && [...markerSet].every((id) => blankSet.has(id))
  if (!sameMembers || markerIds.length !== blankIds.length) {
    fail(failures, lesson.id, check.id, `template markers ${JSON.stringify(markerIds)} do not match blank ids ${JSON.stringify(blankIds)}`)
    return
  }
  let filled = check.template
  for (const blank of check.blanks) {
    filled = filled.replace(new RegExp(`__${blank.id}__`, 'g'), blank.accept[0])
  }
  try {
    const ok = await codeParses(filled, check.language)
    if (!ok) fail(failures, lesson.id, check.id, `filling the template with accept[0] does not parse as ${check.language}`)
  } catch (err) {
    fail(failures, lesson.id, check.id, `fill-blank parse error: ${err.message}`)
  }
}

function verifyChoose(lesson, check, failures) {
  if (!(check.correctIndex >= 0 && check.correctIndex < check.options.length)) {
    fail(failures, lesson.id, check.id, `correctIndex ${check.correctIndex} out of range for ${check.options.length} options`)
  }
}

async function verifyLesson(lesson, failures) {
  if (lesson.language === 'java') {
    for (const block of lesson.blocks) {
      if (block.type === 'snippet' && block.runnable !== false) {
        fail(failures, lesson.id, block.id, 'a Java snippet must have runnable: false')
      }
    }
    return { unverified: true }
  }

  for (const block of lesson.blocks) {
    if (block.type === 'snippet') {
      await verifySnippet(lesson, block, failures)
      continue
    }
    if (block.type !== 'check') continue
    switch (block.kind) {
      case 'predict-output':
        await verifyPredictOutput(lesson, block, failures)
        break
      case 'micro-code':
        await verifyMicroCode(lesson, block, failures)
        break
      case 'spot-the-bug':
        verifySpotTheBug(lesson, block, failures)
        break
      case 'fill-blank':
        await verifyFillBlank(lesson, block, failures)
        break
      case 'choose':
        verifyChoose(lesson, block, failures)
        break
      default:
        fail(failures, lesson.id, block.id, `unknown check kind: ${block.kind}`)
    }
  }
  return { unverified: false }
}

// -- main -------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const jsonOutput = argv.includes('--json')
  const files = argv.filter((a) => a !== '--json')
  if (files.length === 0) {
    console.error('usage: node scripts/verify-lesson.mjs <file.json> [file2.json ...] [--json]')
    process.exit(1)
  }

  const fileReports = []
  let passed = 0
  let failed = 0
  let unverified = 0

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const lessonReports = []
    for (const lesson of data.lessons ?? []) {
      const failures = []
      let status
      try {
        status = await verifyLesson(lesson, failures)
      } catch (err) {
        failures.push({ lessonId: lesson.id, checkId: '(lesson)', reason: `unexpected error: ${err.message}` })
        status = { unverified: false }
      }

      lessonReports.push({ id: lesson.id, unverified: status.unverified, failures })

      if (failures.length) {
        failed++
        if (!jsonOutput) {
          for (const f of failures) console.log(`FAIL: ${f.lessonId} ${f.checkId}: ${f.reason}`)
        }
      } else if (status.unverified) {
        unverified++
        if (!jsonOutput) console.log(`unverified: ${lesson.id} (java)`)
      } else {
        passed++
        if (!jsonOutput) console.log(`ok: ${lesson.id}`)
      }
    }
    fileReports.push({ file, lessons: lessonReports })
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ files: fileReports, passed, failed, unverified }))
  } else {
    console.log(`${passed} passed, ${failed} failed, ${unverified} unverified`)
  }
  process.exitCode = failed > 0 ? 1 : 0
}

main()
