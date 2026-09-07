import { describe, expect, it, vi } from 'vitest'
import type { LearnerState } from '@/lib/contracts'
import { REFUSAL as AGENT_REFUSAL } from '@/lib/agents/buddy'
import {
  derotContextFrom,
  handleSuggestionClick,
  LONG_IDLE_GAP_MS,
  pickDerotLane,
  REFUSAL,
  suggestionHref,
} from './state'

describe('suggestionHref', () => {
  it('links an exercise suggestion to the exercise screen', () => {
    expect(suggestionHref('exercise', 'ex-9')).toBe('/exercise/ex-9')
  })

  it('links a derot suggestion to the drill query', () => {
    expect(suggestionHref('derot', 'trace')).toBe('/derot?drill=trace')
  })

  it('points a break suggestion at the dashboard pomodoro anchor when not on an exercise page', () => {
    expect(suggestionHref('break', 'pomodoro')).toBe('#pomodoro')
    expect(suggestionHref('break', 'pomodoro', '/dashboard')).toBe('#pomodoro')
    expect(suggestionHref('break', 'pomodoro', null)).toBe('#pomodoro')
  })

  it('falls back to /dashboard#pomodoro when the current page is an exercise page', () => {
    expect(suggestionHref('break', 'pomodoro', '/exercise')).toBe('/dashboard#pomodoro')
    expect(suggestionHref('break', 'pomodoro', '/exercise/ex-1')).toBe('/dashboard#pomodoro')
  })

  it('links a Playground-lane derot suggestion straight at its runner, bypassing the arcade redirect', () => {
    expect(suggestionHref('derot', 'breathe', undefined, 'play')).toBe('/derot/play/breathe')
  })

  it('keeps the existing arcade deep link when the lane is explicitly arcade or omitted', () => {
    expect(suggestionHref('derot', 'trace', undefined, 'arcade')).toBe('/derot?drill=trace')
    expect(suggestionHref('derot', 'trace')).toBe('/derot?drill=trace')
  })
})

