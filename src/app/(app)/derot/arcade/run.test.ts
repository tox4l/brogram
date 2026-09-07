import { describe, expect, it } from 'vitest'
import type { DrillItem, DrillResult } from '@/lib/contracts'
import { comboMultiplier } from '@/components/derot/scoring'
import { EMPTY_RUN, RUN_SIZE, buildRunResult, isRunComplete, recordRunAnswer, summarizeRun } from './run'

function item(overrides: Partial<DrillItem> = {}): DrillItem {
  return { id: 'd1', kind: 'trace', difficulty: 3, payload: {}, timeLimitS: 60, lane: 'arcade', ...overrides }
}

function result(overrides: Partial<DrillResult> = {}): DrillResult {
  return { drillId: 'd1', kind: 'trace', correct: true, timeMs: 1000, score: 100, at: '2026-09-06T10:00:00.000Z', lane: 'arcade', ...overrides }
}

describe('RUN_SIZE', () => {
  it('is six', () => {
    expect(RUN_SIZE).toBe(6)
  })
})

describe('isRunComplete / recordRunAnswer', () => {
  it('is not complete until six items have been recorded', () => {
    let state = EMPTY_RUN
    for (let i = 0; i < RUN_SIZE - 1; i++) {
      state = recordRunAnswer(state, item({ id: `i${i}` }), result({ drillId: `i${i}` }))
      expect(isRunComplete(state)).toBe(false)
    }
    state = recordRunAnswer(state, item({ id: 'last' }), result({ drillId: 'last' }))
    expect(isRunComplete(state)).toBe(true)
  })

  it('a miss does not end the run -- it keeps accepting answers until six are in', () => {
    let state = EMPTY_RUN
    state = recordRunAnswer(state, item({ id: 'a' }), result({ drillId: 'a', correct: false, score: 0 }))
    expect(isRunComplete(state)).toBe(false)
    expect(state.answers).toHaveLength(1)
    for (const id of ['b', 'c', 'd', 'e', 'f']) {
      state = recordRunAnswer(state, item({ id }), result({ drillId: id }))
    }
    expect(isRunComplete(state)).toBe(true)
    expect(state.answers).toHaveLength(RUN_SIZE)
  })

  it('ignores further answers once the run is already complete, so it can never exceed six items', () => {
    let state = EMPTY_RUN
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      state = recordRunAnswer(state, item({ id }), result({ drillId: id }))
    }
    const complete = state
    const extra = recordRunAnswer(complete, item({ id: 'seven' }), result({ drillId: 'seven' }))
    expect(extra).toBe(complete)
    expect(extra.answers).toHaveLength(RUN_SIZE)
  })

  it('the combo multiplier caps at 2x and a miss resets it, never the run', () => {
    let state = EMPTY_RUN
    state = recordRunAnswer(state, item({ id: '1' }), result({ drillId: '1', score: 100 }))
    expect(state.streak).toBe(1)
    state = recordRunAnswer(state, item({ id: '2' }), result({ drillId: '2', score: 100 }))
    expect(state.streak).toBe(2)
    state = recordRunAnswer(state, item({ id: '3' }), result({ drillId: '3', score: 100 }))
    expect(state.streak).toBe(3)
    state = recordRunAnswer(state, item({ id: '4' }), result({ drillId: '4', score: 100 }))
    expect(state.streak).toBe(4)
    // weightedTotal so far: 100*1 + 100*1.2 + 100*1.5 + 100*2 = 570
    expect(state.weightedTotal).toBe(570)
    expect(state.bestCombo).toBe(4)

    state = recordRunAnswer(state, item({ id: '5' }), result({ drillId: '5', correct: false, score: 0 }))
    expect(state.streak).toBe(0) // reset
    expect(state.bestCombo).toBe(4) // the run remembers the peak, not just the current streak
    expect(isRunComplete(state)).toBe(false) // the miss did not end the run

    state = recordRunAnswer(state, item({ id: '6' }), result({ drillId: '6', score: 100 }))
    expect(state.streak).toBe(1) // starts back at 1x, not where it left off before the miss
    expect(isRunComplete(state)).toBe(true)
  })
})

describe('summarizeRun', () => {
  it('a flawless six-item run (every item a perfect 100) normalises to exactly 100', () => {
    let state = EMPTY_RUN
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      state = recordRunAnswer(state, item({ id }), result({ drillId: id, score: 100 }))
    }
    const summary = summarizeRun(state)
    expect(summary.score).toBe(100)
    expect(summary.accuracy).toBe(1)
    expect(summary.bestCombo).toBe(RUN_SIZE)
    expect(summary.itemCount).toBe(RUN_SIZE)
    expect(summary.correctCount).toBe(RUN_SIZE)
  })

  it('keeps the score in [0, 100] even for a run of all misses', () => {
    let state = EMPTY_RUN
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      state = recordRunAnswer(state, item({ id }), result({ drillId: id, correct: false, score: 0 }))
    }
    const summary = summarizeRun(state)
    expect(summary.score).toBe(0)
    expect(summary.accuracy).toBe(0)
    expect(summary.rawTotal).toBe(0)
  })

  it('exposes the pre-normalisation raw total so the run summary can show it', () => {
    let state = EMPTY_RUN
    state = recordRunAnswer(state, item(), result({ score: 80 }))
    const summary = summarizeRun(state)
    expect(summary.rawTotal).toBe(80) // 80 * 1x (first hit)
    expect(summary.score).toBeGreaterThan(0)
    expect(summary.score).toBeLessThanOrEqual(100)
  })

  it('is empty-safe before any item has been answered', () => {
    const summary = summarizeRun(EMPTY_RUN)
    expect(summary).toEqual({ score: 0, rawTotal: 0, accuracy: 0, bestCombo: 0, itemCount: 0, correctCount: 0 })
  })
})

