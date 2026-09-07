import { describe, expect, it } from 'vitest'
import { chainWord, difficultyWord, masteryWord, skillWord } from './glossary'

describe('skillWord', () => {
  it('translates CLO / learning outcome to "skill"', () => {
    expect(skillWord()).toBe('skill')
  })
})

describe('difficultyWord', () => {
  it('maps every difficulty 1-5 to its learner-facing word', () => {
    expect(difficultyWord(1)).toBe('easy')
    expect(difficultyWord(2)).toBe('light')
    expect(difficultyWord(3)).toBe('medium')
    expect(difficultyWord(4)).toBe('spicy')
    expect(difficultyWord(5)).toBe('brutal')
  })

  it('never says "difficulty N of 5" to a learner', () => {
    for (const d of [1, 2, 3, 4, 5] as const) {
      expect(difficultyWord(d)).not.toMatch(/difficulty|\d\s+of\s+5/i)
    }
  })
})

describe('chainWord', () => {
  it('translates chain progress to "N of 3 in a row"', () => {
    expect(chainWord(1)).toBe('1 of 3 in a row')
    expect(chainWord(2)).toBe('2 of 3 in a row')
    expect(chainWord(3)).toBe('3 of 3 in a row')
  })

  it('never says "chain" to a learner', () => {
    for (const n of [1, 2, 3]) {
      expect(chainWord(n)).not.toMatch(/\bchain\b/i)
    }
  })
})

describe('masteryWord', () => {
  it('translates mastery score to "how locked in you are"', () => {
    expect(masteryWord()).toBe('how locked in you are')
  })

  it('never says "mastery" to a learner', () => {
    expect(masteryWord()).not.toMatch(/\bmastery\b/i)
  })
})
