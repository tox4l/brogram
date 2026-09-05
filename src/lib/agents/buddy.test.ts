import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { BuddyRequest, Mastery } from '@/lib/contracts'
import { buddy } from './buddy'

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/buddy/${name}.json`, 'utf8'))

const mastery = (cloId: string, score: number, closed: boolean): Mastery => ({
  userId: 'u1',
  cloId,
  score,
  chain: 0,
  patternsPassed: [],
  closed,
  lastAttemptAt: null,
})

const req = (over: Partial<BuddyRequest> = {}): BuddyRequest => ({
  agent: 'buddy',
  trigger: 'buddy-message',
  state: { userId: 'u1', version: 12, nextExerciseIds: ['ex_1', 'ex_2', 'ex_3'] },
  messages: [{ role: 'user', content: 'why do i keep failing loops' }],
  ...over,
})

describe('buddy module', () => {
  it('streams and names json in a static system prompt', () => {
    expect(buddy.system.toLowerCase()).toContain('json')
    expect(buddy.streams).toBe(true)
    expect(buddy.temperature).toBe(0.6)
  })

  it('accepts the valid fixtures', () => {
    expect(buddy.schema.parse(fixture('valid-on-topic')).suggestion).toEqual({ kind: 'derot', ref: 'trace' })
    expect(buddy.schema.parse(fixture('valid-off-topic')).onTopic).toBe(false)
  })

  it('rejects the invalid fixtures', () => {
    expect(() => buddy.schema.parse(fixture('invalid-off-topic-custom-text'))).toThrow()
    expect(() => buddy.schema.parse(fixture('invalid-identity-leak'))).toThrow()
    expect(() => buddy.schema.parse(fixture('invalid-off-topic-with-suggestion'))).toThrow()
  })

  it('drops an exercise suggestion the planner did not pick', () => {
    const reply = { ...buddy.schema.parse(fixture('valid-on-topic')), suggestion: { kind: 'exercise' as const, ref: 'ex_404' } }
    expect(buddy.repair!(req(), reply).suggestion).toBeUndefined()
  })

  it('keeps an exercise suggestion that is one of the next exercises', () => {
    const reply = { ...buddy.schema.parse(fixture('valid-on-topic')), suggestion: { kind: 'exercise' as const, ref: 'ex_2' } }
    expect(buddy.repair!(req(), reply).suggestion).toEqual({ kind: 'exercise', ref: 'ex_2' })
  })

  it('never touches a derot or break suggestion', () => {
    const reply = buddy.schema.parse(fixture('valid-on-topic'))
    expect(buddy.repair!(req(), reply).suggestion).toEqual({ kind: 'derot', ref: 'trace' })
  })

  it('summarises mastery instead of sending every row', () => {
    const slice = buddy.slice({
      userId: 'u1',
      version: 12,
      profile: { displayName: 'Sam', tone: 'playful' } as never,
      mastery: {
        'C-1': mastery('C-1', 90, true),
        'C-2': mastery('C-2', 30, false),
        'C-3': mastery('C-3', 10, false),
        'C-4': mastery('C-4', 55, false),
        'C-5': mastery('C-5', 20, false),
      },
      recentMistakes: [
        { exerciseId: 'e1', cloId: 'C-2', pattern: 'p', label: 'off by one', at: 'now' },
        { exerciseId: 'e2', cloId: 'C-2', pattern: 'p', label: 'off by one', at: 'now' },
        { exerciseId: 'e3', cloId: 'C-3', pattern: 'p', label: 'missing base case', at: 'now' },
      ],
      streak: { exerciseDays: 4, derotDays: 1, lastExerciseDate: '2026-09-05', lastDerotDate: null },
      integrityScore: 3,
      accountStatus: 'warned',
      nextExerciseIds: ['ex_1'],
      points: 800,
    })
    expect(Object.keys(slice).sort()).toEqual([
      'accountStatus', 'integrityScore', 'mastery', 'nextExerciseIds', 'profile', 'recentMistakes', 'streak',
    ])
    expect(slice.mastery).toEqual({
      closed: 1,
      open: 4,
      lowest: [{ cloId: 'C-3', score: 10 }, { cloId: 'C-5', score: 20 }, { cloId: 'C-2', score: 30 }],
    })
    expect(slice.recentMistakes).toEqual([
      { label: 'off by one', count: 2 },
      { label: 'missing base case', count: 1 },
    ])
  })

  it('sends only the conversation as the payload', () => {
    expect(buddy.payload(req(), {})).toEqual({ messages: req().messages })
  })

  it('falls back to a schema-valid on-topic apology', () => {
    const reply = buddy.fallback!(req())
    expect(reply.onTopic).toBe(true)
    expect(reply.suggestion).toBeUndefined()
    expect(() => buddy.schema.parse(reply)).not.toThrow()
  })
})