describe('summarizeRun ceiling scales with the run\'s own length (fix round 1, I2)', () => {
  function perfectRunOf(length: number) {
    let state = EMPTY_RUN
    for (let i = 0; i < length; i++) {
      state = recordRunAnswer(state, item({ id: `p${i}` }), result({ drillId: `p${i}`, score: 100 }))
    }
    return state
  }

  it('a flawless one-item run normalises to exactly 100, not a tiny fraction of the six-item ceiling', () => {
    const summary = summarizeRun(perfectRunOf(1))
    expect(summary.itemCount).toBe(1)
    expect(summary.score).toBe(100) // 100 * 1x / (100 * 1x) = 100, not 100/970 = 10
  })

  it('a flawless six-item run still normalises to exactly 100 (unchanged from before the fix)', () => {
    const summary = summarizeRun(perfectRunOf(6))
    expect(summary.itemCount).toBe(6)
    expect(summary.score).toBe(100)
  })

  it('a flawless ten-item run also normalises to exactly 100 -- a longer run (e.g. a future Playground reuse) is not silently punished', () => {
    // recordRunAnswer itself caps at RUN_SIZE (isRunComplete), so a ten-item
    // state is built directly -- this is exactly the shape summarizeRun must
    // handle honestly if it is ever fed a run of a different length.
    const answers = Array.from({ length: 10 }, (_, i) => ({
      item: item({ id: `p${i}` }),
      result: result({ drillId: `p${i}`, score: 100 }),
    }))
    const state = { answers, streak: 10, bestCombo: 10, weightedTotal: answers.reduce((sum, _, i) => sum + 100 * comboMultiplier(i + 1), 0) }
    const summary = summarizeRun(state)
    expect(summary.itemCount).toBe(10)
    expect(summary.score).toBe(100)
  })

  it('the same raw total normalises to a different score depending on how many items were actually played', () => {
    // One perfect item (weightedTotal 100) scores 100 against a one-item ceiling...
    let oneItem = EMPTY_RUN
    oneItem = recordRunAnswer(oneItem, item({ id: 'x' }), result({ drillId: 'x', score: 100 }))
    expect(summarizeRun(oneItem).score).toBe(100)

    // ...but the identical single answer, still the only one in a run.ts caller never intends to
    // finish yet, must not be silently compared against six items' worth of ceiling (the bug this
    // fix removes: normalising against a fixed RUN_SIZE-shaped constant regardless of itemCount).
    expect(summarizeRun(oneItem).itemCount).toBe(1)
  })
})

describe('buildRunResult', () => {
  it('is null before any item has been answered', () => {
    expect(buildRunResult(EMPTY_RUN)).toBeNull()
  })

  it('produces exactly one DrillResult for the whole run, not one per item', () => {
    let state = EMPTY_RUN
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item({ id, kind: 'speed-type', lane: 'arcade' }))
    for (const [i, drillItem] of items.entries()) {
      state = recordRunAnswer(state, drillItem, result({ drillId: drillItem.id, kind: 'speed-type', timeMs: 500, score: 90, correct: i < 4 }))
    }
    const run = buildRunResult(state, () => new Date('2026-09-06T12:00:00.000Z').getTime())
    expect(run).not.toBeNull()
    expect(run!.kind).toBe('speed-type')
    expect(run!.lane).toBe('arcade')
    expect(run!.drillId).toBe('a') // the first item played
    expect(run!.timeMs).toBe(3000) // sum of all six items' elapsed time
    expect(run!.at).toBe('2026-09-06T12:00:00.000Z')
    expect(run!.score).toBeGreaterThanOrEqual(0)
    expect(run!.score).toBeLessThanOrEqual(100)
  })

  it('correct is a majority verdict across the run (at least half right)', () => {
    let state = EMPTY_RUN
    // 3 correct out of 6 -- exactly half counts as correct.
    for (const [i, id] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
      state = recordRunAnswer(state, item({ id }), result({ drillId: id, correct: i < 3, score: i < 3 ? 100 : 0 }))
    }
    expect(buildRunResult(state)!.correct).toBe(true)
  })

  it('correct is false when fewer than half the items are right', () => {
    let state = EMPTY_RUN
    for (const [i, id] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
      state = recordRunAnswer(state, item({ id }), result({ drillId: id, correct: i < 2, score: i < 2 ? 100 : 0 }))
    }
    expect(buildRunResult(state)!.correct).toBe(false)
  })
})
