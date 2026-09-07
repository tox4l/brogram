import { describe, it, expect } from 'vitest'
import {
  normalizeOutput,
  gradePredictOutput,
  gradeSpotTheBug,
  gradeTrace,
  gradeHoldFocus,
  scoreTimedCorrect,
  countPlantedMatches,
  gradeNBack,
  computeAccuracy,
  gradeSpeedType,
  clamp,
  comboMultiplier,
  nextComboStreak,
  weightedItemScore,
  normalizeFollowTheDot,
  normalizeColorNBack,
  normalizeReaction,
  normalizeRhythm,
  normalizeBreathe,
  normalizeMemoryGrid,
} from './scoring'

describe('normalizeOutput', () => {
  it('trims each line and collapses runs of spaces/tabs within it, but never across newlines', () => {
    expect(normalizeOutput('a  b \n c')).toBe('a b\nc')
    expect(normalizeOutput('  Hello,   Ali!  ')).toBe('Hello, Ali!')
  })

  it('drops a trailing newline (trailing empty lines)', () => {
    expect(normalizeOutput('2\n1\n')).toBe('2\n1')
    expect(normalizeOutput('a\n\n\n')).toBe('a')
  })

  it('does not collapse newlines into spaces', () => {
    expect(normalizeOutput('a\n\n\nb')).toBe('a\n\n\nb')
    expect(normalizeOutput('1|Ali\n2|Sara')).toBe('1|Ali\n2|Sara')
  })
})

describe('gradePredictOutput', () => {
  it('matches after normalizing both sides, line by line', () => {
    expect(gradePredictOutput('2\n1', '2\n1')).toBe(true)
    expect(gradePredictOutput('2\n1\n', '2\n1')).toBe(true)
    expect(gradePredictOutput('a  b \n c', 'a b\nc')).toBe(true)
  })

  it('rejects a different output', () => {
    expect(gradePredictOutput('2\n2', '2\n1')).toBe(false)
    expect(gradePredictOutput('', '2\n1')).toBe(false)
  })

  it('does not let a one-line answer match a multi-line expected output', () => {
    expect(gradePredictOutput('1|Ali 2|Sara', '1|Ali\n2|Sara')).toBe(false)
  })
})

describe('gradeSpotTheBug', () => {
  it('is correct when the clicked line is a bug line', () => {
    expect(gradeSpotTheBug(3, [3])).toBe(true)
    expect(gradeSpotTheBug(2, [1, 2, 5])).toBe(true)
  })

  it('is incorrect otherwise, including no click', () => {
    expect(gradeSpotTheBug(1, [3])).toBe(false)
    expect(gradeSpotTheBug(null, [3])).toBe(false)
  })
})

describe('gradeTrace', () => {
  it('is correct only when every variable matches, trimmed', () => {
    expect(gradeTrace({ i: '2', total: '3', count: '2' }, { i: '2', total: '3', count: '2' })).toBe(true)
    expect(gradeTrace({ i: ' 2 ', total: '3', count: '2' }, { i: '2', total: '3', count: '2' })).toBe(true)
  })

  it('is incorrect when any variable is wrong or missing', () => {
    expect(gradeTrace({ i: '2', total: '4', count: '2' }, { i: '2', total: '3', count: '2' })).toBe(false)
    expect(gradeTrace({ i: '2' }, { i: '2', total: '3', count: '2' })).toBe(false)
  })
})

describe('gradeHoldFocus', () => {
  it('is correct only for the exact answer index', () => {
    expect(gradeHoldFocus(1, 1)).toBe(true)
    expect(gradeHoldFocus(0, 1)).toBe(false)
    expect(gradeHoldFocus(null, 1)).toBe(false)
  })
})

describe('scoreTimedCorrect', () => {
  it('is 0 when incorrect regardless of time', () => {
    expect(scoreTimedCorrect(false, 0, 30)).toBe(0)
    expect(scoreTimedCorrect(false, 29000, 30)).toBe(0)
  })

  it('is 100 for an instant correct answer', () => {
    expect(scoreTimedCorrect(true, 0, 30)).toBe(100)
  })

  it('decays toward 50 as elapsed time approaches the limit', () => {
    // half the time used -> 100 * (1 - 0.5 * 0.5) = 75
    expect(scoreTimedCorrect(true, 15000, 30)).toBe(75)
  })

  it('never drops below 50 for a correct answer, even past the limit', () => {
    expect(scoreTimedCorrect(true, 30000, 30)).toBe(50)
    expect(scoreTimedCorrect(true, 60000, 30)).toBe(50)
  })

  it('is clamped to 100 even with a backwards clock (negative elapsed time)', () => {
    expect(scoreTimedCorrect(true, -5000, 30)).toBe(100)
  })
})

