// Exercises scripts/verify-lesson.mjs's success and failure paths end to end,
// via real subprocesses (the script is a CLI, not a library: it runs main()
// at import time against process.argv, so importing it directly here would
// steal vitest's own argv and process.exit).
//
// Runtime-executing fixtures (anything the verifier hands to pyodide) are
// batched into ONE subprocess call each and shared across many assertions
// via beforeAll, instead of one spawn per assertion. pyodide's cold start is
// the expensive part of each spawn; under the full suite's parallel load
// (`npx vitest run` across 1250+ tests, or a concurrent `npm run build`
// contending for CPU) a dozen separate cold starts is what previously timed
// out three of these tests, even though the file passed in isolation. The
// Java-only fixture never touches pyodide at all, so it stays in its own
// fast, separately-timed hook rather than paying for the heavy fixtures'
// startup cost.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-lesson.mjs')

// Generous on purpose: pyodide's cold start alone can run several seconds,
// and a parallel `npm run build` or a large full-suite run can stretch that
// well past a default ~5s test timeout without the process having hung.
const HEAVY_HOOK_TIMEOUT_MS = 150_000
const HEAVY_SPAWN_TIMEOUT_MS = 55_000
// The Java fixture never starts a runtime, so it stays fast even under load.
const FAST_HOOK_TIMEOUT_MS = 20_000
const FAST_SPAWN_TIMEOUT_MS = 15_000

let tmpDir

function writeFixture(name, data) {
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, JSON.stringify(data))
  return file
}

// spawnSync's own `timeout` matters independently of vitest's hook/test
// timeout: spawnSync blocks the calling thread synchronously, so if the
// child genuinely hung, a timer-based test timeout could never get a chance
// to fire until spawnSync itself returns. Passing `timeout` here makes Node
// kill the child directly, which is what turns a hang into a clean,
// diagnosable assertion failure instead of a wedged worker.
function run(args, spawnTimeoutMs) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', timeout: spawnTimeoutMs })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', signal: result.signal }
}

const validLesson = {
  id: 'TEST-VALID-1',
  cloId: 'TEST-VALID-1',
  course: 'TEST',
  language: 'python',
  version: 1,
  title: 'valid fixture',
  hook: 'hook',
  estimatedMinutes: 5,
  draft: false,
  tags: [],
  exitLine: 'exit',
  blocks: [
    { type: 'snippet', id: 'snippet-1', language: 'python', code: 'print(2 + 2)', runnable: true, expectedStdout: '4\n' },
    { type: 'check', id: 'check-predict', kind: 'predict-output', prompt: 'p', language: 'python', code: "print('ok')", expected: 'ok', normalize: 'lines', hint: 'h', explain: 'e' },
    { type: 'check', id: 'check-bug', kind: 'spot-the-bug', prompt: 'p', language: 'python', code: 'a = 1\nb = 2\nc = a + b', bugLines: [2], hint: 'h', explain: 'e' },
    { type: 'check', id: 'check-blank', kind: 'fill-blank', prompt: 'p', language: 'python', template: 'x = __1__\nprint(x)', blanks: [{ id: '1', accept: ['5'] }], hint: 'h', explain: 'e' },
    { type: 'check', id: 'check-choose', kind: 'choose', prompt: 'p', options: ['a', 'b'], correctIndex: 1, why: ['w1', 'w2'], hint: 'h', explain: 'e' },
    {
      type: 'check', id: 'check-micro', kind: 'micro-code', prompt: 'p', language: 'python',
      starterCode: 'def add(a, b):\n    pass\n',
      tests: [{ id: 't1', input: '[2, 3]', expected: '5' }, { id: 't2', input: '[10, 1]', expected: '11' }],
      referenceSolution: 'def add(a, b):\n    return a + b\n',
      hint: 'h', explain: 'e',
    },
  ],
}

