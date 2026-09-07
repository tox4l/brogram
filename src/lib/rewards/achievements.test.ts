import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, DEFAULT_WELLNESS, type DrillResult, type LearnerState, type LessonProgress, type Mastery } from '@/lib/contracts'
import type { RewardAttempt, RewardContext } from './context'
import { PREDICATES, newlyUnlocked } from './achievements'

// ---------------------------------------------------------------------------
// Fixtures. Kept local and small, matching the style of the other pure
// modules in src/lib/learner -- every test builds only the corner of
// RewardContext its own predicate reads.
// ---------------------------------------------------------------------------

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

function mastery(over: Partial<Mastery> = {}): Mastery {
  return {
    userId: 'user-1',
    cloId: 'INFS1101-1',
    score: 0,
    chain: 0,
    patternsPassed: [],
    closed: false,
    lastAttemptAt: null,
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
    passed: false,
    durationMs: 30_000,
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

// ---------------------------------------------------------------------------
// Structural guarantees
// ---------------------------------------------------------------------------

describe('PREDICATES', () => {
  it('has exactly one predicate per ACHIEVEMENTS id', () => {
    expect(Object.keys(PREDICATES).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort())
  })

  it('is total: every predicate returns a boolean on an empty context and never throws', () => {
    const empty = ctx()
    for (const [id, predicate] of Object.entries(PREDICATES)) {
      let result: unknown
      expect(() => {
        result = predicate(empty)
      }, id).not.toThrow()
      expect(typeof result, id).toBe('boolean')
    }
  })
})

// ---------------------------------------------------------------------------
// The twenty, one positive and one negative case each.
// ---------------------------------------------------------------------------

describe('first-blood', () => {
  it('fires on any passed attempt', () => {
    expect(PREDICATES['first-blood'](ctx({ attempts: [attempt({ passed: true })] }))).toBe(true)
  })
  it('does not fire with no passed attempt', () => {
    expect(PREDICATES['first-blood'](ctx({ attempts: [attempt({ passed: false })] }))).toBe(false)
  })
})

describe('no-wheels', () => {
  it('fires on a zero-hint pass at medium difficulty or harder', () => {
    expect(PREDICATES['no-wheels'](ctx({ attempts: [attempt({ passed: true, hintCount: 0, difficulty: 3 })] }))).toBe(true)
    expect(PREDICATES['no-wheels'](ctx({ attempts: [attempt({ passed: true, hintCount: 0, difficulty: 5 })] }))).toBe(true)
  })
  it('does not fire below medium difficulty, with hints, or with unknown difficulty', () => {
    expect(PREDICATES['no-wheels'](ctx({ attempts: [attempt({ passed: true, hintCount: 0, difficulty: 2 })] }))).toBe(false)
    expect(PREDICATES['no-wheels'](ctx({ attempts: [attempt({ passed: true, hintCount: 1, difficulty: 5 })] }))).toBe(false)
    expect(PREDICATES['no-wheels'](ctx({ attempts: [attempt({ passed: true, hintCount: 0 })] }))).toBe(false)
  })
})

describe('three-angles', () => {
  it('fires the moment any skill is closed', () => {
    expect(PREDICATES['three-angles'](ctx({ state: learnerState({ mastery: { 'INFS1101-1': mastery({ closed: true }) } }) }))).toBe(true)
  })
  it('does not fire while every skill is still open', () => {
    expect(PREDICATES['three-angles'](ctx({ state: learnerState({ mastery: { 'INFS1101-1': mastery({ chain: 2 }) } }) }))).toBe(false)
  })
})

describe('five-locked', () => {
  const closedMastery = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`INFS1101-${i}`, mastery({ cloId: `INFS1101-${i}`, closed: true })]))

  it('fires at five closed skills', () => {
    expect(PREDICATES['five-locked'](ctx({ state: learnerState({ mastery: closedMastery(5) }) }))).toBe(true)
  })
  it('does not fire at four', () => {
    expect(PREDICATES['five-locked'](ctx({ state: learnerState({ mastery: closedMastery(4) }) }))).toBe(false)
  })
})