describe('countPlantedMatches', () => {
  it('counts positions where a token repeats exactly n back', () => {
    expect(countPlantedMatches(['a', 'b', 'a', 'c', 'c'], 2)).toBe(1) // index 2 'a' matches index 0
    expect(countPlantedMatches(['a', 'b', 'b', 'c'], 1)).toBe(1) // index 2 'b' matches index 1
    expect(countPlantedMatches(['a', 'b', 'c'], 1)).toBe(0)
  })

  it('is 0 for an empty token list or n >= length', () => {
    expect(countPlantedMatches([], 1)).toBe(0)
    expect(countPlantedMatches(['a', 'b'], 2)).toBe(0)
  })
})

describe('gradeNBack', () => {
  it('is correct when hits minus false alarms is at least half the planted matches', () => {
    expect(gradeNBack(4, 0, 4)).toEqual({ correct: true, score: 100 })
    expect(gradeNBack(2, 0, 4)).toEqual({ correct: true, score: 50 })
    expect(gradeNBack(1, 0, 4)).toEqual({ correct: false, score: 25 })
  })

  it('lets false alarms cancel out hits', () => {
    const result = gradeNBack(3, 2, 4)
    expect(result.correct).toBe(false) // net 1, needs >= 2
    expect(result.score).toBe(25) // round(100 * 1 / 4)
  })

  it('clamps the score to [0, 100]', () => {
    expect(gradeNBack(0, 5, 4).score).toBe(0)
    expect(gradeNBack(10, 0, 4).score).toBe(100)
  })

  it('handles zero planted matches without dividing by zero, and never grades it correct', () => {
    expect(gradeNBack(0, 0, 0)).toEqual({ correct: false, score: 0 })
    expect(gradeNBack(0, 2, 0)).toEqual({ correct: false, score: 0 })
  })
})

describe('computeAccuracy', () => {
  it('is 1 for an exact match', () => {
    expect(computeAccuracy('abc', 'abc')).toBe(1)
  })

  it('counts matching characters at each position over the snippet length', () => {
    expect(computeAccuracy('abx', 'abc')).toBeCloseTo(2 / 3)
    expect(computeAccuracy('a', 'abc')).toBeCloseTo(1 / 3)
    expect(computeAccuracy('', 'abc')).toBe(0)
  })

  it('does not reward extra characters typed past the snippet length', () => {
    expect(computeAccuracy('abcdef', 'abc')).toBe(1)
  })

  it('treats an empty snippet as fully accurate only when nothing was typed', () => {
    expect(computeAccuracy('', '')).toBe(1)
    expect(computeAccuracy('x', '')).toBe(0)
  })
})

describe('gradeSpeedType', () => {
  it('is correct at or above 95 percent accuracy', () => {
    const exact = gradeSpeedType('numbers = [1, 2, 3]', 'numbers = [1, 2, 3]')
    expect(exact.correct).toBe(true)
    expect(exact.score).toBe(100)
  })

  it('is incorrect below 95 percent accuracy', () => {
    const result = gradeSpeedType('abcdefghij', 'abcdefghij'.slice(0, 9) + 'X') // 9/10 match = 90%
    expect(result.accuracy).toBeCloseTo(0.9)
    expect(result.correct).toBe(false)
    expect(result.score).toBe(90)
  })
})

describe('clamp', () => {
  it('bounds a value to the given range', () => {
    expect(clamp(0, 100, -5)).toBe(0)
    expect(clamp(0, 100, 150)).toBe(100)
    expect(clamp(0, 100, 42)).toBe(42)
  })
})

describe('comboMultiplier', () => {
  it('is 1x, 1.2x, 1.5x, 2x for streak 1 through 4', () => {
    expect(comboMultiplier(1)).toBe(1)
    expect(comboMultiplier(2)).toBe(1.2)
    expect(comboMultiplier(3)).toBe(1.5)
    expect(comboMultiplier(4)).toBe(2)
  })

  it('caps at 2x for any streak beyond 4', () => {
    expect(comboMultiplier(5)).toBe(2)
    expect(comboMultiplier(100)).toBe(2)
  })

  it('is 1x for a streak of zero or negative (no bonus yet)', () => {
    expect(comboMultiplier(0)).toBe(1)
    expect(comboMultiplier(-1)).toBe(1)
  })
})

