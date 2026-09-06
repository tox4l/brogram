// Unit-level coverage for the fix round from the Opus review of a43196f
// (report: v2-T0.3-review.md). These import the build script's internals
// directly (co-located .mjs test, sidestepping any TS/.mjs interop questions)
// rather than only exercising them end-to-end through the CLI, because two of
// the four findings were specifically that a code path existed but nothing
// pinned it (I3), or that a check only ran against data that happened not to
// exercise the interesting branch (I1's missing lane, I3's dead micro-code
// strip).
import { describe, expect, it } from 'vitest'
import { assertNoSubstring, buildModel, projectLessonBlock, projectLessonPublic } from './build-static-curriculum.mjs'

const ARCADE_KINDS = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']
const PLAY_KINDS = ['follow-the-dot', 'color-nback', 'reaction', 'rhythm', 'breathe', 'memory-grid']

describe('drill lanes (I1)', () => {
  it('every bundled drill item carries a lane, and the lane set matches the seed loader\'s rule', () => {
    const { drills } = buildModel()

    // Parity with scripts/seed-load.mjs: exactly the six seed-authored kinds
    // plus the six synthesized Playground kinds, nothing more or less.
    expect([...drills.keys()].sort()).toEqual([...ARCADE_KINDS, ...PLAY_KINDS].sort())

    for (const [kind, items] of drills) {
      expect(items.length, `${kind} has no items`).toBeGreaterThan(0)
      const expectedLane = ARCADE_KINDS.includes(kind) ? 'arcade' : 'play'
      for (const item of items) {
        expect(item.lane, `${kind}/${item.id}`).toBe(expectedLane)
      }
    }
  })

  it('synthesizes exactly one Playground row per play kind, id "play-<kind>", lane "play"', () => {
    const { drills } = buildModel()
    for (const kind of PLAY_KINDS) {
      const items = drills.get(kind)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ id: `play-${kind}`, kind, lane: 'play', difficulty: 3, payload: {} })
    }
  })

  it('a seed-authored drill with no lane key defaults to arcade, not undefined', () => {
    const { drills } = buildModel()
    for (const kind of ARCADE_KINDS) {
      for (const item of drills.get(kind)) expect(item.lane).toBe('arcade')
    }
  })
})

describe('lesson block projection is an allowlist, and fails closed (I2)', () => {
  const baseLesson = {
    id: 'TEST-1',
    cloId: 'TEST-1',
    course: 'TEST',
    language: 'python',
    version: 1,
    title: 't',
    hook: 'h',
    estimatedMinutes: 4,
    draft: false,
    tags: [],
    exitLine: 'e',
  }

  it('throws on an unknown block type, naming the lesson id and the type', () => {
    const lesson = { ...baseLesson, blocks: [{ type: 'order-lines', id: 'x', correctOrder: [1, 2] }] }
    expect(() => projectLessonPublic([lesson])).toThrow(/TEST-1/)
    expect(() => projectLessonPublic([lesson])).toThrow(/order-lines/)
  })

  it('throws on an unknown check kind, naming the lesson id and the kind', () => {
    const lesson = {
      ...baseLesson,
      blocks: [{ type: 'check', id: 'c1', kind: 'order-lines', prompt: 'p', correctOrder: [1, 2] }],
    }
    expect(() => projectLessonPublic([lesson])).toThrow(/TEST-1/)
    expect(() => projectLessonPublic([lesson])).toThrow(/order-lines/)
  })

  it('a recognised block with an extra, unlisted field drops that field rather than shipping it', () => {
    const lesson = {
      ...baseLesson,
      blocks: [{ type: 'concept', id: 'k1', heading: 'h', body: 'b', sneakyAnswerKey: 'nope' }],
    }
    const [projected] = projectLessonPublic([lesson])
    expect(projected.blocks[0]).not.toHaveProperty('sneakyAnswerKey')
    expect(projected.blocks[0]).toEqual({ type: 'concept', id: 'k1', heading: 'h', body: 'b' })
  })
})

describe('lesson secret stripping, pinned directly (I3)', () => {
  it('a micro-code check loses referenceSolution but keeps its tests (including hidden ones) untouched', () => {
    const block = {
      type: 'check',
      id: 'mc1',
      kind: 'micro-code',
      prompt: 'p',
      language: 'python',
      starterCode: 'pass',
      tests: [
        { id: 't1', input: '', expected: '1', hidden: false },
        { id: 't2', input: '', expected: '2', hidden: true },
      ],
      referenceSolution: 'print(1)',
      hint: 'h',
      explain: 'e',
    }
    const projected = projectLessonBlock({ id: 'LESSON-1' }, block)
    expect(projected).not.toHaveProperty('referenceSolution')
    expect(projected.tests).toEqual(block.tests)
    expect(Object.keys(projected).sort()).toEqual(
      ['type', 'id', 'kind', 'prompt', 'language', 'starterCode', 'tests', 'hint', 'explain'].sort(),
    )
  })

  it('a snippet loses expectedStdout and keeps everything else', () => {
    const block = {
      type: 'snippet',
      id: 's1',
      language: 'python',
      code: 'print(1)',
      runnable: true,
      expectedStdout: '1',
      caption: 'c',
    }
    const projected = projectLessonBlock({ id: 'LESSON-1' }, block)
    expect(projected).not.toHaveProperty('expectedStdout')
    expect(Object.keys(projected).sort()).toEqual(['type', 'id', 'language', 'code', 'runnable', 'caption'].sort())
  })

  it('predict-output, spot-the-bug and fill-blank checks keep exactly the spec-sanctioned fields', () => {
    const lesson = { id: 'LESSON-1' }

    expect(
      Object.keys(
        projectLessonBlock(lesson, {
          type: 'check',
          id: 'p1',
          kind: 'predict-output',
          prompt: 'p',
          language: 'python',
          code: 'c',
          expected: 'e',
          normalize: 'lines',
          hint: 'h',
          explain: 'x',
        }),
      ).sort(),
    ).toEqual(['type', 'id', 'kind', 'prompt', 'language', 'code', 'expected', 'normalize', 'hint', 'explain'].sort())

    expect(
      Object.keys(
        projectLessonBlock(lesson, {
          type: 'check',
          id: 'b1',
          kind: 'spot-the-bug',
          prompt: 'p',
          language: 'python',
          code: 'c',
          bugLines: [1],
          hint: 'h',
          explain: 'x',
        }),
      ).sort(),
    ).toEqual(['type', 'id', 'kind', 'prompt', 'language', 'code', 'bugLines', 'hint', 'explain'].sort())

    expect(
      Object.keys(
        projectLessonBlock(lesson, {
          type: 'check',
          id: 'f1',
          kind: 'fill-blank',
          prompt: 'p',
          language: 'python',
          template: '__1__',
          blanks: [{ id: '1', accept: ['x'] }],
          hint: 'h',
          explain: 'x',
        }),
      ).sort(),
    ).toEqual(['type', 'id', 'kind', 'prompt', 'language', 'template', 'blanks', 'hint', 'explain'].sort())
  })

  it('assertNoSubstring throws on an unstripped payload and stays quiet on a clean one (pins the guard itself)', () => {
    expect(() => assertNoSubstring([{ referenceSolution: 'x' }], 'referenceSolution', 'test')).toThrow(
      /referenceSolution/,
    )
    expect(() => assertNoSubstring([{ ok: true }], 'referenceSolution', 'test')).not.toThrow()
  })
})
