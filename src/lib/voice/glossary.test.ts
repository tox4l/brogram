import { describe, expect, it } from 'vitest'
import {
  angleWord,
  attemptWord,
  chainWord,
  difficultyWord,
  flagsWord,
  masteryWord,
  repWord,
  skillDescriptionWord,
  skillLockedWord,
  skillWord,
  walkthroughWord,
} from './glossary'

describe('skillWord', () => {
  it('translates CLO / learning outcome to "skill"', () => {
    expect(skillWord()).toBe('skill')
  })
})

describe('skillDescriptionWord', () => {
  it('translates the Clo.outcome sentence to "what this skill is"', () => {
    expect(skillDescriptionWord()).toBe('what this skill is')
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

  it('clamps out-of-range input instead of shipping "7 of 3 in a row"', () => {
    expect(chainWord(0)).toBe('1 of 3 in a row')
    expect(chainWord(7)).toBe('3 of 3 in a row')
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

describe('skillLockedWord', () => {
  it('translates CLO closed to "skill locked"', () => {
    expect(skillLockedWord()).toBe('skill locked')
  })

  it('never says "CLO" to a learner', () => {
    expect(skillLockedWord()).not.toMatch(/\bCLO\b/i)
  })
})

describe('angleWord', () => {
  it('translates pattern to "angle"', () => {
    expect(angleWord()).toBe('angle')
  })

  it('never says "pattern" to a learner', () => {
    expect(angleWord()).not.toMatch(/\bpattern\b/i)
  })
})

describe('repWord', () => {
  it('translates bank / exercise to "rep"', () => {
    expect(repWord()).toBe('rep')
  })
})

describe('walkthroughWord', () => {
  it('translates lesson to "walkthrough"', () => {
    expect(walkthroughWord()).toBe('walkthrough')
  })
})

describe('attemptWord', () => {
  it('translates attempt to "run" (free) or "submit" (graded)', () => {
    expect(attemptWord('free')).toBe('run')
    expect(attemptWord('graded')).toBe('submit')
  })
})

describe('flagsWord', () => {
  it('translates integrity score to "flags"', () => {
    expect(flagsWord()).toBe('flags')
  })
})

describe('every glossary word passes the nine voice rules (fix round 1, M7 / item 10)', () => {
  const EMOJI = /\p{Extended_Pictographic}/u
  const BANNED = ['outcome', 'CLO', 'mastery', 'chain', 'pattern', 'difficulty']
  const INSTITUTION_NAMES = ['UDST', 'University', 'Qatar', 'College']

  const outputs: string[] = [
    skillWord(),
    skillDescriptionWord(),
    masteryWord(),
    skillLockedWord(),
    chainWord(1),
    chainWord(2),
    chainWord(3),
    angleWord(),
    difficultyWord(1),
    difficultyWord(2),
    difficultyWord(3),
    difficultyWord(4),
    difficultyWord(5),
    repWord(),
    walkthroughWord(),
    attemptWord('free'),
    attemptWord('graded'),
    flagsWord(),
  ]

  it('is 12 words or fewer, has no emoji, never opens with "Your ", and names no institution', () => {
    for (const text of outputs) {
      expect(text.split(/\s+/).length, text).toBeLessThanOrEqual(12)
      expect(EMOJI.test(text), text).toBe(false)
      expect(text.startsWith('Your '), text).toBe(false)
      for (const name of INSTITUTION_NAMES) expect(text.includes(name), text).toBe(false)
    }
  })

  it('carries none of the internal words it exists to replace', () => {
    // masteryWord/skillLockedWord/angleWord/chainWord legitimately produce
    // the *translation* of a banned word, never the word itself — checked
    // individually above. Here we confirm none of the raw internal terms
    // leak through verbatim across the whole set.
    for (const text of outputs) {
      for (const word of BANNED) {
        expect(new RegExp(`\\b${word}\\b`, 'i').test(text), `${text} contains "${word}"`).toBe(false)
      }
    }
  })
})
