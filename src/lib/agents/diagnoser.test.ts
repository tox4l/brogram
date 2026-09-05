import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { DiagnoserRequest, TestResult } from '@/lib/contracts'
import { diagnoser } from './diagnoser'

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/diagnoser/${name}.json`, 'utf8'))

const result = (over: Partial<TestResult> = {}): TestResult => ({
  testId: 't1',
  passed: false,
  actual: '-1',
  expected: '9',
  stdout: '',
  stderr: '',
  durationMs: 3,
  failureKind: 'wrong-answer',
  ...over,
})

const req = (over: Partial<DiagnoserRequest> = {}): DiagnoserRequest => ({
  agent: 'diagnoser',
  trigger: 'attempt-failed',
  state: { userId: 'u1', version: 11 },
  exercise: { id: 'ex_1', cloId: 'INFS1101-3', pattern: 'early-return', prompt: 'Find the first late train.', language: 'python', kind: 'code' },
  code: 'def first_late(times, limit):\n    return -1\n',
  results: [result()],
  ...over,
})

describe('diagnoser module', () => {
  it('streams and names json in a static system prompt', () => {
    expect(diagnoser.system.toLowerCase()).toContain('json')
    expect(diagnoser.streams).toBe(true)
    expect(diagnoser.temperature).toBe(0.6)
  })

  it('accepts the valid fixture', () => {
    expect(diagnoser.schema.parse(fixture('valid')).fixPlan).toHaveLength(4)
  })

  it('rejects the invalid fixtures', () => {
    expect(() => diagnoser.schema.parse(fixture('invalid-code-in-plan'))).toThrow()
    expect(() => diagnoser.schema.parse(fixture('invalid-last-step'))).toThrow()
    expect(() => diagnoser.schema.parse(fixture('invalid-intent-prefix'))).toThrow()
    expect(() => diagnoser.schema.parse(fixture('invalid-label-uppercase'))).toThrow()
  })

  it('rejects a fix plan that tells the student to simply do it', () => {
    const reply = diagnoser.schema.parse(fixture('valid'))
    const lazy = { ...reply, fixPlan: [...reply.fixPlan.slice(0, -1), 'Simply move the return out of the loop body.', reply.fixPlan.at(-1)!] }
    expect(() => diagnoser.schema.parse(lazy)).toThrow()
  })

  it('slices tone, verbosity and the last five mistake labels', () => {
    const recentMistakes = Array.from({ length: 8 }, (_, i) => ({ exerciseId: `e${i}`, cloId: 'c', pattern: 'p', label: `label ${i}`, at: 'now' }))
    const slice = diagnoser.slice({ userId: 'u1', version: 11, profile: { tone: 'supportive', verbosity: 'verbose', displayName: 'Sam' } as never, recentMistakes, points: 3 })
    expect(Object.keys(slice).sort()).toEqual(['profile', 'recentMistakes'])
    expect(slice.profile).toEqual({ tone: 'supportive', verbosity: 'verbose' })
    expect(slice.recentMistakes).toEqual(['label 0', 'label 1', 'label 2', 'label 3', 'label 4'])
  })

  it('adds the server-hydrated tests and reference solution to the payload', () => {
    const payload = diagnoser.payload(req(), { tests: [{ id: 't1', input: '[]', expected: '-1', hidden: true }], referenceSolution: 'ref' })
    expect(payload.exercise).toEqual(req().exercise)
    expect(payload.code).toBe(req().code)
    expect(payload.results).toEqual(req().results)
    expect(payload.tests).toEqual([{ id: 't1', input: '[]', expected: '-1', hidden: true }])
    expect(payload.referenceSolution).toBe('ref')
  })

  it('falls back to a schema-valid generic diagnosis', () => {
    const reply = diagnoser.fallback!(req())
    expect(reply.mistakeLabel).toBe('unclassified')
    expect(reply.fixPlan.at(-1)).toBe('Run the visible examples before you submit again.')
    expect(() => diagnoser.schema.parse(reply)).not.toThrow()
  })
})
