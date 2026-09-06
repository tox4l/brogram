import { describe, expect, it } from 'vitest'
import fallbackQuestions from '@/lib/agents/fixtures/profiler-fallback.json'
import { PHASE2 } from './derive'
import { MAX_QUESTIONS, QUESTIONS } from './questions'

/**
 * The anti-drift test (T1.5 step 2): `QUESTIONS` must stay byte-identical, id and text, to its two
 * sources — the Profiler's own fixture and its hardcoded phase-2 set — so the local bank shown to
 * every learner and the live agent's fallback (exercised in `src/lib/agents/profiler.test.ts`,
 * which this task does not own and must not edit) can never silently diverge.
 */
describe('QUESTIONS anti-drift', () => {
  it('has exactly six questions and MAX_QUESTIONS agrees', () => {
    expect(QUESTIONS).toHaveLength(6)
    expect(MAX_QUESTIONS).toBe(6)
  })

  it('the four phase-1 questions are exactly p1f1..p1f4, verbatim, from the fixture', () => {
    // Pinned as literals (fix round 1, Minor M1), not derived by re-slicing the fixture: a
    // reorder or an inserted entry in profiler-fallback.json must fail this test, not silently
    // change which four questions a learner sees.
    const phase1 = QUESTIONS.filter((q) => q.phase === 1)
    expect(phase1.map((q) => q.id)).toEqual(['p1f1', 'p1f2', 'p1f3', 'p1f4'])
    const byId = new Map(fallbackQuestions.questions.map((q) => [q.id, q]))
    phase1.forEach((question) => {
      const source = byId.get(question.id)!
      expect(question.text).toBe(source.text)
      expect(question.options.map((o) => o.label)).toEqual(source.options.map((o) => o.text))
      expect(question.options.map((o) => o.value)).toEqual(source.options.map((o) => o.text))
    })
  })

  it('the two phase-2 questions are p2q1 and p2q5 from the hardcoded set, verbatim', () => {
    const phase2 = QUESTIONS.filter((q) => q.phase === 2)
    expect(phase2.map((q) => q.id)).toEqual(['p2q1', 'p2q5'])
    for (const question of phase2) {
      const source = PHASE2.find((candidate) => candidate.id === question.id)!
      expect(question.text).toBe(source.text)
      expect(question.options.map((o) => o.label)).toEqual(source.options)
      expect(question.options.map((o) => o.value)).toEqual(source.options)
    }
  })

  it('never introduces an id or text that is not in one of the two sources', () => {
    const fixtureIds = new Set(fallbackQuestions.questions.map((q) => q.id))
    const phase2Ids = new Set(PHASE2.map((q) => q.id))
    for (const question of QUESTIONS) {
      const known = question.phase === 1 ? fixtureIds.has(question.id) : phase2Ids.has(question.id)
      expect(known).toBe(true)
    }
  })
})
