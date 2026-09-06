// Exercises scripts/verify-lesson.mjs's success and failure paths end to end,
// via a real subprocess (the script is a CLI, not a library: it runs main()
// at import time against process.argv, so importing it directly here would
// steal vitest's own argv and process.exit). Fixtures are inline JS objects,
// materialized to a temp file per test -- nothing is written under seed/.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-lesson.mjs')
const tmpFiles = []

function writeFixture(name, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-lesson-test-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, JSON.stringify(data))
  tmpFiles.push(dir)
  return file
}

function run(...args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

afterEach(() => {
  for (const dir of tmpFiles.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

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
  it('exits 0 and reports ok for a lesson that passes every rule', () => {
    const file = writeFixture('valid.json', { course: 'TEST', lessons: [validLesson] })
    const { status, stdout } = run(file)
    expect(status).toBe(0)
    expect(stdout).toContain('ok: TEST-VALID-1')
  })

  it('verifies the real golden lesson unchanged (regression guard)', () => {
    const { status } = run('seed/lessons/INFS1101.json')
    expect(status).toBe(0)
  })

  it('exits non-zero and names the lesson and check id for a bad snippet stdout', () => {
    const file = writeFixture('invalid.json', { course: 'TEST', lessons: [invalidLesson] })
    const { status, stdout } = run(file)
    expect(status).not.toBe(0)
    expect(stdout).toContain('FAIL: TEST-INVALID-1 snippet-bad')
  })

  it('fails a predict-output check whose stdout does not match expected', () => {
    const file = writeFixture('invalid.json', { course: 'TEST', lessons: [invalidLesson] })
    const { stdout } = run(file)
    expect(stdout).toContain('FAIL: TEST-INVALID-1 check-predict-bad')
  })

  it('fails a spot-the-bug check whose bugLines fall outside the code', () => {
    const file = writeFixture('invalid.json', { course: 'TEST', lessons: [invalidLesson] })
    const { stdout } = run(file)
    expect(stdout).toContain('FAIL: TEST-INVALID-1 check-bug-bad')
    expect(stdout).toContain('outside the code')
  })

  it('fails a fill-blank check whose template markers do not match its blank ids', () => {
    const file = writeFixture('invalid.json', { course: 'TEST', lessons: [invalidLesson] })
    const { stdout } = run(file)
    expect(stdout).toContain('FAIL: TEST-INVALID-1 check-blank-bad')
    expect(stdout).toContain('do not match blank ids')
  })

  it('fails a choose check whose correctIndex is out of range', () => {
    const file = writeFixture('invalid.json', { course: 'TEST', lessons: [invalidLesson] })
    const { stdout } = run(file)
    expect(stdout).toContain('FAIL: TEST-INVALID-1 check-choose-bad')
  })

  it('fails a micro-code check whose referenceSolution does not pass its tests', () => {
    const file = writeFixture('invalid.json', { course: 'TEST', lessons: [invalidLesson] })
    const { stdout } = run(file)
    expect(stdout).toContain('FAIL: TEST-INVALID-1 check-micro-bad')
  })

  it('reports unverified for a Java lesson and still fails a Java snippet marked runnable', () => {
    const file = writeFixture('invalid-java.json', { course: 'TEST', lessons: [invalidJavaLesson] })
    const { status, stdout } = run(file)
    expect(status).not.toBe(0)
    expect(stdout).toContain('FAIL: TEST-INVALID-JAVA-1 snippet-java-bad')
    expect(stdout).toContain('runnable: false')
  })

  it('emits parseable json with --json', () => {
    const file = writeFixture('valid.json', { course: 'TEST', lessons: [validLesson] })
    const { status, stdout } = run(file, '--json')
    expect(status).toBe(0)
    const report = JSON.parse(stdout)
    expect(report.passed).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.files[0].lessons[0].id).toBe('TEST-VALID-1')
  })
})
