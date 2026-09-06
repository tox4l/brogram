import { describe, expect, it } from 'vitest'
import { recordGoalDay, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { ACHIEVEMENTS, DEFAULT_WELLNESS, levelForXp, MAX_LEVEL, xpToReach } from './contracts'
import type { Lesson, LessonCheck, LessonPublic, LessonPublicBlock, LessonSnippet } from './contracts'

describe('xpToReach', () => {
  it('pins the exact cumulative XP curve', () => {
    expect(xpToReach(1)).toBe(0)
    expect(xpToReach(2)).toBe(500)
    expect(xpToReach(3)).toBe(1400)
    expect(xpToReach(5)).toBe(4000)
    expect(xpToReach(10)).toBe(13500)
    expect(xpToReach(30)).toBe(78100)
    expect(xpToReach(31)).toBe(xpToReach(30))
  })

  it('is monotonic (non-decreasing) over the whole level range', () => {
    for (let level = 1; level < MAX_LEVEL + 1; level += 1) {
      expect(xpToReach(level + 1)).toBeGreaterThanOrEqual(xpToReach(level))
    }
  })
})

describe('levelForXp', () => {
  it('pins the exact boundaries', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(499)).toBe(1)
    expect(levelForXp(500)).toBe(2)
    // Four medium passes (350 XP each per pointsForPass at difficulty 3) do NOT
    // reach level 3 -- the spec's own corrected arithmetic.
    expect(levelForXp(1339)).toBe(2)
    expect(levelForXp(1400)).toBe(3)
    expect(levelForXp(10_000_000)).toBe(30)
    expect(levelForXp(-5)).toBe(1)
    expect(levelForXp(NaN)).toBe(1)
  })
})

describe('ACHIEVEMENTS', () => {
  it('has exactly 20 entries', () => {
    expect(ACHIEVEMENTS).toHaveLength(20)
  })

  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has unique ordinals covering exactly 1..20', () => {
    const ordinals = ACHIEVEMENTS.map((a) => a.ordinal).sort((a, b) => a - b)
    expect(ordinals).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('keeps every name to at most 3 words', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.name.trim().split(/\s+/).length).toBeLessThanOrEqual(3)
    }
  })

  it('keeps every line to at most 12 words', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.line.trim().split(/\s+/).length).toBeLessThanOrEqual(12)
    }
  })

  it('is always visible when locked -- nothing is a mystery box', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.visibleWhenLocked).toBe(true)
    }
  })

  it('never opens name, line, or how with "Your "', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.name.startsWith('Your ')).toBe(false)
      expect(achievement.line.startsWith('Your ')).toBe(false)
      expect(achievement.how.startsWith('Your ')).toBe(false)
    }
  })

  it('carries no emoji anywhere in its copy', () => {
    const emoji = /\p{Extended_Pictographic}/u
    for (const achievement of ACHIEVEMENTS) {
      expect(emoji.test(achievement.name)).toBe(false)
      expect(emoji.test(achievement.line)).toBe(false)
      expect(emoji.test(achievement.how)).toBe(false)
    }
  })
})

describe('DEFAULT_WELLNESS / resolveWellnessPrefs', () => {
  it('round-trips through a JSON cycle unchanged', () => {
    expect(resolveWellnessPrefs(JSON.parse(JSON.stringify(DEFAULT_WELLNESS)))).toEqual(DEFAULT_WELLNESS)
  })

  it('returns the full shape for a pre-v2 stored row, defaulting dock.placement', () => {
    const resolved = resolveWellnessPrefs({ waterIntervalMin: 30 })
    expect(resolved.dock.placement).toBe('right')
  })

  it('deep-merges dock rather than shallow-spreading it', () => {
    expect(resolveWellnessPrefs({ dock: { placement: 'left' } }).dock.collapsed).toBe(false)
  })

  it('clamps dailyGoal and sound.volume into range', () => {
    expect(resolveWellnessPrefs({ dailyGoal: 99 }).dailyGoal).toBe(10)
    expect(resolveWellnessPrefs({ dailyGoal: 0 }).dailyGoal).toBe(1)
    expect(resolveWellnessPrefs({ sound: { volume: 5 } }).sound.volume).toBe(1)
  })
})

describe('recordGoalDay', () => {
  it('dedupes a repeated day and caps the window at 120, newest last', () => {
    expect(recordGoalDay(['2026-09-05'], '2026-09-05')).toEqual(['2026-09-05'])
    const days = Array.from({ length: 120 }, (_, i) => `d${i}`)
    const result = recordGoalDay(days, 'd0')
    expect(result).toHaveLength(120)
    expect(result[result.length - 1]).toBe('d0')
  })
})

describe('LessonPublicBlock / LessonPublic secrecy (type-level, review C1)', () => {
  it('does not let a full snippet, a full micro-code check, or a full lesson satisfy the public types', () => {
    const fullSnippet: LessonSnippet = {
      type: 'snippet',
      id: 's1',
      language: 'python',
      code: 'print(1)',
      runnable: true,
      expectedStdout: '1',
    }
    const fullMicroCode: Extract<LessonCheck, { kind: 'micro-code' }> = {
      type: 'check',
      id: 'c1',
      kind: 'micro-code',
      prompt: 'p',
      language: 'python',
      starterCode: '',
      tests: [],
      referenceSolution: 'SECRET',
      hint: 'h',
      explain: 'e',
    }
    const fullLesson: Lesson = {
      id: 'INFS1101-1',
      cloId: 'INFS1101-1',
      course: 'INFS1101',
      language: 'python',
      version: 1,
      title: 't',
      hook: 'h',
      estimatedMinutes: 5,
      draft: false,
      tags: [],
      blocks: [fullMicroCode],
      exitLine: 'e',
    }

    // @ts-expect-error a full LessonSnippet (carrying expectedStdout) must not satisfy LessonPublicBlock
    const publicSnippet: LessonPublicBlock = fullSnippet
    // @ts-expect-error a full micro-code LessonCheck (carrying referenceSolution) must not satisfy LessonPublicBlock
    const publicCheck: LessonPublicBlock = fullMicroCode
    // @ts-expect-error a full Lesson (its blocks carry referenceSolution) must not satisfy LessonPublic
    const publicLesson: LessonPublic = fullLesson

    // Real usage so this stays a live compile check, not dead code a linter flags.
    expect([publicSnippet, publicCheck, publicLesson]).toHaveLength(3)
  })
})