describe('nextComboStreak', () => {
  it('extends the streak by one on a correct answer', () => {
    expect(nextComboStreak(0, true)).toBe(1)
    expect(nextComboStreak(3, true)).toBe(4)
  })

  it('resets to zero on a miss, regardless of the prior streak', () => {
    expect(nextComboStreak(3, false)).toBe(0)
    expect(nextComboStreak(0, false)).toBe(0)
  })
})

describe('weightedItemScore', () => {
  it('applies the combo multiplier for the streak reached on a correct answer', () => {
    expect(weightedItemScore(100, 1, true)).toBe(100)
    expect(weightedItemScore(100, 2, true)).toBe(120)
    expect(weightedItemScore(100, 4, true)).toBe(200)
  })

  it('never applies a bonus on a miss, even if a streak number is passed in error', () => {
    expect(weightedItemScore(0, 3, false)).toBe(0)
    expect(weightedItemScore(40, 3, false)).toBe(40)
  })
})

describe('normalizeFollowTheDot', () => {
  it('scales the 0..1 share of frames inside the dot to a 0..100 score, and 0..1000 raw', () => {
    expect(normalizeFollowTheDot(1)).toEqual({ raw: 1000, score: 100 })
    expect(normalizeFollowTheDot(0)).toEqual({ raw: 0, score: 0 })
    expect(normalizeFollowTheDot(0.5)).toEqual({ raw: 500, score: 50 })
  })

  it('clamps an out-of-range share rather than producing a score outside [0, 100]', () => {
    expect(normalizeFollowTheDot(1.5).score).toBe(100)
    expect(normalizeFollowTheDot(-0.2).score).toBe(0)
  })
})

describe('normalizeColorNBack', () => {
  it('is the percentage of net hits over the plantable matches, matching gradeNBack in spirit', () => {
    expect(normalizeColorNBack(4, 0, 4)).toEqual({ raw: 400, score: 100 })
    expect(normalizeColorNBack(2, 0, 4)).toEqual({ raw: 200, score: 50 })
  })

  it('lets false alarms pull the score down, and clamps at the floor', () => {
    const result = normalizeColorNBack(0, 5, 4)
    expect(result.raw).toBe(-500)
    expect(result.score).toBe(0)
  })

  it('is 0 when nothing was plantable, without dividing by zero', () => {
    expect(normalizeColorNBack(0, 0, 0)).toEqual({ raw: 0, score: 0 })
  })
})

describe('normalizeReaction', () => {
  it('is 10000 minus the mean reaction ms, scaled down by 100', () => {
    expect(normalizeReaction(0)).toEqual({ raw: 10000, score: 100 })
    expect(normalizeReaction(8000)).toEqual({ raw: 2000, score: 20 })
  })

  it('floors at 0 for a reaction time slower than 10000ms', () => {
    expect(normalizeReaction(12000)).toEqual({ raw: 0, score: 0 })
  })
})

describe('normalizeRhythm', () => {
  it('inverts the mean absolute offset against the tolerance window', () => {
    expect(normalizeRhythm(0, 500)).toEqual({ raw: 500, score: 100 })
    expect(normalizeRhythm(250, 500)).toEqual({ raw: 250, score: 50 })
  })

  it('is 0 for an offset at or beyond the tolerance window', () => {
    expect(normalizeRhythm(500, 500)).toEqual({ raw: 0, score: 0 })
    expect(normalizeRhythm(900, 500)).toEqual({ raw: 0, score: 0 })
  })

  it('uses the exported default tolerance when none is given', () => {
    expect(normalizeRhythm(0).score).toBe(100)
  })
})

describe('normalizeBreathe', () => {
  it('mirrors the completion percentage directly, since breathe cannot be failed', () => {
    expect(normalizeBreathe(100)).toEqual({ raw: 100, score: 100 })
    expect(normalizeBreathe(42)).toEqual({ raw: 42, score: 42 })
    expect(normalizeBreathe(0)).toEqual({ raw: 0, score: 0 })
  })
})

describe('normalizeMemoryGrid', () => {
  it('scales rounds cleared against the max-rounds ceiling', () => {
    expect(normalizeMemoryGrid(12, 12)).toEqual({ raw: 3000, score: 100 })
    expect(normalizeMemoryGrid(6, 12)).toEqual({ raw: 1500, score: 50 })
  })

  it('clamps a rounds-cleared count beyond the ceiling to 100', () => {
    expect(normalizeMemoryGrid(20, 12).score).toBe(100)
  })

  it('uses the exported default ceiling when none is given', () => {
    expect(normalizeMemoryGrid(0).raw).toBe(0)
  })
})
