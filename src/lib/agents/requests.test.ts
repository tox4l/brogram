import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { AgentName } from '@/lib/contracts'
import { requestSchemas } from './requests'
import { modules } from './index'

const AGENTS: AgentName[] = ['profiler', 'planner', 'author', 'diagnoser', 'coach', 'reviewer', 'buddy']
const request = (agent: AgentName) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/requests/${agent}.json`, 'utf8'))

describe('request schemas', () => {
  it('covers every agent and matches the module registry', () => {
    expect(Object.keys(requestSchemas).sort()).toEqual([...AGENTS].sort())
    expect(Object.keys(modules).sort()).toEqual([...AGENTS].sort())
  })

  it('accepts every valid request fixture', () => {
    for (const agent of AGENTS) {
      const parsed = requestSchemas[agent].safeParse(request(agent))
      expect(parsed.success, `${agent}: ${parsed.error?.message}`).toBe(true)
    }
  })

  it('rejects a request whose agent does not match the schema', () => {
    expect(requestSchemas.coach.safeParse(request('buddy')).success).toBe(false)
  })

  it('strips a reference solution the client tried to smuggle in', () => {
    const body = request('reviewer')
    body.exercise.referenceSolution = 'client guess'
    const parsed = requestSchemas.reviewer.parse(body)
    expect(JSON.stringify(parsed)).not.toContain('client guess')
  })

  it('strips state keys the agent is not allowed to read', () => {
    const body = request('coach')
    body.state.mastery = { 'INFS1101-3': { cloId: 'INFS1101-3', score: 40, chain: 1, patternsPassed: [], closed: false } }
    body.state.integrityScore = 12
    body.state.profile.displayName = 'Sam'
    const parsed = requestSchemas.coach.parse(body) as { state: Record<string, unknown> }
    expect(Object.keys(parsed.state).sort()).toEqual(['profile', 'userId', 'version'])
    expect(parsed.state.profile).toEqual({ tone: 'direct', verbosity: 'short' })
  })

  it('caps the student code at 20000 characters', () => {
    const diagnoser = { ...request('diagnoser'), code: 'x'.repeat(20001) }
    expect(requestSchemas.diagnoser.safeParse(diagnoser).success).toBe(false)
    const coach = { ...request('coach'), currentCode: 'x'.repeat(20001) }
    expect(requestSchemas.coach.safeParse(coach).success).toBe(false)
  })

  it('caps the volatile lists at the sizes the budget assumes', () => {
    const over = (agent: AgentName, patch: Record<string, unknown>) =>
      requestSchemas[agent].safeParse({ ...request(agent), ...patch }).success
    const result = request('diagnoser').results[0]
    expect(over('diagnoser', { results: Array.from({ length: 21 }, () => result) })).toBe(false)
    expect(over('buddy', { messages: Array.from({ length: 7 }, () => ({ role: 'user', content: 'hi' })) })).toBe(false)
    expect(over('coach', { diffSinceLastHint: 'd'.repeat(8001) })).toBe(false)
    expect(over('coach', { fixPlan: Array.from({ length: 7 }, () => 'step') })).toBe(false)
    expect(over('coach', { hintsSoFar: Array.from({ length: 6 }, () => 'hint') })).toBe(false)
    expect(over('profiler', { answers: Array.from({ length: 14 }, () => ({ questionId: 'q', answer: 'a' })) })).toBe(false)
    expect(over('author', { exampleIds: ['a', 'b', 'c'] })).toBe(false)
  })

  it('rejects a trigger that does not belong to the agent', () => {
    expect(requestSchemas.coach.safeParse({ ...request('coach'), trigger: 'attempt-failed' }).success).toBe(false)
  })
})
