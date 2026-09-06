import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { AuthorRequest } from '@/lib/contracts'
import { author, type AuthorRouteRequest } from './author'

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/author/${name}.json`, 'utf8'))

const req = (over: Partial<AuthorRouteRequest> = {}): AuthorRouteRequest => ({
  agent: 'author',
  trigger: 'bank-miss',
  state: { userId: 'u1', version: 7 },
  clo: {
    id: 'INFS1101-3',
    course: 'INFS1101',
    ordinal: 3,
    outcome: 'Stop a scan as soon as the answer is known',
    topics: ['loops'],
    prerequisites: [],
    patterns: ['early-return'],
    assessableInCode: true,
  },
  language: 'python',
  kind: 'code',
  difficulty: 3,
  pattern: 'early-return',
  exampleIds: ['bank_1'],
  ...over,
}) as AuthorRouteRequest

describe('author module', () => {
  it('has a static system prompt that names json and the widest token budget', () => {
    expect(author.system.toLowerCase()).toContain('json')
    expect(author.streams).toBe(false)
    expect(author.temperature).toBe(0.3)
    expect(author.maxTokens).toBe(4000)
  })

  it('has no fallback, because a wrong exercise is worse than none', () => {
    expect(author.fallback).toBeUndefined()
  })

  it('accepts the valid fixtures for python, sql and web', () => {
    expect(author.schema.parse(fixture('valid-python')).exercise.language).toBe('python')
    expect(author.schema.parse(fixture('valid-sql')).exercise.fixture).toContain('create table')
    expect(author.schema.parse(fixture('valid-web')).exercise.language).toBe('web')
  })

  it('rejects the schema-invalid fixtures', () => {
    expect(() => author.schema.parse(fixture('invalid-four-tests'))).toThrow()
    expect(() => author.schema.parse(fixture('invalid-one-visible'))).toThrow()
    expect(() => author.schema.parse(fixture('invalid-title-long'))).toThrow()
    expect(() => author.schema.parse(fixture('invalid-difficulty-3.5'))).toThrow()
  })

  it('takes exactly one visible test for a kind the screen grades by typed answer', () => {
    const reply = author.schema.parse(fixture('valid-predict-output'))
    expect(reply.exercise.tests).toHaveLength(1)
    expect(reply.exercise.tests[0].hidden).toBe(false)
    expect(reply.exercise.tests[0].expected).toBe('13')
  })

  it('rejects a reading exercise carrying a battery of tests the screen cannot grade', () => {
    expect(() => author.schema.parse(fixture('invalid-predict-output-five-tests'))).toThrow()
  })

  it('rejects a reading exercise whose one answer is hidden', () => {
    const reply = fixture('valid-predict-output')
    reply.exercise.tests[0].hidden = true
    expect(() => author.schema.parse(reply)).toThrow()
  })

  it('applies the single-answer rule to every kind the screen reads, and no other', () => {
    const one = fixture('valid-predict-output')
    for (const kind of ['spot-the-bug', 'trace']) {
      expect(() => author.schema.parse({ exercise: { ...one.exercise, kind } }), kind).not.toThrow()
    }
    for (const kind of ['code', 'schema']) {
      expect(() => author.schema.parse({ exercise: { ...one.exercise, kind } }), kind).toThrow()
    }
  })

  it('still demands a full battery for a code exercise', () => {
    const python = fixture('valid-python')
    expect(() => author.schema.parse({ exercise: { ...python.exercise, tests: python.exercise.tests.slice(0, 1) } })).toThrow()
    expect(() => author.schema.parse({ exercise: { ...python.exercise, kind: 'schema' } })).not.toThrow()
  })

  it('passes a matching exercise through the route check', () => {
    expect(author.routeCheck!(req(), author.schema.parse(fixture('valid-python')))).toBeNull()
  })

  it('rejects an exercise that drifted off the requested slot', () => {
    const reply = author.schema.parse(fixture('valid-python'))
    expect(author.routeCheck!(req({ clo: { ...req().clo, id: 'INFS1101-9' } }), reply)).toMatch(/cloId/)
    expect(author.routeCheck!(req({ difficulty: 4 }), reply)).toMatch(/difficulty/)
    expect(author.routeCheck!(req({ language: 'javascript' }), reply)).toMatch(/language/)
    expect(author.routeCheck!(req({ pattern: 'accumulate' }), reply)).toMatch(/pattern/)
  })

  it('rejects a variant that reuses the parent pattern', () => {
    const reply = author.schema.parse(fixture('invalid-same-pattern-as-parent'))
    const r = req({ parentExerciseId: 'bank_9', parent: { id: 'bank_9', pattern: 'early-return' } })
    expect(author.routeCheck!(r, reply)).toMatch(/parent/)
  })

  it('accepts a variant that changes the pattern away from the parent', () => {
    const reply = author.schema.parse(fixture('invalid-same-pattern-as-parent'))
    const r = req({ parentExerciseId: 'bank_9', parent: { id: 'bank_9', pattern: 'accumulate' } })
    expect(author.routeCheck!(r, reply)).toBeNull()
  })

  it('rejects a prompt that leaks the pattern id or the words CLO', () => {
    const base = author.schema.parse(fixture('valid-python'))
    const leaky = { exercise: { ...base.exercise, prompt: `${base.exercise.prompt}\n\nUse the early-return idea.` } }
    expect(author.routeCheck!(req(), leaky)).toMatch(/pattern/)
    const cloLeak = { exercise: { ...base.exercise, prompt: `${base.exercise.prompt}\n\nThis covers CLO 3.` } }
    expect(author.routeCheck!(req(), cloLeak)).toMatch(/CLO/)
  })

  it('slices learning style, verbosity and mistake labels only', () => {
    const slice = author.slice({
      userId: 'u1',
      version: 7,
      profile: { learningStyle: 'verbal', verbosity: 'short', tone: 'playful', displayName: 'Sam' } as never,
      recentMistakes: [{ exerciseId: 'e', cloId: 'c', pattern: 'p', label: 'missing base case', at: 'now' }],
      points: 10,
    })
    expect(Object.keys(slice).sort()).toEqual(['profile', 'recentMistakes'])
    expect(Object.keys(slice.profile as object).sort()).toEqual(['learningStyle', 'verbosity'])
    expect(slice.recentMistakes).toEqual(['missing base case'])
  })

  it('builds the payload from the server-hydrated example and parent rows', () => {
    const payload = author.payload(req({ parentExerciseId: 'bank_9' }), {
      examples: [{ title: 'Bank one', prompt: 'p', starter_code: 's', tests: [], reference_solution: 'r' }],
      parent: { id: 'bank_9', pattern: 'accumulate', title: 'Parent', prompt: 'pp', starter_code: 'ps', tests: [], reference_solution: 'pr' },
    })
    expect(payload.language).toBe('python')
    expect(payload.examples).toEqual([{ title: 'Bank one', prompt: 'p', starterCode: 's', tests: [], referenceSolution: 'r' }])
    expect(payload.parent).toMatchObject({ pattern: 'accumulate', starterCode: 'ps' })
    expect(JSON.stringify(payload)).not.toContain('exampleIds')
  })

  it('is typed against the contract request', () => {
    const contractRequest: AuthorRequest = req()
    expect(contractRequest.agent).toBe('author')
  })
})