const invalidLesson = {
  id: 'TEST-INVALID-1',
  cloId: 'TEST-INVALID-1',
  course: 'TEST',
  language: 'python',
  version: 1,
  title: 'invalid fixture',
  hook: 'hook',
  estimatedMinutes: 5,
  draft: false,
  tags: [],
  exitLine: 'exit',
  blocks: [
    { type: 'snippet', id: 'snippet-bad', language: 'python', code: 'print(2 + 2)', runnable: true, expectedStdout: '5\n' },
    { type: 'check', id: 'check-predict-bad', kind: 'predict-output', prompt: 'p', language: 'python', code: 'print(10)', expected: '11', normalize: 'lines', hint: 'h', explain: 'e' },
    { type: 'check', id: 'check-bug-bad', kind: 'spot-the-bug', prompt: 'p', language: 'python', code: 'a = 1\nb = 2\nc = a + b', bugLines: [10], hint: 'h', explain: 'e' },
    { type: 'check', id: 'check-blank-bad', kind: 'fill-blank', prompt: 'p', language: 'python', template: 'x = __1__\nprint(x)', blanks: [{ id: '2', accept: ['5'] }], hint: 'h', explain: 'e' },
    { type: 'check', id: 'check-choose-bad', kind: 'choose', prompt: 'p', options: ['a', 'b'], correctIndex: 5, why: ['w1', 'w2'], hint: 'h', explain: 'e' },
    {
      type: 'check', id: 'check-micro-bad', kind: 'micro-code', prompt: 'p', language: 'python',
      starterCode: 'def add(a, b):\n    pass\n',
      tests: [{ id: 't1', input: '[2, 3]', expected: '5' }, { id: 't2', input: '[10, 1]', expected: '11' }],
      referenceSolution: 'def add(a, b):\n    return a - b\n',
      hint: 'h', explain: 'e',
    },
  ],
}

// `math` is stdlib, not a package pyodide needs to fetch, but
// loadPackagesFromImports still parses this import and must not throw or
// otherwise disturb execution -- it exercises the same call path a real
// numpy/pandas import (DSAI2201's lessons) takes, without paying for a
// slow real package load in the test suite.
const packageImportLesson = {
  id: 'TEST-VALID-PKG-1',
  cloId: 'TEST-VALID-PKG-1',
  course: 'TEST',
  language: 'python',
  version: 1,
  title: 'package import fixture',
  hook: 'hook',
  estimatedMinutes: 5,
  draft: false,
  tags: [],
  exitLine: 'exit',
  blocks: [
    { type: 'snippet', id: 'snippet-pkg', language: 'python', code: 'import math\nprint(math.floor(3.9))', runnable: true, expectedStdout: '3\n' },
  ],
}

const invalidJavaLesson = {
  id: 'TEST-INVALID-JAVA-1',
  cloId: 'TEST-INVALID-JAVA-1',
  course: 'TEST',
  language: 'java',
  version: 1,
  title: 'invalid java fixture',
  hook: 'hook',
  estimatedMinutes: 5,
  draft: false,
  tags: [],
  exitLine: 'exit',
  blocks: [
    { type: 'snippet', id: 'snippet-java-bad', language: 'java', code: 'System.out.println("hi");', runnable: true, expectedStdout: 'hi\n' },
  ],
}