describe('course-clear', () => {
  it('fires when every CLO on the path is closed', () => {
    const state = learnerState({
      path: ['INFS1101-1', 'INFS1101-2'],
      mastery: { 'INFS1101-1': mastery({ cloId: 'INFS1101-1', closed: true }), 'INFS1101-2': mastery({ cloId: 'INFS1101-2', closed: true }) },
    })
    expect(PREDICATES['course-clear'](ctx({ state }))).toBe(true)
  })
  it('does not fire when one CLO on the path is still open, or the path is empty', () => {
    const partial = learnerState({
      path: ['INFS1101-1', 'INFS1101-2'],
      mastery: { 'INFS1101-1': mastery({ cloId: 'INFS1101-1', closed: true }), 'INFS1101-2': mastery({ cloId: 'INFS1101-2', closed: false }) },
    })
    expect(PREDICATES['course-clear'](ctx({ state: partial }))).toBe(false)
    expect(PREDICATES['course-clear'](ctx({ state: learnerState({ path: [] }) }))).toBe(false)
  })
})

describe('read-the-manual', () => {
  it('fires at five completed walkthroughs', () => {
    const rows = Array.from({ length: 5 }, (_, i) => lessonProgress({ lessonId: `L${i}`, cloId: `INFS1101-${i}` }))
    expect(PREDICATES['read-the-manual'](ctx({ lessonProgress: rows }))).toBe(true)
  })
  it('does not fire at four', () => {
    const rows = Array.from({ length: 4 }, (_, i) => lessonProgress({ lessonId: `L${i}`, cloId: `INFS1101-${i}` }))
    expect(PREDICATES['read-the-manual'](ctx({ lessonProgress: rows }))).toBe(false)
  })
})

describe('full-read', () => {
  // INFS1101 has exactly four CLOs in the real static curriculum (INFS1101-1..4).
  const allFour = ['INFS1101-1', 'INFS1101-2', 'INFS1101-3', 'INFS1101-4'].map((cloId) =>
    lessonProgress({ lessonId: cloId, cloId, status: 'completed' }),
  )

  it('fires once every lesson in a course is completed', () => {
    expect(PREDICATES['full-read'](ctx({ lessonProgress: allFour, courseLessonCounts: { INFS1101: 4 } }))).toBe(true)
  })
  it('does not fire while a lesson in that course is still incomplete', () => {
    expect(PREDICATES['full-read'](ctx({ lessonProgress: allFour.slice(0, 3), courseLessonCounts: { INFS1101: 4 } }))).toBe(false)
  })

  it('trusts courseLessonCounts as the authoritative denominator, whatever the caller decided to count (Minor 2)', () => {
    // The caller's contract is to exclude draft-only lessons before handing
    // this a total; the predicate itself never re-derives the count from the
    // curriculum, so a denominator of 1 is satisfied by exactly one completed row.
    const oneNonDraftLesson = [lessonProgress({ lessonId: 'INFS1101-1', cloId: 'INFS1101-1', status: 'completed' })]
    expect(PREDICATES['full-read'](ctx({ lessonProgress: oneNonDraftLesson, courseLessonCounts: { INFS1101: 1 } }))).toBe(true)
  })
})

describe('comeback', () => {
  // ctx.attempts is documented as most-recent-first (context.ts), so a real
  // fail-fail-fail-then-pass sequence is stored newest (the pass) first,
  // oldest (the first fail) last -- exactly the reverse of how someone would
  // naturally list them out.

  it('fires on a pass after three or more OLDER fails on the same exercise', () => {
    const attempts = [
      attempt({ exerciseId: 'ex-1', passed: true }), // newest: the comeback pass
      attempt({ exerciseId: 'ex-1', passed: false }),
      attempt({ exerciseId: 'ex-1', passed: false }),
      attempt({ exerciseId: 'ex-1', passed: false }), // oldest
    ]
    expect(PREDICATES.comeback(ctx({ attempts }))).toBe(true)
  })

  it('does not fire on only two older fails, or fails spread across different exercises', () => {
    const twoFails = [
      attempt({ exerciseId: 'ex-1', passed: true }), // newest
      attempt({ exerciseId: 'ex-1', passed: false }),
      attempt({ exerciseId: 'ex-1', passed: false }), // oldest
    ]
    expect(PREDICATES.comeback(ctx({ attempts: twoFails }))).toBe(false)

    const spread = [
      attempt({ exerciseId: 'ex-1', passed: false }),
      attempt({ exerciseId: 'ex-2', passed: false }),
      attempt({ exerciseId: 'ex-3', passed: false }),
      attempt({ exerciseId: 'ex-1', passed: true }),
    ]
    expect(PREDICATES.comeback(ctx({ attempts: spread }))).toBe(false)
  })

  it('does not fire when the fails come AFTER the pass -- order matters (Minor 1)', () => {
    // Chronologically the learner passed first, then failed three times --
    // that is not "came back", and must not be confused with it just
    // because the same three-fails-plus-a-pass counts are present.
    const attempts = [
      attempt({ exerciseId: 'ex-1', passed: false }), // newest
      attempt({ exerciseId: 'ex-1', passed: false }),
      attempt({ exerciseId: 'ex-1', passed: false }),
      attempt({ exerciseId: 'ex-1', passed: true }), // oldest: the pass came first
    ]
    expect(PREDICATES.comeback(ctx({ attempts }))).toBe(false)
  })

  it('only reads the given attempts window -- a fail-heavy exercise that scrolled out never fires (spec 7.5 #8 critic)', () => {
    // The window handed in already represents "the last 50"; this pins that
    // comeback reads exactly that window and nothing beyond it.
    const windowedOut = [attempt({ exerciseId: 'ex-1', passed: true })]
    expect(PREDICATES.comeback(ctx({ attempts: windowedOut }))).toBe(false)
  })
})

