import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { ProfilerRequest } from '@/lib/contracts'
import { profiler } from './profiler'

const fixture = (name: string) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/profiler/${name}.json`, 'utf8'))

const req = (phase: 1 | 2, answers: { questionId: string; answer: string }[]): ProfilerRequest => ({
  agent: 'profiler',
  trigger: 'onboarding-answer',
  state: { userId: 'u1', version: 4 },
  phase,
  answers,
})

describe('profiler module', () => {
  it('has a static system prompt that names json', () => {
    expect(profiler.system.toLowerCase()).toContain('json')
    expect(profiler.streams).toBe(false)
    expect(profiler.temperature).toBe(0.6)
  })

  it('accepts the valid fixtures', () => {
    expect(profiler.schema.parse(fixture('valid-phase1')).done).toBe(false)
    expect(profiler.schema.parse(fixture('valid-done')).nextQuestion).toBeNull()
  })

  it('rejects the invalid fixtures', () => {
    expect(() => profiler.schema.parse(fixture('invalid-done-mismatch'))).toThrow()
    expect(() => profiler.schema.parse(fixture('invalid-five-options'))).toThrow()
  })

  it('slices only the profile and the version', () => {
    const slice = profiler.slice({ userId: 'u1', version: 4, profile: { displayName: 'Sam' } as never, points: 900 })
    expect(Object.keys(slice).sort()).toEqual(['profile', 'version'])
  })

  it('sends the phase and the answers so far as the payload', () => {
    const answers = [{ questionId: 'p1f1', answer: 'A diagram showing how the loop moves through the list' }]
    expect(profiler.payload(req(1, answers), {})).toEqual({ phase: 1, answers })
  })

  it('falls back to the first fixed phase-1 question when nothing is answered', () => {
    const reply = profiler.fallback!(req(1, []))
    expect(reply.nextQuestion?.id).toBe('p1f1')
    expect(reply.nextQuestion?.options).toHaveLength(2)
    expect(reply.done).toBe(false)
    expect(() => profiler.schema.parse(reply)).not.toThrow()
  })

  it('scores the style axes deterministically from the phase-1 answers', () => {
    const reply = profiler.fallback!(
      req(1, [
        { questionId: 'p1f1', answer: 'A diagram showing how the loop moves through the list' },
        { questionId: 'p1f3', answer: 'A picture of the list with the index arrow past the end' },
      ]),
    )
    expect(reply.profileDelta.styleVector).toEqual({ visual: 0.4, verbal: 0, example: 0, theory: 0 })
    expect(reply.profileDelta.learningStyle).toBe('visual')
    expect(reply.nextQuestion?.id).toBe('p1f3')
  })

  it('calls the style mixed when visual and verbal are close', () => {
    const reply = profiler.fallback!(
      req(1, [
        { questionId: 'p1f1', answer: 'A diagram showing how the loop moves through the list' },
        { questionId: 'p1f4', answer: 'A description in ordinary sentences of what each one does' },
      ]),
    )
    expect(reply.profileDelta.learningStyle).toBe('mixed')
  })

  it('hands over to the first motivation question when phase 1 runs out', () => {
    const answers = Array.from({ length: 5 }, (_, i) => ({ questionId: `p1f${i + 1}`, answer: 'x' }))
    const reply = profiler.fallback!(req(1, answers))
    expect(reply.nextQuestion?.id).toBe('p2q1')
    expect(reply.done).toBe(false)
  })

  it('maps every phase-2 answer to its profile key and finishes after the sixth', () => {
    const reply = profiler.fallback!(
      req(2, [
        { questionId: 'p2q1', answer: 'To build something' },
        { questionId: 'p2q2', answer: 'Yes' },
        { questionId: 'p2q3', answer: 'Master' },
        { questionId: 'p2q4', answer: 'Not now' },
        { questionId: 'p2q5', answer: 'Tough love' },
        { questionId: 'p2q6', answer: 'Detailed' },
      ]),
    )
    expect(reply.profileDelta.motivation).toEqual({
      why: 'To build something',
      beyondCourses: true,
      depth: 'master',
      wantsAgenticCoding: false,
    })
    expect(reply.profileDelta.tone).toBe('tough-love')
    expect(reply.profileDelta.verbosity).toBe('verbose')
    expect(reply.profileDelta.onboardingComplete).toBe(true)
    expect(reply.nextQuestion).toBeNull()
    expect(reply.done).toBe(true)
    expect(() => profiler.schema.parse(reply)).not.toThrow()
  })

  it('counts each phase on its own when the answers of both are in the list', () => {
    const answers = [
      ...Array.from({ length: 5 }, (_, i) => ({ questionId: `p1f${i + 1}`, answer: 'x' })),
      { questionId: 'p2q1', answer: 'To build something' },
    ]
    const reply = profiler.fallback!(req(2, answers))
    expect(reply.nextQuestion?.id).toBe('p2q2')
    expect(reply.done).toBe(false)
    expect(reply.profileDelta.motivation).toEqual({ why: 'To build something' })
    expect(reply.profileDelta.onboardingComplete).toBeUndefined()
  })

  it('never reads a phase-1 answer as a motivation answer', () => {
    const answers = Array.from({ length: 5 }, (_, i) => ({ questionId: `p1f${i + 1}`, answer: 'Yes' }))
    const reply = profiler.fallback!(req(2, answers))
    expect(reply.profileDelta.motivation).toBeUndefined()
    expect(reply.nextQuestion?.id).toBe('p2q1')
  })

  it('serves the fixed motivation questions in order', () => {
    const reply = profiler.fallback!(req(2, [{ questionId: 'p2q1', answer: 'To pass my courses' }]))
    expect(reply.nextQuestion?.id).toBe('p2q2')
    expect(reply.nextQuestion?.options).toEqual(['Yes', 'Only what the course needs', 'Ask me later'])
    expect(() => profiler.schema.parse(reply)).not.toThrow()
  })
})
