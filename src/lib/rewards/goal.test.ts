import { describe, expect, it } from 'vitest'
import { DEFAULT_WELLNESS, type DrillResult, type LearnerState, type LessonProgress } from '@/lib/contracts'
import type { RewardAttempt, RewardContext } from './context'
import { goalMet, levelBand, winsToday } from './goal'

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

function ctx(over: Partial<RewardContext> = {}): RewardContext {
  return {
    state: learnerState(),
    attempts: [],
    activityDays: [],
    lessonProgress: [],
    drillResults: [],
    prefs: DEFAULT_WELLNESS,
    courseLessonCounts: {},
    today: '2026-09-06',
    ...over,
  }
}

let attemptSeq = 0
function attempt(over: Partial<RewardAttempt> = {}): RewardAttempt {
  attemptSeq += 1
  return {
    id: `attempt-${attemptSeq}`,
    userId: 'user-1',
    exerciseId: `ex-${attemptSeq}`,
    code: '',
    results: [],
    passed: true,
    durationMs: 1000,
    hintCount: 0,
    createdAt: '2026-09-06T10:00:00.000Z',
    ...over,
  }
}

function lessonProgress(over: Partial<LessonProgress> = {}): LessonProgress {
  return {
    userId: 'user-1',
    lessonId: 'INFS1101-1',
    cloId: 'INFS1101-1',
    status: 'completed',
    blockIndex: 5,
    checksPassed: 3,
    checksFailed: 0,
    lessonVersion: 1,
    startedAt: '2026-09-06T09:00:00.000Z',
    completedAt: '2026-09-06T09:30:00.000Z',
    updatedAt: '2026-09-06T09:30:00.000Z',
    ...over,
  }
}

let drillSeq = 0
function drillResult(over: Partial<DrillResult> = {}): DrillResult {
  drillSeq += 1
  return {
    drillId: `drill-${drillSeq}`,
    kind: 'predict-output',
    correct: true,
    timeMs: 5000,
    score: 80,
    at: '2026-09-06T10:00:00.000Z',
    lane: 'arcade',
    ...over,
  }
}

describe('winsToday', () => {
  it('counts a passed exercise dated today', () => {
    expect(winsToday(ctx({ attempts: [attempt({ passed: true, createdAt: '2026-09-06T10:00:00.000Z' })] }))).toBe(1)
  })

  it('does not count a passed exercise from a different day', () => {
    expect(winsToday(ctx({ attempts: [attempt({ passed: true, createdAt: '2026-09-05T10:00:00.000Z' })] }))).toBe(0)
  })

  it('never counts a failed attempt as a win, whatever day it landed on', () => {
    expect(winsToday(ctx({ attempts: [attempt({ passed: false, createdAt: '2026-09-06T10:00:00.000Z' })] }))).toBe(0)
  })

  it('counts a walkthrough completed today, and not one merely started', () => {
    expect(winsToday(ctx({ lessonProgress: [lessonProgress({ completedAt: '2026-09-06T09:30:00.000Z' })] }))).toBe(1)
    expect(winsToday(ctx({ lessonProgress: [lessonProgress({ status: 'started', completedAt: null })] }))).toBe(0)
  })

  it('does not count a walkthrough completed on a different day', () => {
    expect(winsToday(ctx({ lessonProgress: [lessonProgress({ completedAt: '2026-09-05T09:30:00.000Z' })] }))).toBe(0)
  })

  it('counts a de-rot run dated today in either lane, whether or not it was correct', () => {
    const arcade = drillResult({ lane: 'arcade', correct: false, at: '2026-09-06T10:00:00.000Z' })
    const play = drillResult({ lane: 'play', correct: true, at: '2026-09-06T11:00:00.000Z' })
    expect(winsToday(ctx({ drillResults: [arcade, play] }))).toBe(2)
  })

  it('sums wins across all three sources', () => {
    const context = ctx({
      attempts: [attempt({ passed: true }), attempt({ passed: true }), attempt({ passed: false })],
      lessonProgress: [lessonProgress()],
      drillResults: [drillResult()],
    })
    expect(winsToday(context)).toBe(4)
  })
})

describe('goalMet', () => {
  it('is false below the daily goal', () => {
    const context = ctx({
      prefs: { ...DEFAULT_WELLNESS, dailyGoal: 3 },
      attempts: [attempt({ passed: true }), attempt({ passed: true })],
    })
    expect(goalMet(context)).toBe(false)
  })

  it('is true exactly at the daily goal', () => {
    const context = ctx({
      prefs: { ...DEFAULT_WELLNESS, dailyGoal: 3 },
      attempts: [attempt({ passed: true }), attempt({ passed: true }), attempt({ passed: true })],
    })
    expect(goalMet(context)).toBe(true)
  })

  it('stays true past the goal (going past it is not a different state -- spec 7.4)', () => {
    const context = ctx({
      prefs: { ...DEFAULT_WELLNESS, dailyGoal: 1 },
      attempts: Array.from({ length: 5 }, () => attempt({ passed: true })),
    })
    expect(goalMet(context)).toBe(true)
  })
})

describe('levelBand', () => {
  it('matches every table boundary from spec 7.3', () => {
    expect(levelBand(1)).toBe('Fresh')
    expect(levelBand(4)).toBe('Fresh')
    expect(levelBand(5)).toBe('Wired In')
    expect(levelBand(9)).toBe('Wired In')
    expect(levelBand(10)).toBe('Shipping')
    expect(levelBand(14)).toBe('Shipping')
    expect(levelBand(15)).toBe('Dangerous')
    expect(levelBand(19)).toBe('Dangerous')
    expect(levelBand(20)).toBe('Locked In')
    expect(levelBand(24)).toBe('Locked In')
    expect(levelBand(25)).toBe('Machine')
    expect(levelBand(30)).toBe('Machine')
  })

  it('clamps out-of-range levels rather than returning undefined', () => {
    expect(levelBand(0)).toBe('Fresh')
    expect(levelBand(-5)).toBe('Fresh')
    expect(levelBand(40)).toBe('Machine')
  })
})
