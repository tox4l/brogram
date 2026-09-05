import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { AgentRequest, LearnerState } from '@/lib/contracts'
import { approxTokens, toneSentences, buildMessages, BudgetExceeded, type AgentModule } from './shared'

const state = (extra: Partial<LearnerState> = {}) =>
  ({ userId: 'u1', version: 3, ...extra }) as AgentRequest['state']

function fakeModule(over: Partial<AgentModule<AgentRequest, unknown>> = {}): AgentModule<AgentRequest, unknown> {
  return {
    name: 'coach',
    system: 'You are a test agent. Reply only with json.',
    schema: z.object({}) as z.ZodType<unknown>,
    slice: (s) => ({ profile: s.profile, recentMistakes: s.recentMistakes ?? [] }),
    payload: () => ({}),
    temperature: 0.6,
    maxTokens: 1500,
    streams: true,
    ...over,
  }
}

describe('approxTokens', () => {
  it('counts about one token per 3.5 characters, rounding up', () => {
    expect(approxTokens('')).toBe(0)
    expect(approxTokens('abcdefg')).toBe(2)
    expect(approxTokens('a'.repeat(3500))).toBe(1000)
  })
})

describe('toneSentences', () => {
  it('maps every tone to its sentence', () => {
    expect(toneSentences({ tone: 'playful' })).toContain('playful and light')
    expect(toneSentences({ tone: 'supportive' })).toContain('warm and encouraging')
    expect(toneSentences({ tone: 'tough-love' })).toContain('blunt and demanding')
    expect(toneSentences({ tone: 'direct' })).toContain('neutral and precise')
  })

  it('defaults to direct and short when the profile is missing', () => {
    const s = toneSentences(undefined)
    expect(s).toContain('neutral and precise')
    expect(s).toContain('one or two sentences')
  })

  it('switches the verbosity sentence', () => {
    expect(toneSentences({ verbosity: 'verbose' })).toContain('up to four sentences')
  })
})

describe('buildMessages', () => {
  it('puts the static system prompt first, then state, tone and payload', () => {
    const mod = fakeModule({ payload: () => ({ hello: 'world' }) })
    const req = { agent: 'coach', trigger: 'hint-requested', state: state() } as unknown as AgentRequest
    const { messages, promptTokens } = buildMessages(mod, req, {})
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ role: 'system', content: mod.system })
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('Learner state (json):')
    expect(messages[1].content).toContain('neutral and precise')
    expect(messages[1].content).toContain('"hello":"world"')
    expect(promptTokens).toBe(approxTokens(messages.map((m) => m.content).join('\n')))
  })

  it('caps code and currentCode at 20000 characters', () => {
    const mod = fakeModule({ payload: (req) => ({ currentCode: (req as never as { currentCode: string }).currentCode }) })
    const req = { agent: 'coach', trigger: 'hint-requested', state: state(), currentCode: 'x'.repeat(30000) } as unknown as AgentRequest
    const { messages } = buildMessages(mod, req, {})
    expect(messages[1].content).toContain('x'.repeat(20000))
    expect(messages[1].content).not.toContain('x'.repeat(20001))
  })

  it('trims the oldest recent mistakes until the prompt fits the budget', () => {
    const recentMistakes = Array.from({ length: 10 }, (_, i) => ({
      exerciseId: `e${i}`,
      cloId: 'C-1',
      pattern: 'p',
      label: 'off by one in range '.repeat(40),
      at: '2026-09-05T00:00:00.000Z',
    }))
    const mod = fakeModule({ name: 'buddy', slice: (s) => ({ recentMistakes: [...(s.recentMistakes ?? [])] }) })
    const req = { agent: 'buddy', trigger: 'buddy-message', state: state({ recentMistakes }) } as unknown as AgentRequest
    const { messages, promptTokens } = buildMessages(mod, req, {})
    expect(promptTokens).toBeLessThanOrEqual(2000)
    const kept = JSON.parse(messages[1].content.split('Learner state (json):\n')[1].split('\n\n')[0])
    expect(kept.recentMistakes.length).toBeLessThan(10)
    expect(recentMistakes).toHaveLength(10)
  })

  it('truncates long test output before dropping older buddy messages', () => {
    const mod = fakeModule({
      name: 'diagnoser',
      payload: () => ({ results: [{ testId: 't1', stdout: 'o'.repeat(20000), stderr: '', actual: 'a'.repeat(20000) }] }),
    })
    const req = { agent: 'diagnoser', trigger: 'attempt-failed', state: state() } as unknown as AgentRequest
    const { messages } = buildMessages(mod, req, {})
    expect(messages[1].content).not.toContain('o'.repeat(201))
    expect(messages[1].content).not.toContain('a'.repeat(201))
  })

  it('throws BudgetExceeded when trimming cannot get under the limit', () => {
    const mod = fakeModule({ name: 'profiler', payload: () => ({ answers: [{ questionId: 'q', answer: 'z'.repeat(40000) }] }) })
    const req = { agent: 'profiler', trigger: 'onboarding-answer', state: state() } as unknown as AgentRequest
    expect(() => buildMessages(mod, req, {})).toThrow(BudgetExceeded)
    try {
      buildMessages(mod, req, {})
    } catch (e) {
      expect((e as BudgetExceeded).limit).toBe(2000)
      expect((e as BudgetExceeded).used).toBeGreaterThan(2000)
    }
  })
})
