// @vitest-environment node
import { describe, expect, it } from 'vitest'
import smoke from '../../../seed/exercises/smoke.json'
import type { RunRequest } from '../contracts'
import { createEngineWorker } from './engine-worker.test-support'
import { JsAdapter } from './js'
import { createJsEngine } from './js-engine'

function adapter(language: 'javascript' | 'typescript' = 'javascript') {
  return new JsAdapter(language, () => createEngineWorker(createJsEngine(language)))
}

function request(code: string, input = '[2]', expected = '4', language: RunRequest['language'] = 'javascript'): RunRequest {
  return { language, code, timeoutMs: 5000, tests: [{ id: 'golden', input, expected, hidden: false }] }
}

describe('JavaScript and TypeScript runtime', () => {
  it('grades the JavaScript smoke reference through the worker adapter', async () => {
    const exercise = smoke.exercises.find((item) => item.language === 'javascript')!
    const result = await adapter().run({ language: 'javascript', code: exercise.referenceSolution, tests: exercise.tests, timeoutMs: 5000 })
    expect(result.ok).toBe(true)
    expect(result.passedCount).toBe(6)
  })

  it('transpiles typed exported functions before grading their return value', async () => {
    const result = await adapter('typescript').run(request('export function double(n: number): number { return n * 2 }', '[3]', '6', 'typescript'))
    expect(result.results[0]).toMatchObject({ passed: true, actual: '6' })
  })

  it('awaits an exported arrow function and compares objects regardless of property order', async () => {
    const result = await adapter().run(request('export const double = async n => ({ b: n, a: n * 2 });', '[2]', '{"a":4,"b":2}'))
    expect(result.results[0].passed).toBe(true)
  })

  it('preserves export syntax inside strings and ignores function-like comments', async () => {
    const result = await adapter().run(request('// function wrong(n) {}\nfunction describe() { return "export function demo"; }\nexport { describe };', '[]', '"export function demo"'))
    expect(result.results[0]).toMatchObject({ passed: true, actual: '"export function demo"' })
  })

  it('isolates lexical state for each test and captures console output', async () => {
    const req = request('let count = 0; export function next(n) { console.log("value", n); return ++count; }', '[2]', '1')
    req.tests.push({ id: 'second', input: '[9]', expected: '1', hidden: true })
    const result = await adapter().run(req)
    expect(result.passedCount).toBe(2)
    expect(result.results.map((test) => test.stdout)).toEqual(['value 2', 'value 9'])
  })

  it('returns console output for a free run', async () => {
    const result = await adapter().run({ language: 'javascript', code: 'console.log("hello"); console.error("diagnostic");', tests: [], timeoutMs: 5000 })
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('diagnostic')
  })

  it.each([
    ['export function double(n) { return n + 2; }', '[3]', 'wrong-answer'],
    ['export function double(n) { throw new Error("bad input"); }', '[2]', 'runtime-error'],
    ['export function double( {', '[2]', 'compile-error'],
  ])('reports a useful failure for %s', async (code, input, failureKind) => {
    const result = await adapter().run(request(code, input))
    expect(result.results[0]).toMatchObject({ passed: false, failureKind })
  })
})
