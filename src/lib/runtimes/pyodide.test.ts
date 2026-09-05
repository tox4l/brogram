// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { loadPyodide } from 'pyodide'
import { PyodideAdapter } from './pyodide'
import { createPyodideEngine } from './pyodide-engine'
import { createEngineWorker } from './engine-worker.test-support'
import smoke from '../../../seed/exercises/smoke.json'
import type { RunRequest } from '@/lib/contracts'

let adapter: PyodideAdapter
beforeAll(async () => {
  const python = await loadPyodide()
  adapter = new PyodideAdapter(() => createEngineWorker(createPyodideEngine(async () => python)))
  await adapter.warmup()
}, 60000)

const req = (code: string, input: string, expected: string): RunRequest => ({ language: 'python', code, timeoutMs: 5000, tests: [{ id: 't', input, expected, hidden: false }] })
describe('Python runtime with installed offline Pyodide', () => {
  it('grades the smoke reference green through the adapter', async () => {
    const exercise = smoke.exercises.find(e => e.language === 'python')!
    const result = await adapter.run({ ...req(exercise.referenceSolution, '', ''), tests: exercise.tests })
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.passedCount).toBe(6)
  })
  it('compares parsed JSON, captures prints and reports wrong answers', async () => {
    const result = await adapter.run(req('def solve():\n print("called")\n return {"b": 2, "a": [1]}', '[]', '{"a":[1],"b":2}'))
    expect(result.results[0]).toMatchObject({ passed: true, stdout: 'called\n' })
    expect((await adapter.run(req('def solve():\n return 0', '[]', '1'))).results[0].failureKind).toBe('wrong-answer')
  })
  it('feeds stdin lines using the installed callback API', async () => {
    const result = await adapter.run(req('a = input()\nb = input()\nprint(a + " " + b)', 'hello\nworld', 'hello world'))
    expect(result.ok, JSON.stringify(result)).toBe(true)
  })
  it('isolates globals and reports exceptions with tracebacks', async () => {
    await adapter.run(req('secret = 7\ndef solve():\n return secret', '[]', '7'))
    const result = await adapter.run(req('def solve():\n return secret', '[]', '7'))
    expect(result.results[0]).toMatchObject({ passed: false, failureKind: 'runtime-error' })
    expect(result.results[0].stderr).toContain('NameError')
  })
  it('captures stdout in a free run without manufacturing a graded test', async () => {
    const result = await adapter.run({ ...req('print("hello")', '', ''), tests: [] })
    expect(result).toMatchObject({ ok: true, totalCount: 0, stdout: 'hello\n', results: [] })
  })
})
