import { describe, expect, it, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACHIEVEMENTS, DEFAULT_WELLNESS, type LearnerState, type Mastery } from '@/lib/contracts'
import type { RewardAttempt, RewardContext } from './context'
import { recordAchievements, recordGoalDay } from './record'

const invalidateMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/query/client', () => ({ getQueryClient: () => ({ invalidateQueries: invalidateMock }) }))

const celebrateMock = vi.hoisted(() => vi.fn())
vi.mock('./useCelebration', () => ({ celebrate: celebrateMock }))

// F1 (fix round 1): `recordGoalDay` now guards its invalidate on this. Mocked
// per-test rather than left at its real (module-level, per-user-map)
// implementation so each test controls the "is a prefs write in flight"
// state independently of any other test's writer map.
const hasPendingPrefsWriteMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('@/app/(app)/account/prefsMutation', () => ({ hasPendingPrefsWrite: hasPendingPrefsWriteMock }))

afterEach(() => {
  vi.clearAllMocks()
  hasPendingPrefsWriteMock.mockReturnValue(false)
})

// ---------------------------------------------------------------------------
// Fixtures -- same shape as achievements.test.ts / goal.test.ts.
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
  return { userId: 'user-1', cloId: 'INFS1101-1', score: 0, chain: 0, patternsPassed: [], closed: false, lastAttemptAt: null, ...over }
}