describe('under-a-minute', () => {
  it('fires on a sub-60s zero-hint pass', () => {
    expect(PREDICATES['under-a-minute'](ctx({ attempts: [attempt({ passed: true, hintCount: 0, durationMs: 59_000 })] }))).toBe(true)
  })
  it('does not fire at 60s or more, or with a hint used', () => {
    expect(PREDICATES['under-a-minute'](ctx({ attempts: [attempt({ passed: true, hintCount: 0, durationMs: 60_000 })] }))).toBe(false)
    expect(PREDICATES['under-a-minute'](ctx({ attempts: [attempt({ passed: true, hintCount: 1, durationMs: 10_000 })] }))).toBe(false)
  })
})

describe('two-tongues', () => {
  // INFS1101 is python, INFS2101 is web -- both real courses in the static curriculum.
  it('fires once CLOs from two different-language courses are touched', () => {
    const state = learnerState({
      mastery: {
        'INFS1101-1': mastery({ cloId: 'INFS1101-1', patternsPassed: ['p1'] }),
        'INFS2101-1': mastery({ cloId: 'INFS2101-1', patternsPassed: ['p2'] }),
      },
    })
    expect(PREDICATES['two-tongues'](ctx({ state }))).toBe(true)
  })
  it('does not fire from CLOs in one course only, or from untouched mastery rows', () => {
    const oneCourse = learnerState({
      mastery: {
        'INFS1101-1': mastery({ cloId: 'INFS1101-1', patternsPassed: ['p1'] }),
        'INFS1101-2': mastery({ cloId: 'INFS1101-2', patternsPassed: ['p2'] }),
      },
    })
    expect(PREDICATES['two-tongues'](ctx({ state: oneCourse }))).toBe(false)

    const untouched = learnerState({
      mastery: { 'INFS1101-1': mastery({ cloId: 'INFS1101-1' }), 'INFS2101-1': mastery({ cloId: 'INFS2101-1' }) },
    })
    expect(PREDICATES['two-tongues'](ctx({ state: untouched }))).toBe(false)
  })

  it('does not fire on two FAILED reps in two different-language courses (Critical 1)', () => {
    // applyFail (src/lib/learner/score.ts) sets lastAttemptAt on every
    // failure too, not only on a pass -- chain stays 0, patternsPassed stays
    // empty, closed stays false. A permanent, unrecoverable wrong unlock
    // (migration 0007 grants user_achievements insert-only) if this ever
    // regresses.
    const twoFailedCourses = learnerState({
      mastery: {
        'INFS1101-1': mastery({ cloId: 'INFS1101-1', chain: 0, patternsPassed: [], closed: false, lastAttemptAt: '2026-09-06T10:00:00.000Z' }),
        'INFS2101-1': mastery({ cloId: 'INFS2101-1', chain: 0, patternsPassed: [], closed: false, lastAttemptAt: '2026-09-06T11:00:00.000Z' }),
      },
    })
    expect(PREDICATES['two-tongues'](ctx({ state: twoFailedCourses }))).toBe(false)
  })

  it('survives a 50-row-aged-out attempts window because it reads mastery, not attempts (spec 7.5 #10 critic)', () => {
    const state = learnerState({
      mastery: {
        'INFS1101-1': mastery({ cloId: 'INFS1101-1', patternsPassed: ['p1'] }),
        'INFS2101-1': mastery({ cloId: 'INFS2101-1', patternsPassed: ['p2'] }),
      },
    })
    // No attempts at all in the window -- the languages still show through mastery.
    expect(PREDICATES['two-tongues'](ctx({ state, attempts: [] }))).toBe(true)
  })
})

