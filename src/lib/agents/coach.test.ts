import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { CoachRequest } from '@/lib/contracts'
import { coach } from './coach'

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/coach/${name}.json`, 'utf8'))

const req = (over: Partial<CoachRequest> = {}): CoachRequest => ({
  agent: 'coach',
  trigger: 'hint-requested',
  state: { userId: 'u1', version: 5 },
  exercise: { id: 'ex_1', cloId: 'INFS1101-3', pattern: 'early-return', prompt: 'Find the first late train.', language: 'python' },
  diffSinceLastHint: '@@ -3,2 +3,3 @@',
  currentCode: 'def first_late(times, limit):\n    return -1\n',
  fixPlan: ['Trace the loop.', 'Move the return.', 'Check the empty list.', 'Run the visible examples before you submit again.'],
  hintsSoFar: [],
  ...over,
})

describe('coach module', () => {
  it('streams and names json in a static system prompt', () => {
    expect(coach.system.toLowerCase()).toContain('json')
    expect(coach.streams).toBe(true)
    expect(coach.temperature).toBe(0.6)
  })

  it('accepts the valid fixtures', () => {
    expect(coach.schema.parse(fixture('valid-no-code')).codeLine).toBeUndefined()
    expect(coach.schema.parse(fixture('valid-with-fragment')).codeLine).toBe('t > limit')
  })

  it('rejects the invalid fixtures', () => {
    expect(() => coach.schema.parse(fixture('invalid-multiline-code'))).toThrow()
    expect(() => coach.schema.parse(fixture('invalid-banned-word'))).toThrow()
    expect(() => coach.schema.parse(fixture('invalid-code-block-in-hint'))).toThrow()
  })

  it('rejects a code line that is a whole solving statement', () => {
    const reply = { hint: 'Look again at where the loop ends and what it gives back.', planStep: 2, codeLine: 'return next(t for t in times if t > limit)' }
    expect(() => coach.schema.parse(reply)).toThrow()
  })

  it('drops the code line for the first two hints of an exercise', () => {
    const reply = coach.schema.parse(fixture('valid-with-fragment'))
    expect(coach.repair!(req({ hintsSoFar: [] }), reply).codeLine).toBeUndefined()
    expect(coach.repair!(req({ hintsSoFar: ['one'] }), reply).codeLine).toBeUndefined()
    expect(coach.repair!(req({ hintsSoFar: ['one', 'two'] }), reply).codeLine).toBe('t > limit')
  })

  it('never lets the plan step skip more than one ahead or run past the plan', () => {
    const reply = { ...coach.schema.parse(fixture('valid-no-code')), planStep: 6 }
    expect(coach.repair!(req({ hintsSoFar: [] }), reply).planStep).toBe(1)
    expect(coach.repair!(req({ hintsSoFar: ['a', 'b'] }), reply).planStep).toBe(3)
    expect(coach.repair!(req({ hintsSoFar: ['a', 'b', 'c', 'd', 'e'] }), reply).planStep).toBe(4)
  })

  it('repairs a half-streamed reply without inventing a plan step', () => {
    const partial = { hint: 'Look again at the loop', codeLine: 't > limit' } as never
    const repaired = coach.repair!(req({ hintsSoFar: [] }), partial)
    expect(repaired.codeLine).toBeUndefined()
    expect(repaired.planStep).toBeUndefined()
    expect(coach.repair!(req(), {} as never)).toEqual({})
  })

  it('leaves the caller reply untouched when repairing', () => {
    const reply = coach.schema.parse(fixture('valid-with-fragment'))
    coach.repair!(req(), reply)
    expect(reply.codeLine).toBe('t > limit')
  })

  it('slices tone and verbosity only', () => {
    const slice = coach.slice({ userId: 'u1', version: 5, profile: { tone: 'tough-love', verbosity: 'short', displayName: 'Sam' } as never, mastery: {}, points: 4 })
    expect(slice).toEqual({ profile: { tone: 'tough-love', verbosity: 'short' } })
  })

  it('sends the diff, the code, the plan and the hints already given', () => {
    const payload = coach.payload(req({ hintsSoFar: ['first hint'] }), {})
    expect(payload).toEqual({
      exercise: req().exercise,
      diffSinceLastHint: '@@ -3,2 +3,3 @@',
      currentCode: req().currentCode,
      fixPlan: req().fixPlan,
      hintsSoFar: ['first hint'],
    })
  })

  it('falls back to a schema-valid tracing hint', () => {
    const reply = coach.fallback!(req())
    expect(reply.planStep).toBe(1)
    expect(reply.codeLine).toBeUndefined()
    expect(() => coach.schema.parse(reply)).not.toThrow()
  })
})