let attemptSeq = 0
// durationMs deliberately >= UNDER_A_MINUTE_MS (achievements.ts) so a bare
// `attempt({ passed: true })` qualifies for 'first-blood' only, not also
// 'under-a-minute' -- this file's `recordAchievements` tests need a single,
// predictable candidate to assert the write shape against.
function attempt(over: Partial<RewardAttempt> = {}): RewardAttempt {
  attemptSeq += 1
  return {
    id: `attempt-${attemptSeq}`,
    userId: 'user-1',
    exerciseId: `ex-${attemptSeq}`,
    code: '',
    results: [],
    passed: true,
    durationMs: 90_000,
    hintCount: 0,
    createdAt: '2026-09-06T10:00:00.000Z',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// A minimal chainable Supabase fake -- only the calls each function actually
// makes, in the shape `.from().upsert().select()` / `.from().update().eq()
// .select().maybeSingle()` / `.from().insert()`.
// ---------------------------------------------------------------------------

type Call = Record<string, unknown>

function fakeClient(opts: {
  upsert?: { data: unknown; error: unknown }
  /** The read-fresh `select('prefs').eq().maybeSingle()` `recordGoalDay` now
   *  does before building its patch (F1, fix round 1). Defaults to "no row
   *  yet" so tests that do not care about the server's current prefs still
   *  pass through resolveWellnessPrefs's own defaulting. */
  read?: { data: unknown; error: unknown }
  update?: { data: unknown; error: unknown }
  insert?: { data: unknown; error: unknown }
} = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      calls.push({ table })
      return {
        select(columns: string) {
          calls.push({ readSelect: columns })
          return {
            eq(column: string, value: unknown) {
              calls.push({ readEq: [column, value] })
              return { maybeSingle: () => Promise.resolve(opts.read ?? { data: null, error: null }) }
            },
          }
        },
        upsert(rows: unknown, options: unknown) {
          calls.push({ upsert: rows, options })
          return {
            select(columns: string) {
              calls.push({ select: columns })
              return Promise.resolve(opts.upsert ?? { data: [], error: null })
            },
          }
        },
        update(payload: unknown) {
          calls.push({ update: payload })
          return {
            eq(column: string, value: unknown) {
              calls.push({ eq: [column, value] })
              return {
                select(columns: string) {
                  calls.push({ select: columns })
                  return { maybeSingle: () => Promise.resolve(opts.update ?? { data: { user_id: 'user-1' }, error: null }) }
                },
              }
            },
          }
        },
        insert(payload: unknown) {
          calls.push({ insert: payload })
          return Promise.resolve(opts.insert ?? { data: null, error: null })
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

// ---------------------------------------------------------------------------
// recordAchievements
// ---------------------------------------------------------------------------

describe('recordAchievements', () => {
  it('makes no write and returns nothing when nothing newly qualifies', async () => {
    const { client, calls } = fakeClient()
    const result = await recordAchievements(client, 'user-1', ctx(), [])
    expect(result).toEqual([])
    expect(calls).toEqual([])
    expect(celebrateMock).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
  })

  it('inserts only the newly-qualifying ids, celebrates each created row, and invalidates the achievements key', async () => {
    const { client, calls } = fakeClient({ upsert: { data: [{ achievement_id: 'first-blood' }], error: null } })
    const qualifyingCtx = ctx({ attempts: [attempt({ passed: true })] }) // qualifies 'first-blood'
    const result = await recordAchievements(client, 'user-1', qualifyingCtx, [])

    expect(result.map((a) => a.id)).toEqual(['first-blood'])
    const upsertCall = calls.find((c) => 'upsert' in c)
    expect(upsertCall?.upsert).toEqual([{ user_id: 'user-1', achievement_id: 'first-blood' }])
    expect(upsertCall?.options).toEqual({ onConflict: 'user_id,achievement_id', ignoreDuplicates: true })
    expect(celebrateMock).toHaveBeenCalledWith('achievement', { skill: 'first-blood' }, 'user-1:achievement:first-blood')
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: ['achievements', 'user-1'] })
  })

  it('never celebrates off a client-side diff against a cold (stale) held-list cache -- the DB response is the only source of "created"', async () => {
    // `held` is empty (as a cold cache would read), but the row already
    // exists server-side: ignoreDuplicates means PostgREST returns nothing
    // for it. The writer must trust that, not re-derive "created" from `held`.
    const { client } = fakeClient({ upsert: { data: [], error: null } })
    const qualifyingCtx = ctx({ attempts: [attempt({ passed: true })] })
    const result = await recordAchievements(client, 'user-1', qualifyingCtx, [])

    expect(result).toEqual([])
    expect(celebrateMock).not.toHaveBeenCalled()
    expect(invalidateMock).not.toHaveBeenCalled()
  })

  it('a second call for an already-held id makes no write at all -- newlyUnlocked already filters it out', async () => {
    const { client, calls } = fakeClient()
    const qualifyingCtx = ctx({ attempts: [attempt({ passed: true })] })
    const result = await recordAchievements(client, 'user-1', qualifyingCtx, ['first-blood'])
    expect(result).toEqual([])
    expect(calls).toEqual([])
  })

  it('no-ops at schema 0005: a missing-table error resolves to an empty list, never a throw', async () => {
    const { client } = fakeClient({ upsert: { data: null, error: { code: '42P01', message: 'relation "user_achievements" does not exist' } } })
    const qualifyingCtx = ctx({ attempts: [attempt({ passed: true })] })
    await expect(recordAchievements(client, 'user-1', qualifyingCtx, [])).resolves.toEqual([])
    expect(celebrateMock).not.toHaveBeenCalled()
  })

  it('a real (non-missing-object) database error is swallowed too -- a broken achievement write never breaks the pass', async () => {
    const { client } = fakeClient({ upsert: { data: null, error: { code: '42501', message: 'permission denied' } } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const qualifyingCtx = ctx({ attempts: [attempt({ passed: true })] })
    await expect(recordAchievements(client, 'user-1', qualifyingCtx, [])).resolves.toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('fires one celebration per row actually created, each with a stable per-achievement eventId', async () => {
    const twoTonguesCtx = ctx({
      state: learnerState({
        mastery: {
          'INFS1101-1': mastery({ cloId: 'INFS1101-1', patternsPassed: ['p1'] }),
          'INFS2101-1': mastery({ cloId: 'INFS2101-1', patternsPassed: ['p2'] }),
        },
      }),
    }) // qualifies 'two-tongues' only (no attempts -> no first-blood)
    const { client } = fakeClient({ upsert: { data: [{ achievement_id: 'two-tongues' }], error: null } })
    const result = await recordAchievements(client, 'user-1', twoTonguesCtx, [])
    expect(result.map((a) => a.id)).toEqual(['two-tongues'])
    expect(celebrateMock).toHaveBeenCalledTimes(1)
    expect(celebrateMock).toHaveBeenCalledWith('achievement', { skill: 'two-tongues' }, 'user-1:achievement:two-tongues')
  })
})

// ---------------------------------------------------------------------------
// recordGoalDay
// ---------------------------------------------------------------------------

describe('recordGoalDay', () => {
  function goalMetCtx(over: Partial<RewardContext> = {}) {
    return ctx({
      prefs: { ...DEFAULT_WELLNESS, dailyGoal: 1, goalDays: [] },
      attempts: [attempt({ passed: true, createdAt: '2026-09-06T10:00:00.000Z' })],
      today: '2026-09-06',
      ...over,
    })
  }

  it('writes nothing and returns false when the goal is not met today', async () => {
    const { client, calls } = fakeClient()
    const result = await recordGoalDay(client, 'user-1', ctx({ prefs: { ...DEFAULT_WELLNESS, dailyGoal: 5, goalDays: [] } }))
    expect(result).toBe(false)
    expect(calls).toEqual([])
    expect(celebrateMock).not.toHaveBeenCalled()
  })

  it('updates the existing wellness row, invalidates the wellness key, and fires goal.done once', async () => {
    const { client, calls } = fakeClient({ update: { data: { user_id: 'user-1' }, error: null } })
    const result = await recordGoalDay(client, 'user-1', goalMetCtx())
    expect(result).toBe(true)
    expect(calls.some((c) => 'update' in c)).toBe(true)
    expect(calls.some((c) => 'insert' in c)).toBe(false)
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: ['wellness', 'user-1'] })
    expect(celebrateMock).toHaveBeenCalledWith('goal', undefined, 'user-1:goal:2026-09-06')
    expect(celebrateMock).toHaveBeenCalledTimes(1)
  })

  it('inserts a fresh wellness row when none exists yet, instead of failing the goal write', async () => {
    const { client, calls } = fakeClient({ update: { data: null, error: null }, insert: { data: null, error: null } })
    const result = await recordGoalDay(client, 'user-1', goalMetCtx())
    expect(result).toBe(true)
    expect(calls.some((c) => 'insert' in c)).toBe(true)
  })

  it('a second call the same day, after goalDays already carries today, is a no-op -- no write, no repeat celebration', async () => {
    const { client, calls } = fakeClient()
    // Simulates the caller re-reading prefs after the first write succeeded.
    const alreadyRecorded = goalMetCtx({ prefs: { ...DEFAULT_WELLNESS, dailyGoal: 1, goalDays: ['2026-09-06'] } })
    const result = await recordGoalDay(client, 'user-1', alreadyRecorded)
    expect(result).toBe(false)
    expect(calls).toEqual([])
    expect(celebrateMock).not.toHaveBeenCalled()
  })

  it('a walkthrough-only day and a de-rot-only day both qualify (spec 7.4) -- not exercise passes alone', async () => {
    const { client: client1 } = fakeClient({ update: { data: { user_id: 'user-1' }, error: null } })
    const walkthroughOnly = ctx({
      prefs: { ...DEFAULT_WELLNESS, dailyGoal: 1, goalDays: [] },
      lessonProgress: [
        {
          userId: 'user-1', lessonId: 'L1', cloId: 'INFS1101-1', status: 'completed', blockIndex: 5,
          checksPassed: 3, checksFailed: 0, lessonVersion: 1,
          startedAt: '2026-09-06T09:00:00.000Z', completedAt: '2026-09-06T09:30:00.000Z', updatedAt: '2026-09-06T09:30:00.000Z',
        },
      ],
      today: '2026-09-06',
    })
    expect(await recordGoalDay(client1, 'user-1', walkthroughOnly)).toBe(true)

    vi.clearAllMocks()
    const { client: client2 } = fakeClient({ update: { data: { user_id: 'user-1' }, error: null } })
    const derotOnly = ctx({
      prefs: { ...DEFAULT_WELLNESS, dailyGoal: 1, goalDays: [] },
      drillResults: [{ drillId: 'd1', kind: 'trace', correct: true, timeMs: 1000, score: 80, at: '2026-09-06T10:00:00.000Z', lane: 'arcade' }],
      today: '2026-09-06',
    })
    expect(await recordGoalDay(client2, 'user-1', derotOnly)).toBe(true)
  })

  it('degrades silently on a write failure -- never throws, no celebration fires', async () => {
    const { client } = fakeClient({ update: { data: null, error: { code: '500', message: 'boom' } } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await recordGoalDay(client, 'user-1', goalMetCtx())
    expect(result).toBe(false)
    expect(celebrateMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  // F1 (fix round 1, Opus review of 4a522e2): the write used to build its
  // patch from `ctx.prefs`, a snapshot the caller captured at submit time.
  // If the learner changed something else (theme, sound, the dock) between
  // that snapshot and this write landing, the whole `prefs` column got
  // overwritten back to the stale snapshot -- a durable loss, not a visual
  // flicker, since `wellness` has no per-field columns to merge on the server.
  it('re-reads the server row before writing -- a stale ctx.prefs snapshot never clobbers a field the server already has fresher', async () => {
    const { client, calls } = fakeClient({
      read: { data: { prefs: { ...DEFAULT_WELLNESS, theme: 'amber' } }, error: null },
      update: { data: { user_id: 'user-1' }, error: null },
    })
    // ctx.prefs says 'paper' -- captured before some other control (the dock,
    // the account page) wrote 'amber' to the server.
    const staleCtx = goalMetCtx({ prefs: { ...DEFAULT_WELLNESS, dailyGoal: 1, goalDays: [], theme: 'paper' } })
    const result = await recordGoalDay(client, 'user-1', staleCtx)
    expect(result).toBe(true)
    const updateCall = calls.find((c) => 'update' in c) as { update: { prefs: Record<string, unknown> } } | undefined
    expect(updateCall?.update.prefs.theme).toBe('amber')
    expect(updateCall?.update.prefs.goalDays).toEqual(['2026-09-06'])
  })

  // F1: the invalidate is what visibly flips a control the learner is mid-edit
  // on back to a stale value (X3). Skipping it while the dock/account writer
  // has something queued or in flight is the whole fix.
  it('skips the wellness invalidate while a prefs write is pending elsewhere, but still writes and celebrates', async () => {
    hasPendingPrefsWriteMock.mockReturnValue(true)
    const { client } = fakeClient({ update: { data: { user_id: 'user-1' }, error: null } })
    const result = await recordGoalDay(client, 'user-1', goalMetCtx())
    expect(result).toBe(true)
    expect(invalidateMock).not.toHaveBeenCalled()
    expect(celebrateMock).toHaveBeenCalledWith('goal', undefined, 'user-1:goal:2026-09-06')
  })

  it('invalidates the wellness key as normal when nothing else is pending', async () => {
    hasPendingPrefsWriteMock.mockReturnValue(false)
    const { client } = fakeClient({ update: { data: { user_id: 'user-1' }, error: null } })
    await recordGoalDay(client, 'user-1', goalMetCtx())
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: ['wellness', 'user-1'] })
  })
})

// Sanity: every achievement id this suite references is real.
describe('fixtures', () => {
  it('references only real achievement ids', () => {
    expect(ACHIEVEMENTS.some((a) => a.id === 'first-blood')).toBe(true)
    expect(ACHIEVEMENTS.some((a) => a.id === 'two-tongues')).toBe(true)
  })
})