describe('pattern-hunter', () => {
  it('fires at ten distinct patterns passed across any skills', () => {
    const patterns = Array.from({ length: 10 }, (_, i) => `pattern-${i}`)
    const state = learnerState({ mastery: { 'INFS1101-1': mastery({ patternsPassed: patterns }) } })
    expect(PREDICATES['pattern-hunter'](ctx({ state }))).toBe(true)
  })
  it('does not fire at nine, even split across skills (Minor 8: the n-1 boundary)', () => {
    const state = learnerState({
      mastery: {
        'INFS1101-1': mastery({ cloId: 'INFS1101-1', patternsPassed: ['a', 'b', 'c', 'd', 'e'] }),
        'INFS1101-2': mastery({ cloId: 'INFS1101-2', patternsPassed: ['f', 'g', 'h', 'i'] }),
      },
    })
    expect(PREDICATES['pattern-hunter'](ctx({ state }))).toBe(false)
  })
})

describe('day-three / week-strong / thirty', () => {
  it('fire at their exact streak thresholds', () => {
    expect(PREDICATES['day-three'](ctx({ state: learnerState({ streak: { exerciseDays: 3, derotDays: 0, lastExerciseDate: null, lastDerotDate: null } }) }))).toBe(true)
    expect(PREDICATES['week-strong'](ctx({ state: learnerState({ streak: { exerciseDays: 7, derotDays: 0, lastExerciseDate: null, lastDerotDate: null } }) }))).toBe(true)
    expect(PREDICATES.thirty(ctx({ state: learnerState({ streak: { exerciseDays: 30, derotDays: 0, lastExerciseDate: null, lastDerotDate: null } }) }))).toBe(true)
  })
  it('do not fire one day short', () => {
    expect(PREDICATES['day-three'](ctx({ state: learnerState({ streak: { exerciseDays: 2, derotDays: 0, lastExerciseDate: null, lastDerotDate: null } }) }))).toBe(false)
    expect(PREDICATES['week-strong'](ctx({ state: learnerState({ streak: { exerciseDays: 6, derotDays: 0, lastExerciseDate: null, lastDerotDate: null } }) }))).toBe(false)
    expect(PREDICATES.thirty(ctx({ state: learnerState({ streak: { exerciseDays: 29, derotDays: 0, lastExerciseDate: null, lastDerotDate: null } }) }))).toBe(false)
  })
})

describe('kept-the-promise', () => {
  it('fires at seven recorded goal days', () => {
    const goalDays = Array.from({ length: 7 }, (_, i) => `2026-09-0${i + 1}`)
    expect(PREDICATES['kept-the-promise'](ctx({ prefs: { ...DEFAULT_WELLNESS, goalDays } }))).toBe(true)
  })
  it('does not fire at six, and cannot be recovered from attempts alone (spec 7.5 #15 / R7.7)', () => {
    const goalDays = Array.from({ length: 6 }, (_, i) => `2026-09-0${i + 1}`)
    expect(PREDICATES['kept-the-promise'](ctx({ prefs: { ...DEFAULT_WELLNESS, goalDays } }))).toBe(false)
    // A big attempts window with no recorded goalDays still cannot fire this.
    const manyAttempts = Array.from({ length: 50 }, () => attempt({ passed: true }))
    expect(PREDICATES['kept-the-promise'](ctx({ attempts: manyAttempts }))).toBe(false)
  })
})

describe('sharp / touch-grass', () => {
  it('fire at ten runs in their own lane', () => {
    const arcadeRuns = Array.from({ length: 10 }, () => drillResult({ lane: 'arcade' }))
    expect(PREDICATES.sharp(ctx({ drillResults: arcadeRuns }))).toBe(true)
    const playRuns = Array.from({ length: 10 }, () => drillResult({ lane: 'play' }))
    expect(PREDICATES['touch-grass'](ctx({ drillResults: playRuns }))).toBe(true)
  })
  it('do not count the other lane\'s runs, and do not fire below ten', () => {
    const playRuns = Array.from({ length: 10 }, () => drillResult({ lane: 'play' }))
    expect(PREDICATES.sharp(ctx({ drillResults: playRuns }))).toBe(false)
    const nineArcade = Array.from({ length: 9 }, () => drillResult({ lane: 'arcade' }))
    expect(PREDICATES.sharp(ctx({ drillResults: nineArcade }))).toBe(false)
  })
})

