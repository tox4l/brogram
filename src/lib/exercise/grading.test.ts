import { describe, expect, it } from 'vitest'
import type { ExercisePublic } from '@/lib/contracts'
import { gradeAnswer, exerciseRunRequest, codeDiff } from './grading'
const exercise = (kind: ExercisePublic['kind'], expected: string): ExercisePublic => ({ id: 'e', cloId: 'c', language: 'javascript', kind, difficulty: 3, pattern: 'p', title: 't', prompt: 'p', starterCode: 'snippet', tests: [{ id: 't', input: '', expected, hidden: true }], tags: [], origin: 'seed' })
describe('answer grading', () => {
  it('normalizes whitespace within a line for output but keeps content exact', () => {
    // Corrected: the expected output is two lines ("one two", "three"); a
    // one-line answer must not match it. The old assertion here collapsed
    // both sides with `.replace(/\s+/g, ' ')`, which folded the newline into
    // a space and let this wrongly pass -- the same bug the 23:07 ruling
    // fixed in src/components/derot/scoring.ts.
    expect(gradeAnswer(exercise('predict-output', 'one two\nthree'), ' one\t two three ').ok).toBe(false)
    expect(gradeAnswer(exercise('predict-output', 'one two'), 'onetwo').ok).toBe(false)
  })
  it('does not collapse newlines when grading predict-output (regression)', () => {
    expect(gradeAnswer(exercise('predict-output', 'one\ntwo'), 'one\ntwo').ok).toBe(true)
    expect(gradeAnswer(exercise('predict-output', 'one\ntwo'), 'one two').ok).toBe(false)
  })
  it('uses order-independent line set equality and rejects wrong or malformed lines', () => {
    expect(gradeAnswer(exercise('spot-the-bug', '[2,4]'), '[4,2,2]').ok).toBe(true)
    expect(gradeAnswer(exercise('spot-the-bug', '[2,4]'), '[2]').ok).toBe(false)
    expect(gradeAnswer(exercise('spot-the-bug', '[2,4]'), 'oops').ok).toBe(false)
  })
  it('grades trace cells exactly, without trimming', () => {
    expect(gradeAnswer(exercise('trace', '{"count":3,"word":"ok"}'), '{"word":"ok","count":"3"}').ok).toBe(true)
    expect(gradeAnswer(exercise('trace', '{"word":"ok"}'), '{"word":"ok "}').ok).toBe(false)
  })
  it('routes schema through SQL with the fixture and DDL each present once', () => {
    const e = { ...exercise('schema', '{}'), fixture: 'CREATE TABLE seed(id INTEGER);' }
    expect(exerciseRunRequest(e, 'CREATE TABLE answer(id INTEGER);', true, ['numpy'])).toMatchObject({ language: 'sql', fixture: e.fixture, code: 'CREATE TABLE answer(id INTEGER);', tests: e.tests, packages: ['numpy'], timeoutMs: 5000 })
    expect(exerciseRunRequest(e, 'SELECT 1', false).tests).toEqual([])
  })
  it('produces a bounded unified diff of changed code', () => {
    const diff = codeDiff('one\ntwo\nthree', 'one\nchanged\nthree')
    expect(diff).toContain('-two'); expect(diff).toContain('+changed'); expect(diff).toContain('@@')
    expect(codeDiff('same', 'same')).toBe('')
    expect(codeDiff('a'.repeat(9000), 'b'.repeat(9000)).length).toBeLessThanOrEqual(8000)
  })
})
