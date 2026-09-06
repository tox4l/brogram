import { describe, it, expect } from 'vitest'
import type { LessonCheck, TestResult } from '@/lib/contracts'
import { gradeCheck } from './grade'

const result = (passed: boolean): TestResult => ({
  testId: 't', passed, actual: '', expected: '', stdout: '', stderr: '', durationMs: 0,
  ...(passed ? {} : { failureKind: 'wrong-answer' as const }),
})

describe('gradeCheck: predict-output', () => {
  const check = (normalize: 'lines' | 'exact'): LessonCheck => ({
    type: 'check', id: 'c1', kind: 'predict-output', prompt: 'p', language: 'python',
    code: 'print(1)', expected: 'one\ntwo', normalize, hint: 'h', explain: 'e',
  })

  it('normalize: lines is line-by-line and whitespace-tolerant within a line', () => {
    expect(gradeCheck(check('lines'), { kind: 'predict-output', text: 'one\ntwo' }, 1).right).toBe(true)
    expect(gradeCheck(check('lines'), { kind: 'predict-output', text: ' one \n two ' }, 1).right).toBe(true)
  })

  it('normalize: lines never lets a joined single-line answer match a multi-line expected output', () => {
    expect(gradeCheck(check('lines'), { kind: 'predict-output', text: 'one two' }, 1).right).toBe(false)
  })

  it('normalize: exact is strict === on the raw strings, so trailing space is distinguished', () => {
    const c = { ...check('exact'), expected: 'one\ntwo' }
    expect(gradeCheck(c, { kind: 'predict-output', text: 'one\ntwo' }, 1).right).toBe(true)
    expect(gradeCheck(c, { kind: 'predict-output', text: 'one\ntwo ' }, 1).right).toBe(false)
    expect(gradeCheck(c, { kind: 'predict-output', text: ' one\ntwo' }, 1).right).toBe(false)
  })
})

describe('gradeCheck: choose', () => {
  const check: LessonCheck = {
    type: 'check', id: 'c2', kind: 'choose', prompt: 'p',
    options: ['a', 'b', 'c'], correctIndex: 1,
    why: ['why-a', 'why-b', 'why-c'],
    hint: 'h', explain: 'e',
  }

  it('is right only for the correct index', () => {
    expect(gradeCheck(check, { kind: 'choose', index: 1 }, 1).right).toBe(true)
    expect(gradeCheck(check, { kind: 'choose', index: 0 }, 1).right).toBe(false)
  })

  it('returns the why line for whichever option was actually chosen, right or wrong', () => {
    expect(gradeCheck(check, { kind: 'choose', index: 0 }, 1).why).toBe('why-a')
    expect(gradeCheck(check, { kind: 'choose', index: 1 }, 1).why).toBe('why-b')
    expect(gradeCheck(check, { kind: 'choose', index: 2 }, 1).why).toBe('why-c')
  })
})

describe('gradeCheck: spot-the-bug', () => {
  const check: LessonCheck = {
    type: 'check', id: 'c3', kind: 'spot-the-bug', prompt: 'p', language: 'python',
    code: 'x = 1', bugLines: [3, 5], hint: 'h', explain: 'e',
  }

  it('accepts any line in the bug-line set', () => {
    expect(gradeCheck(check, { kind: 'spot-the-bug', lines: [3] }, 1).right).toBe(true)
    expect(gradeCheck(check, { kind: 'spot-the-bug', lines: [5] }, 1).right).toBe(true)
  })

  it('rejects a line outside the set, and an empty selection', () => {
    expect(gradeCheck(check, { kind: 'spot-the-bug', lines: [4] }, 1).right).toBe(false)
    expect(gradeCheck(check, { kind: 'spot-the-bug', lines: [] }, 1).right).toBe(false)
  })
})

describe('gradeCheck: fill-blank', () => {
  const check: LessonCheck = {
    type: 'check', id: 'c4', kind: 'fill-blank', prompt: 'p', language: 'python',
    template: 'x = __1__',
    blanks: [{ id: '1', accept: ['range', 'Range'] }],
    hint: 'h', explain: 'e',
  }

  it('accepts any entry in accept, case- and whitespace-insensitively', () => {
    expect(gradeCheck(check, { kind: 'fill-blank', values: { '1': 'range' } }, 1).right).toBe(true)
    expect(gradeCheck(check, { kind: 'fill-blank', values: { '1': ' RANGE ' } }, 1).right).toBe(true)
    expect(gradeCheck(check, { kind: 'fill-blank', values: { '1': '  range  ' } }, 1).right).toBe(true)
  })

  it('rejects a near-miss and a missing blank', () => {
    expect(gradeCheck(check, { kind: 'fill-blank', values: { '1': 'ranges' } }, 1).right).toBe(false)
    expect(gradeCheck(check, { kind: 'fill-blank', values: {} }, 1).right).toBe(false)
  })

  it('requires every blank to match', () => {
    const twoBlanks: LessonCheck = {
      ...check,
      blanks: [{ id: '1', accept: ['a'] }, { id: '2', accept: ['b'] }],
    }
    expect(gradeCheck(twoBlanks, { kind: 'fill-blank', values: { '1': 'a', '2': 'b' } }, 1).right).toBe(true)
    expect(gradeCheck(twoBlanks, { kind: 'fill-blank', values: { '1': 'a', '2': 'wrong' } }, 1).right).toBe(false)
  })
})

describe('gradeCheck: micro-code', () => {
  const check: LessonCheck = {
    type: 'check', id: 'c5', kind: 'micro-code', prompt: 'p', language: 'python',
    starterCode: 'def f(): pass',
    tests: [{ id: 't1', input: '', expected: '1', hidden: false }],
    referenceSolution: 'def f(): return 1',
    hint: 'h', explain: 'e',
  }

  it('is right only when every visible test result passed', () => {
    expect(gradeCheck(check, { kind: 'micro-code', results: [result(true), result(true)] }, 1).right).toBe(true)
    expect(gradeCheck(check, { kind: 'micro-code', results: [result(true), result(false)] }, 1).right).toBe(false)
  })

  it('is not right with zero results', () => {
    expect(gradeCheck(check, { kind: 'micro-code', results: [] }, 1).right).toBe(false)
  })
})

describe('gradeCheck: reveal never punishes and never locks out', () => {
  const check: LessonCheck = {
    type: 'check', id: 'c6', kind: 'choose', prompt: 'p',
    options: ['a', 'b'], correctIndex: 1, why: ['wa', 'wb'], hint: 'h', explain: 'e',
  }
  const wrong = { kind: 'choose' as const, index: 0 }
  const right = { kind: 'choose' as const, index: 1 }

  it('reveals hint on the first wrong attempt', () => {
    expect(gradeCheck(check, wrong, 1).reveal).toBe('hint')
  })

  it('reveals explain on the second wrong attempt, and stays explain on the fifth (no lockout)', () => {
    expect(gradeCheck(check, wrong, 2).reveal).toBe('explain')
    expect(gradeCheck(check, wrong, 5).reveal).toBe('explain')
  })

  it('reveals nothing when the answer is right, regardless of attempt number', () => {
    expect(gradeCheck(check, right, 1).reveal).toBe('none')
    expect(gradeCheck(check, right, 5).reveal).toBe('none')
  })
})