describe('handleSuggestionClick', () => {
  it('closes the drawer before the break chip navigates to the pomodoro anchor', () => {
    const onOpenChange = vi.fn()
    handleSuggestionClick('break', onOpenChange)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onOpenChange).toHaveBeenCalledTimes(1)
  })

  it('leaves the drawer open for exercise and derot chips, which navigate to another screen', () => {
    const onOpenChange = vi.fn()
    handleSuggestionClick('exercise', onOpenChange)
    handleSuggestionClick('derot', onOpenChange)
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('REFUSAL', () => {
  it('re-exports the single fixed refusal sentence owned by the buddy agent module', () => {
    expect(REFUSAL).toBe(AGENT_REFUSAL)
  })
})

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-09-07T12:00:00.000Z')

function mistakeAt(at: string, cloId: LearnerState['recentMistakes'][number]['cloId'] = 'INFS1101-1'): LearnerState['recentMistakes'][number] {
  return { exerciseId: `e-${at}`, cloId, pattern: 'scan', label: 'off-by-one in range', at }
}

function stateFixture(overrides: { recentMistakes: LearnerState['recentMistakes']; updatedAt: string; mastery?: LearnerState['mastery'] }): LearnerState {
  return {
    userId: 'student',
    profile: {
      displayName: 'Student', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: 'growth', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'INFS1101',
    path: ['INFS1101-1'],
    nextExerciseIds: [],
    mastery: overrides.mastery ?? {},
    recentMistakes: overrides.recentMistakes,
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    points: 0,
    integrityScore: 0,
    accountStatus: 'active',
    version: 1,
    updatedAt: overrides.updatedAt,
  }
}

describe('derotContextFrom', () => {
  it('is not a hard failure below three live mistakes inside the window', () => {
    const state = stateFixture({
      recentMistakes: [mistakeAt('2026-09-07T11:55:00.000Z'), mistakeAt('2026-09-07T11:58:00.000Z')],
      updatedAt: '2026-09-07T11:58:00.000Z',
    })
    expect(derotContextFrom(state, NOW).hardFailure).toBe(false)
  })

  it('is a hard failure at three or more mistakes inside the window (a run in progress)', () => {
    const state = stateFixture({
      recentMistakes: [mistakeAt('2026-09-07T11:50:00.000Z'), mistakeAt('2026-09-07T11:55:00.000Z'), mistakeAt('2026-09-07T11:58:00.000Z')],
      updatedAt: '2026-09-07T11:58:00.000Z',
    })
    expect(derotContextFrom(state, NOW).hardFailure).toBe(true)
  })

  it('three OLD mistakes outside the window are not a hard failure, however many are still on record', () => {
    // `recentMistakes` is prepend-only and capped at 10 with no expiry -- a fail from six weeks
    // ago must not read as "a run in progress" forever (C1).
    const sixWeeksAgo = '2026-07-20T00:00:00.000Z'
    const state = stateFixture({
      recentMistakes: [mistakeAt(sixWeeksAgo), mistakeAt(sixWeeksAgo), mistakeAt(sixWeeksAgo)],
      updatedAt: sixWeeksAgo,
    })
    expect(derotContextFrom(state, NOW).hardFailure).toBe(false)
  })

  it('old mistakes plus a long idle gap reach the Arcade arm, not a permanently-dead override', () => {
    const sixWeeksAgo = '2026-07-20T00:00:00.000Z'
    const state = stateFixture({
      recentMistakes: [mistakeAt(sixWeeksAgo), mistakeAt(sixWeeksAgo), mistakeAt(sixWeeksAgo)],
      updatedAt: sixWeeksAgo,
    })
    const context = derotContextFrom(state, NOW)
    expect(context.hardFailure).toBe(false)
    expect(context.idleGapMs).toBeGreaterThanOrEqual(LONG_IDLE_GAP_MS)
    expect(pickDerotLane('trace', context)).toEqual({ lane: 'arcade', ref: 'trace', lineKey: 'buddy.suggest.arcade' })
  })

  it('a pass since the mistake (chain moved off zero) clears it even inside the window', () => {
    const state = stateFixture({
      recentMistakes: [mistakeAt('2026-09-07T11:50:00.000Z'), mistakeAt('2026-09-07T11:55:00.000Z'), mistakeAt('2026-09-07T11:58:00.000Z')],
      updatedAt: '2026-09-07T11:59:00.000Z',
      mastery: { 'INFS1101-1': { userId: 'student', cloId: 'INFS1101-1', score: 60, chain: 1, patternsPassed: ['scan'], closed: false, lastAttemptAt: '2026-09-07T11:59:00.000Z' } },
    })
    expect(derotContextFrom(state, NOW).hardFailure).toBe(false)
  })

  it('a since-closed skill also clears it', () => {
    const state = stateFixture({
      recentMistakes: [mistakeAt('2026-09-07T11:50:00.000Z'), mistakeAt('2026-09-07T11:55:00.000Z'), mistakeAt('2026-09-07T11:58:00.000Z')],
      updatedAt: '2026-09-07T11:59:00.000Z',
      mastery: { 'INFS1101-1': { userId: 'student', cloId: 'INFS1101-1', score: 100, chain: 0, patternsPassed: ['scan', 'trace', 'loop'], closed: true, lastAttemptAt: '2026-09-07T11:59:00.000Z' } },
    })
    expect(derotContextFrom(state, NOW).hardFailure).toBe(false)
  })

  it('measures the idle gap from updatedAt to the given instant', () => {
    const state = stateFixture({ recentMistakes: [], updatedAt: '2026-09-07T10:00:00.000Z' })
    expect(derotContextFrom(state, NOW).idleGapMs).toBe(2 * HOUR)
  })
})

describe('pickDerotLane', () => {
  it('frames a hard failure as a Playground nudge, defaulting to Breathe since the agent only ever sends an arcade ref', () => {
    const result = pickDerotLane('trace', { hardFailure: true, idleGapMs: 0 })
    expect(result).toEqual({ lane: 'play', ref: 'breathe', lineKey: 'buddy.suggest.play' })
  })

  it('keeps the agent-chosen ref when a hard failure already points at a Playground id', () => {
    const result = pickDerotLane('memory-grid', { hardFailure: true, idleGapMs: 0 })
    expect(result).toEqual({ lane: 'play', ref: 'memory-grid', lineKey: 'buddy.suggest.play' })
  })

  it('frames a long idle gap as an Arcade nudge, keeping the agent-chosen arcade ref', () => {
    const result = pickDerotLane('trace', { hardFailure: false, idleGapMs: LONG_IDLE_GAP_MS })
    expect(result).toEqual({ lane: 'arcade', ref: 'trace', lineKey: 'buddy.suggest.arcade' })
  })

  it('falls back to a default arcade ref for a long idle gap if the ref is somehow a Playground id', () => {
    const result = pickDerotLane('breathe', { hardFailure: false, idleGapMs: LONG_IDLE_GAP_MS })
    expect(result).toEqual({ lane: 'arcade', ref: 'predict-output', lineKey: 'buddy.suggest.arcade' })
  })

  it('prioritises a hard failure over a simultaneous long idle gap', () => {
    const result = pickDerotLane('trace', { hardFailure: true, idleGapMs: LONG_IDLE_GAP_MS })
    expect(result.lineKey).toBe('buddy.suggest.play')
  })

  it('picks the ref\'s own natural lane with no special copy when neither signal fires', () => {
    expect(pickDerotLane('trace', { hardFailure: false, idleGapMs: 0 })).toEqual({ lane: 'arcade', ref: 'trace' })
    expect(pickDerotLane('breathe', { hardFailure: false, idleGapMs: 0 })).toEqual({ lane: 'play', ref: 'breathe' })
  })
})