describe('verify-lesson.mjs', () => {
  // One subprocess covers the golden lesson (regression guard) and a
  // synthetic all-passing lesson together, in --json mode, so every
  // "passing" assertion below reads the same already-captured result
  // instead of spawning again.
  let passingRun
  // One subprocess covers every failure kind in a single lesson.
  let invalidRun
  // Runs in its own hook: no pyodide involved, so it stays fast on its own.
  let invalidJavaRun

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-lesson-test-'))
    const validFile = writeFixture('valid.json', { course: 'TEST', lessons: [validLesson, packageImportLesson] })
    const invalidFile = writeFixture('invalid.json', { course: 'TEST', lessons: [invalidLesson] })

    passingRun = run(['seed/lessons/INFS1101.json', validFile, '--json'], HEAVY_SPAWN_TIMEOUT_MS)
    invalidRun = run([invalidFile], HEAVY_SPAWN_TIMEOUT_MS)
  }, HEAVY_HOOK_TIMEOUT_MS)

  beforeAll(() => {
    const invalidJavaFile = writeFixture('invalid-java.json', { course: 'TEST', lessons: [invalidJavaLesson] })
    invalidJavaRun = run([invalidJavaFile], FAST_SPAWN_TIMEOUT_MS)
  }, FAST_HOOK_TIMEOUT_MS)

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('lessons that pass every rule (one shared subprocess, --json)', () => {
    it('exits 0', () => {
      expect(passingRun.status).toBe(0)
    })

    // Pinned by lesson id, not array position or file-wide lesson count:
    // the golden file grows as more CLOs are authored, so a positional or
    // count-based assertion goes stale the moment content is added (as
    // happened here once INFS1101 grew from 1 lesson to 4).
    it('verifies the real golden lesson unchanged (regression guard)', () => {
      const report = JSON.parse(passingRun.stdout)
      const golden = report.files.find((f) => f.file === 'seed/lessons/INFS1101.json')
      const lesson = golden.lessons.find((l) => l.id === 'INFS1101-3')
      expect(lesson).toEqual({ id: 'INFS1101-3', unverified: false, failures: [] })
    })

    it('verifies a synthetic lesson exercising every check kind', () => {
      const report = JSON.parse(passingRun.stdout)
      const synthetic = report.files.find((f) => f.file.endsWith('valid.json'))
      const lesson = synthetic.lessons.find((l) => l.id === 'TEST-VALID-1')
      expect(lesson).toEqual({ id: 'TEST-VALID-1', unverified: false, failures: [] })
    })

    it('verifies a lesson snippet that imports a package via loadPackagesFromImports', () => {
      const report = JSON.parse(passingRun.stdout)
      const synthetic = report.files.find((f) => f.file.endsWith('valid.json'))
      const lesson = synthetic.lessons.find((l) => l.id === 'TEST-VALID-PKG-1')
      expect(lesson).toEqual({ id: 'TEST-VALID-PKG-1', unverified: false, failures: [] })
    })

    // Computed from the files' own lesson counts, not a hardcoded total, so
    // this does not go stale the next time content is added to either file.
    it('totals passed equal to the combined lesson count across both files, with none failed or unverified', () => {
      const report = JSON.parse(passingRun.stdout)
      const totalLessons = report.files.reduce((sum, f) => sum + f.lessons.length, 0)
      expect(report.passed).toBe(totalLessons)
      expect(report.failed).toBe(0)
      expect(report.unverified).toBe(0)
    })
  })

  describe('a lesson that fails every rule (one shared subprocess)', () => {
    it('exits non-zero', () => {
      expect(invalidRun.status).not.toBe(0)
    })

    it('fails the snippet whose stdout does not match expectedStdout', () => {
      expect(invalidRun.stdout).toContain('FAIL: TEST-INVALID-1 snippet-bad')
    })

    it('fails the predict-output check whose stdout does not match expected', () => {
      expect(invalidRun.stdout).toContain('FAIL: TEST-INVALID-1 check-predict-bad')
    })

    it('fails the spot-the-bug check whose bugLines fall outside the code', () => {
      expect(invalidRun.stdout).toContain('FAIL: TEST-INVALID-1 check-bug-bad')
      expect(invalidRun.stdout).toContain('outside the code')
    })

    it('fails the fill-blank check whose template markers do not match its blank ids', () => {
      expect(invalidRun.stdout).toContain('FAIL: TEST-INVALID-1 check-blank-bad')
      expect(invalidRun.stdout).toContain('do not match blank ids')
    })

    it('fails the choose check whose correctIndex is out of range', () => {
      expect(invalidRun.stdout).toContain('FAIL: TEST-INVALID-1 check-choose-bad')
    })

    it('fails the micro-code check whose referenceSolution does not pass its tests', () => {
      expect(invalidRun.stdout).toContain('FAIL: TEST-INVALID-1 check-micro-bad')
    })
  })

  describe('Java lessons (fast: no runtime is ever invoked)', () => {
    it('reports unverified and still fails a Java snippet incorrectly marked runnable', () => {
      expect(invalidJavaRun.status).not.toBe(0)
      expect(invalidJavaRun.stdout).toContain('FAIL: TEST-INVALID-JAVA-1 snippet-java-bad')
      expect(invalidJavaRun.stdout).toContain('runnable: false')
    })
  })
})
