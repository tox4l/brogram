import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { Mastery, ReviewerRequest } from '@/lib/contracts'
import { reviewer } from './reviewer'

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/reviewer/${name}.json`, 'utf8'))

const mastery = (cloId: string): Mastery => ({
  userId: 'u1',
  cloId,
  score: 64,
  chain: 2,
  patternsPassed: ['early-return'],
  closed: false,
  lastAttemptAt: null,
})

const req = (over: Partial<ReviewerRequest> = {}): ReviewerRequest => ({
  agent: 'reviewer',
  trigger: 'attempt-passed',
  state: { userId: 'u1', version: 9 },
  exercise: { id: 'ex_1', cloId: 'INFS1101-3', pattern: 'early-return', prompt: 'Find the first late train.', language: 'python' },
  code: 'def first_late(times, limit):\n    for t in times:\n        if t > limit:\n            return t\n    return -1\n',
  hintCount: 0,
  durationMs: 412000,
  ...over,
})

describe('reviewer module', () => {
  it('does not stream and names json in a static system prompt', () => {
    expect(reviewer.system.toLowerCase()).toContain('json')
    expect(reviewer.streams).toBe(false)
    expect(reviewer.temperature).toBe(0.3)
  })

  it('accepts the valid fixture', () => {
    expect(reviewer.schema.parse(fixture('valid')).improvements).toHaveLength(2)
  })

  it('rejects the invalid fixtures', () => {
    expect(() => reviewer.schema.parse(fixture('invalid-three-improvements'))).toThrow()
    expect(() => reviewer.schema.parse(fixture('invalid-mentions-reference'))).toThrow()
    expect(() => reviewer.schema.parse(fixture('invalid-quality-101'))).toThrow()
  })

  it('rejects praise that shouts', () => {
    const reply = { ...reviewer.schema.parse(fixture('valid')), praise: 'Every single test passed on the first try!' }
    expect(() => reviewer.schema.parse(reply)).toThrow()
  })

  it('slices tone and verbosity only, because mastery is picked by exercise CLO in the payload', () => {
    const slice = reviewer.slice({
      userId: 'u1',
      version: 9,
      profile: { tone: 'direct', verbosity: 'short', displayName: 'Sam' } as never,
      mastery: { 'INFS1101-3': mastery('INFS1101-3'), 'INFS1101-1': mastery('INFS1101-1') },
      points: 30,
    })
    expect(slice).toEqual({ profile: { tone: 'direct', verbosity: 'short' } })
  })

  it('sends only the mastery row of the exercise CLO', () => {
    const r = req({
      state: { userId: 'u1', version: 9, mastery: { 'INFS1101-3': mastery('INFS1101-3'), 'INFS1101-1': mastery('INFS1101-1') } },
    })
    expect(reviewer.payload(r, {}).mastery).toEqual(mastery('INFS1101-3'))
    expect(reviewer.payload(req(), {}).mastery).toBeNull()
  })

  it('adds the server-hydrated reference solution to the exercise it sends', () => {
    const payload = reviewer.payload(req(), { referenceSolution: 'the real one' })
    expect((payload.exercise as { referenceSolution: string }).referenceSolution).toBe('the real one')
    expect(payload.hintCount).toBe(0)
    expect(payload.durationMs).toBe(412000)
  })

  it('ignores a reference solution the client tried to send', () => {
    const spoofed = req({ exercise: { ...req().exercise, referenceSolution: 'client guess' } as never })
    const payload = reviewer.payload(spoofed, { referenceSolution: 'the real one' })
    expect(JSON.stringify(payload)).not.toContain('client guess')
  })

  it('falls back to a schema-valid pair of improvements', () => {
    const reply = reviewer.fallback!(req())
    expect(reply.improvements).toHaveLength(2)
    expect(reply.quality).toBe(70)
    expect(() => reviewer.schema.parse(reply)).not.toThrow()
  })
})