describe('invariant: one DrillResult row is one completed run (spec 7.9, Important 5)', () => {
  it('sharp counts run-shaped rows directly -- ten rows is ten runs', () => {
    // This is the contract `sharp` / `touch-grass` / `winsToday`'s de-rot
    // term all rely on. It already holds for Playground (one DrillResult per
    // 60-120s game). It does NOT yet hold for Arcade, which as shipped still
    // writes one row per drill item, not per six-item run (spec 7.9) --
    // T2.9a's run model is what makes this literally true for both lanes.
    // Named here so a future change to either side of the contract has a
    // test to fail against.
    const tenRunShapedRows = Array.from({ length: 10 }, () => drillResult({ lane: 'arcade' }))
    expect(PREDICATES.sharp(ctx({ drillResults: tenRunShapedRows }))).toBe(true)
  })
})

describe('beat-yourself', () => {
  it('fires at five strict-improvement moments for one kind', () => {
    const results = [10, 20, 30, 40, 50].map((score, i) =>
      drillResult({ kind: 'predict-output', score, at: `2026-09-0${i + 1}T00:00:00.000Z` }),
    )
    expect(PREDICATES['beat-yourself'](ctx({ drillResults: results }))).toBe(true)
  })
  it('does not count a tie or a lower score as a new best', () => {
    const results = [10, 20, 20, 15, 30].map((score, i) =>
      drillResult({ kind: 'predict-output', score, at: `2026-09-0${i + 1}T00:00:00.000Z` }),
    )
    // Bests in order: 10 (1st ever), 20 (2nd), tie (no), lower (no), 30 (3rd) = 3 total.
    expect(PREDICATES['beat-yourself'](ctx({ drillResults: results }))).toBe(false)
  })
})

describe('level-five / machine', () => {
  it('fire once points reach the level threshold', () => {
    expect(PREDICATES['level-five'](ctx({ state: learnerState({ points: 4000 }) }))).toBe(true)
    expect(PREDICATES.machine(ctx({ state: learnerState({ points: 58_800 }) }))).toBe(true)
  })
  it('do not fire one XP short of the threshold', () => {
    expect(PREDICATES['level-five'](ctx({ state: learnerState({ points: 3999 }) }))).toBe(false)
    expect(PREDICATES.machine(ctx({ state: learnerState({ points: 58_799 }) }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The three rules that hold everywhere (spec 7.1)
// ---------------------------------------------------------------------------

describe('rule: never punish a mistake with scarcity', () => {
  it('no predicate reads a fail as a debit -- a fails-only context unlocks nothing', () => {
    const failsOnly = ctx({ attempts: Array.from({ length: 10 }, () => attempt({ passed: false })) })
    for (const [id, predicate] of Object.entries(PREDICATES)) {
      expect(predicate(failsOnly), id).toBe(false)
    }
  })
})

describe('rule: self-comparison only', () => {
  it('RewardContext structurally cannot carry another learner\'s data', () => {
    const keys = Object.keys(ctx()).sort()
    expect(keys).toEqual(['activityDays', 'attempts', 'courseLessonCounts', 'drillResults', 'lessonProgress', 'prefs', 'state', 'today'])
  })
})

describe('rule: rewards track demonstrated skill or genuine showing up', () => {
  it('newlyUnlocked never mutates state and awards no points -- achievements are recognition, not currency', () => {
    const state = learnerState({ points: 42, mastery: { 'INFS1101-1': mastery({ closed: true }) } })
    const before = JSON.parse(JSON.stringify(state))
    const context = ctx({ state, attempts: [attempt({ passed: true })] })

    const unlocked = newlyUnlocked(context, [])

    expect(state).toEqual(before)
    expect(unlocked.length).toBeGreaterThan(0)
    for (const achievement of unlocked) expect(achievement).not.toHaveProperty('xp')
  })
})

// ---------------------------------------------------------------------------
// newlyUnlocked
// ---------------------------------------------------------------------------

describe('newlyUnlocked', () => {
  it('returns achievements whose predicate is true', () => {
    const result = newlyUnlocked(ctx({ attempts: [attempt({ passed: true })] }), [])
    expect(result.map((a) => a.id)).toContain('first-blood')
  })

  it('excludes ids already held even when the predicate is still true', () => {
    const result = newlyUnlocked(ctx({ attempts: [attempt({ passed: true })] }), ['first-blood'])
    expect(result.map((a) => a.id)).not.toContain('first-blood')
  })

  it('returns nothing for an empty context', () => {
    expect(newlyUnlocked(ctx(), [])).toEqual([])
  })
})
