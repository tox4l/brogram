import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { Clo, Mastery, PlannerRequest } from '@/lib/contracts'
import { planner } from './planner'

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/planner/${name}.json`, 'utf8'))

const clo = (n: number, prerequisites: string[]): Clo => ({
  id: `INFS1101-${n}`,
  course: 'INFS1101',
  ordinal: n,
  outcome: `Outcome number ${n} about loops that stop early on the first match`,
  topics: [],
  prerequisites,
  patterns: ['early-return'],
  assessableInCode: true,
})

const mastery = (cloId: string, closed: boolean): Mastery => ({
  userId: 'u1',
  cloId,
  score: closed ? 90 : 20,
  chain: closed ? 3 : 0,
  patternsPassed: [],
  closed,
  lastAttemptAt: null,
})

const req = (over: Partial<PlannerRequest> = {}): PlannerRequest => ({
  agent: 'planner',
  trigger: 'plan-refresh',
  state: { userId: 'u1', version: 2 },
  course: 'INFS1101',
  clos: [clo(2, []), clo(1, []), clo(3, ['INFS1101-2'])],
  candidates: [
    { id: 'ex_1', cloId: 'INFS1101-1', pattern: 'early-return', difficulty: 5, title: 'Hard one' },
    { id: 'ex_2', cloId: 'INFS1101-1', pattern: 'accumulate', difficulty: 3, title: 'Just right' },
    { id: 'ex_3', cloId: 'INFS1101-1', pattern: 'count', difficulty: 2, title: 'Gentle' },
    { id: 'ex_4', cloId: 'INFS1101-2', pattern: 'count', difficulty: 3, title: 'Later CLO' },
  ],
  ...over,
})

describe('planner module', () => {
  it('has a static system prompt that names json', () => {
    expect(planner.system.toLowerCase()).toContain('json')
    expect(planner.streams).toBe(false)
    expect(planner.temperature).toBe(0.3)
  })

  it('accepts the valid fixture and rejects the schema-invalid ones', () => {
    expect(planner.schema.parse(fixture('valid')).nextExerciseIds).toHaveLength(3)
    expect(() => planner.schema.parse(fixture('invalid-four-ids'))).toThrow()
    expect(() => planner.schema.parse(fixture('invalid-exclamation'))).toThrow()
  })

  it('lets an unknown exercise id through Zod and catches it in the route check', () => {
    const reply = planner.schema.parse(fixture('invalid-unknown-id'))
    const r = req({
      candidates: [{ id: 'ex_1', cloId: 'INFS1101-1', pattern: 'early-return', difficulty: 3, title: 'One' }],
    })
    expect(planner.routeCheck!(r, reply)).toContain('ex_99')
  })

  it('accepts a reply whose path covers the course exactly once', () => {
    const reply = planner.schema.parse(fixture('valid'))
    const r = req({
      candidates: [
        { id: 'ex_1', cloId: 'INFS1101-1', pattern: 'a', difficulty: 3, title: 'One' },
        { id: 'ex_2', cloId: 'INFS1101-1', pattern: 'b', difficulty: 3, title: 'Two' },
        { id: 'ex_3', cloId: 'INFS1101-1', pattern: 'c', difficulty: 3, title: 'Three' },
      ],
    })
    expect(planner.routeCheck!(r, reply)).toBeNull()
  })

  it('rejects a path that is not a permutation of the course CLOs', () => {
    const reply = { ...planner.schema.parse(fixture('valid')), path: ['INFS1101-1', 'INFS1101-1', 'INFS1101-2'] }
    expect(planner.routeCheck!(req(), reply)).toMatch(/path/)
  })

  it('slices motivation, learning style, mastery, mistake labels and the course', () => {
    const slice = planner.slice({
      userId: 'u1',
      version: 2,
      currentCourse: 'INFS1101',
      profile: { learningStyle: 'visual', motivation: { why: 'w', beyondCourses: true, depth: 'pass', wantsAgenticCoding: false }, tone: 'playful' } as never,
      mastery: { 'INFS1101-1': mastery('INFS1101-1', true) },
      recentMistakes: [{ exerciseId: 'e', cloId: 'INFS1101-1', pattern: 'p', label: 'off by one', at: 'now' }],
      points: 500,
    })
    expect(Object.keys(slice).sort()).toEqual(['currentCourse', 'mastery', 'profile', 'recentMistakes'])
    expect(slice.recentMistakes).toEqual(['off by one'])
    expect(Object.keys(slice.profile as object).sort()).toEqual(['learningStyle', 'motivation'])
  })

  it('falls back to a topological path with closed CLOs pushed last', () => {
    const r = req({ state: { userId: 'u1', version: 2, mastery: { 'INFS1101-1': mastery('INFS1101-1', true) } } })
    const reply = planner.fallback!(r)
    expect(reply.path).toEqual(['INFS1101-2', 'INFS1101-3', 'INFS1101-1'])
    expect(planner.routeCheck!(r, reply)).toBeNull()
  })

  it('picks three candidates for the first open CLO, nearest difficulty 3 first', () => {
    const reply = planner.fallback!(req())
    expect(reply.nextExerciseIds).toEqual(['ex_2', 'ex_3', 'ex_1'])
    expect(reply.focus.startsWith('Next: ')).toBe(true)
    expect(() => planner.schema.parse(reply)).not.toThrow()
  })

  it('says the exercises are being prepared when there are no candidates', () => {
    const reply = planner.fallback!(req({ candidates: [] }))
    expect(reply.nextExerciseIds).toEqual([])
    expect(reply.focus).toBe('Your next exercises are still being prepared.')
    expect(() => planner.schema.parse(reply)).not.toThrow()
  })
})
