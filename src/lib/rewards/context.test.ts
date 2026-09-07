import { describe, expect, it } from 'vitest'
import type { LearnerState } from '@/lib/contracts'
import { DEFAULT_WELLNESS, levelForXp, pointsForPass, xpToReach } from '@/lib/contracts'
import { ATTEMPTS_WINDOW, DRILL_RESULTS_WINDOW, buildRewardContext, utcDateKey, type BuildRewardContextArgs, type RewardAttempt } from './context'

function learnerState(over: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'user-1',
    profile: {
      displayName: 'Test',
      learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'direct',
      verbosity: 'short',
      motivation: { why: '', beyondCourses: false, depth: 'pass', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'INFS1101',
    path: [],
    nextExerciseIds: [],
    mastery: {},
    recentMistakes: [],
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0,
    integrityScore: 0,
    accountStatus: 'active',
    version: 1,
    updatedAt: '2026-09-06T00:00:00.000Z',
    ...over,
  }
}

function attempt(id: string, createdAt: string, over: Partial<RewardAttempt> = {}): RewardAttempt {
  return {
    id,
    userId: 'user-1',
    exerciseId: `ex-${id}`,
    code: '',
    results: [],
    passed: true,
    durationMs: 1000,
    hintCount: 0,
    createdAt,
    ...over,
  }
}

function baseArgs(over: Partial<BuildRewardContextArgs> = {}): BuildRewardContextArgs {
  return {
    state: learnerState(),
    attempts: [],
    activityDays: [],
    lessonProgress: [],
    drillResults: [],
    prefs: DEFAULT_WELLNESS,
    courseLessonCounts: {},
    now: new Date('2026-09-06T12:00:00.000Z'),
    ...over,
  }
}

describe('utcDateKey', () => {
  it('reads the calendar day exactly as written, no timezone shift', () => {
    expect(utcDateKey('2026-09-06T23:59:59.999Z')).toBe('2026-09-06')
    expect(utcDateKey('2026-01-01T00:00:00.000Z')).toBe('2026-01-01')
  })

  it('returns null for a string with no leading date', () => {
    expect(utcDateKey('not-a-date')).toBeNull()
    expect(utcDateKey('')).toBeNull()
  })
})

describe('buildRewardContext', () => {
  it('assembles every field from the args, deriving today from now', () => {
    const state = learnerState({ points: 500 })
    const ctx = buildRewardContext(baseArgs({ state, now: new Date('2026-09-06T08:30:00.000Z') }))

    expect(ctx.state).toBe(state)
    expect(ctx.today).toBe('2026-09-06')
    expect(ctx.attempts).toEqual([])
    expect(ctx.activityDays).toEqual([])
    expect(ctx.lessonProgress).toEqual([])
    expect(ctx.drillResults).toEqual([])
    expect(ctx.courseLessonCounts).toEqual({})
  })

  it('caps attempts at ATTEMPTS_WINDOW, keeping the first (most recent) entries', () => {
    const many = Array.from({ length: ATTEMPTS_WINDOW + 10 }, (_, i) => attempt(`a${i}`, '2026-09-06T00:00:00.000Z'))
    const ctx = buildRewardContext(baseArgs({ attempts: many }))

    expect(ctx.attempts).toHaveLength(ATTEMPTS_WINDOW)
    expect(ctx.attempts[0]).toBe(many[0])
    expect(ctx.attempts[ATTEMPTS_WINDOW - 1]).toBe(many[ATTEMPTS_WINDOW - 1])
  })

  it('does not cap attempts when the window is not exceeded', () => {
    const few = [attempt('a1', '2026-09-06T00:00:00.000Z')]
    const ctx = buildRewardContext(baseArgs({ attempts: few }))
    expect(ctx.attempts).toHaveLength(1)
  })

  it('caps drillResults at DRILL_RESULTS_WINDOW, keeping the last (most recent) entries', () => {
    const many = Array.from({ length: DRILL_RESULTS_WINDOW + 5 }, (_, i) => ({
      drillId: `d${i}`,
      kind: 'predict-output' as const,
      correct: true,
      timeMs: 1000,
      score: 80,
      at: '2026-09-06T00:00:00.000Z',
      lane: 'arcade' as const,
    }))
    const ctx = buildRewardContext(baseArgs({ drillResults: many }))

    expect(ctx.drillResults).toHaveLength(DRILL_RESULTS_WINDOW)
    // The oldest 5 (the head) were trimmed; the tail survives.
    expect(ctx.drillResults[0]).toBe(many[5])
    expect(ctx.drillResults[ctx.drillResults.length - 1]).toBe(many[many.length - 1])
  })
})

// ---------------------------------------------------------------------------
// The XP arithmetic the spec's critic pass corrected (acceptance block).
// pointsForPass / xpToReach / levelForXp are frozen in src/lib/contracts.ts;
// these pin the exact scenarios that used to be wrong, since XP is what
// achievements read (`level-five`, `machine`) and what the UI renders as XP.
// ---------------------------------------------------------------------------

describe('XP arithmetic (spec R7.1/R7.2/R7.3, critic-corrected)', () => {
  it('a medium pass with no hints and neutral quality is 335 XP', () => {
    expect(pointsForPass(3, 0, 70)).toBe(335)
  })

  it('four medium passes (1,340 XP) do not reach level 3 (1,400 XP)', () => {
    const totalXp = pointsForPass(3, 0, 70) * 4
    expect(totalXp).toBe(1340)
    expect(xpToReach(3)).toBe(1400)
    expect(levelForXp(totalXp)).toBe(2)
  })

  it('a difficulty-5 pass with no hints at quality 90 is 545 XP', () => {
    expect(pointsForPass(5, 0, 90)).toBe(545)
  })

  it('the Reviewer moves a neutral-70 estimate by +15 at best and -35 at worst', () => {
    const neutral = pointsForPass(3, 0, 70)
    const best = pointsForPass(3, 0, 100)
    const worst = pointsForPass(3, 0, 0)
    expect(best - neutral).toBe(15)
    expect(worst - neutral).toBe(-35)
  })
})
