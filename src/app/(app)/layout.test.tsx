import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WellnessPrefs } from '@/lib/contracts'
import { compileLearnerState } from '@/lib/learner/compile'
import { SessionProvider } from '@/components/shell/SessionProvider'
import type { SessionData } from '@/store/session'
import { QuerySeed } from '@/components/shell/QuerySeed'

const LAYOUT_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'layout.tsx'), 'utf8')

const mocks = vi.hoisted(() => ({ query: vi.fn(), from: vi.fn(), rpc: vi.fn(), headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => mocks.headers }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } }))
vi.mock('@/lib/supabase/server', () => ({
  // No `auth` key at all: R5.2's whole point is that this layout never calls
  // `auth.getUser()` — the proxy already verified the session and forwards
  // the id in `x-brogram-user-id`. A test that accidentally called `getUser`
  // would fail here with "not a function" rather than silently passing.
  serverClient: async () => ({ from: mocks.from, rpc: mocks.rpc }),
}))

/** One small chainable query-builder stand-in for every table this layout
 *  reads: `select`/`eq`/`order`/`limit` all return the same builder, and
 *  awaiting it (or calling `.maybeSingle()`) resolves through `mocks.query`,
 *  keyed only by table name — exactly as much fidelity as these tests need. */
function makeBuilder(table: string) {
  const resolve = (mode: 'single' | 'list') => Promise.resolve(mocks.query(table, mode))
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => resolve('single'),
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      resolve('list').then(onFulfilled, onRejected),
  }
  return builder
}

function defaultQueryResult(table: string) {
  if (table === 'attempts' || table === 'lesson_progress' || table === 'user_achievements' || table === 'my_activity_days') {
    return { data: [], error: null }
  }
  return { data: null, error: null }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.headers = new Headers({
    'x-brogram-pathname': '/dashboard',
    'x-brogram-account-status': 'active',
    'x-brogram-restricted-until': '',
    'x-brogram-user-id': 'student',
  })
  mocks.from.mockImplementation((table: string) => makeBuilder(table))
  mocks.rpc.mockImplementation((name: string) => Promise.resolve(mocks.query(name, 'list')))
  mocks.query.mockImplementation(defaultQueryResult)
})

/** Test-only cast: the layout resolves `wellness.prefs` through
 *  `resolveWellnessPrefs` before seeding it (C4), so by the time it reaches
 *  `<QuerySeed>` it is a complete `WellnessPrefs`, not the `unknown` the
 *  frozen `WellnessRow` contract types it as for every other, unresolved reader. */
function resolvedPrefs(row: { prefs?: unknown } | undefined): WellnessPrefs | undefined {
  return row?.prefs as WellnessPrefs | undefined
}

/** `learner_state` returning a real, complete document is what turns on the
 *  layout's second wave of reads (attempts/wellness/lesson_progress/
 *  achievements/activity-days) — every test that needs those configures this. */
function withSavedState(state: ReturnType<typeof compileLearnerState>, version = 2) {
  mocks.query.mockImplementation((table: string) => table === 'learner_state' ? { data: { state, version }, error: null } : defaultQueryResult(table))
}

// `Layout` now wraps `SessionProvider` in `QueryProvider` (T0.4). None of this
// file's assertions render the tree through React, so a plain call still
// returns the element graph as data; unwrap it here rather than in every
// test so every existing assertion below reads `SessionProvider`'s props
// exactly as it did before the wrapper was added.
function childArray(element: { props: { children: unknown } }) {
  const children = element.props.children
  return Array.isArray(children) ? children : [children]
}
/** Finds the element of `type` among `tree`'s direct children and returns it typed by that component's own props (`key` included — React strips it out of `.props`, so it is surfaced separately here). */
function findChild<P>(tree: { props: { children: unknown } }, type: unknown): { props: P; key: string | null } {
  const match = childArray(tree).find((child) => (child as { type?: unknown } | null)?.type === type) as { props: P; key: string | null } | undefined
  if (!match) throw new Error('Expected child not found in the tree QueryProvider rendered')
  return match
}
async function layoutTree() {
  const { default: Layout } = await import('./layout')
  return Layout({ children: <p>Protected child</p> })
}
// Every test below reaches `layout()` only after the redirect/error guards pass,
// at which point `AppLayout` has always built a concrete profile and learner
// state — never `null` — so this narrows `SessionData`'s nullable fields once
// here rather than asserting non-null at each of this file's existing reads.
type RenderedSession = { initialState: { user: SessionData['user']; profile: NonNullable<SessionData['profile']>; learnerState: NonNullable<SessionData['learnerState']> } }
async function layout() {
  const tree = await layoutTree()
  return findChild<RenderedSession>(tree, SessionProvider)
}
describe('app hydration', () => {
  it('mounts QueryProvider around SessionProvider and seeds the learner state', async () => {
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(seed.props.userId).toBe('student')
    expect(seed.props.learnerState?.userId).toBe('student')
    // Keyed on the user id, like `SessionProvider`'s own key, so a signed-in
    // user change forces a clean remount instead of reusing this instance.
    expect(seed.key).toBe('student')
  })
  it('uses the forwarded identity and account without a second auth call or a profile re-select', async () => {
    const tree = await layout()
    expect(tree.props.initialState.user?.id).toBe('student')
    expect(tree.props.initialState.profile.account_status).toBe('active')
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain('profiles')
  })
  it('C1: forwards the verified email into the User the account page reads, not a stub with no email at all', async () => {
    mocks.headers.set('x-brogram-user-email', 'learner@uni.edu.qa')
    const tree = await layout()
    expect(tree.props.initialState.user?.email).toBe('learner@uni.edu.qa')
  })
  it('C1: carries no email rather than inventing one when the proxy forwarded none', async () => {
    const tree = await layout()
    expect(tree.props.initialState.user?.email).toBeUndefined()
  })
  it('redirects a visit with no forwarded identity to login', async () => {
    mocks.headers.delete('x-brogram-user-id')
    await expect(layout()).rejects.toThrow('REDIRECT:/login')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([['banned', '/dashboard', '/auth/signout'], ['restricted', '/exercise/one', '/dashboard']])('gates %s accounts', async (status, path, destination) => {
    mocks.headers.set('x-brogram-account-status', status)
    mocks.headers.set('x-brogram-pathname', path)
    await expect(layout()).rejects.toThrow(`REDIRECT:${destination}`)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('fails closed when account headers are missing', async () => {
    mocks.headers.delete('x-brogram-account-status')
    await expect(layout()).rejects.toThrow('Unable to load your profile')
  })
  it.each([{}, { profile: {} }, 'broken', { profile: {}, streak: {} }])('falls back for an incomplete persisted document: %j', async (state) => {
    mocks.query.mockImplementation((table: string) => table === 'learner_state' ? { data: { state, version: 4 }, error: null } : defaultQueryResult(table))
    const tree = await layout()
    expect(tree.props.initialState.learnerState.profile.onboardingComplete).toBe(false)
    expect(tree.props.initialState.learnerState.streak.exerciseDays).toBe(0)
    expect(tree.props.initialState.learnerState.version).toBe(4)
  })
  it('I5: seeds real attempts, lesson_progress and achievements even when the stored document fails the shape check', async () => {
    // The one wave now runs unconditionally (I4/I5): a learner whose
    // learner_state document is incomplete (commit 9bc1896, "completion
    // survives a failed write") still has real rows in every other table,
    // and losing them behind the `saved` gate for the whole session was the
    // bug — reloading re-ran the same gate and never recovered them.
    mocks.query.mockImplementation((table: string) => {
      if (table === 'learner_state') return { data: { state: {}, version: 4 }, error: null }
      if (table === 'attempts') return { data: [{ id: 'a1', exercise_id: 'ex1', code: 'x', results: [], passed: true, duration_ms: 100, hint_count: 0, created_at: '2026-09-05T00:00:00Z' }], error: null }
      if (table === 'lesson_progress') return { data: [{ lesson_id: 'C1-1', clo_id: 'C1-1', status: 'completed', block_index: 3, checks_passed: 2, checks_failed: 0, lesson_version: 1, started_at: '2026-09-05T00:00:00Z', completed_at: '2026-09-05T00:10:00Z', updated_at: '2026-09-05T00:10:00Z' }], error: null }
      if (table === 'user_achievements') return { data: [{ achievement_id: 'first-blood', unlocked_at: '2026-09-05T00:00:00Z' }], error: null }
      return defaultQueryResult(table)
    })
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(seed.props.attempts).toHaveLength(1)
    expect(seed.props.lessonProgress).toHaveLength(1)
    expect(seed.props.achievements).toHaveLength(1)
    expect(mocks.rpc).toHaveBeenCalledWith('my_activity_days')
  })
  it('I4: issues all six reads in one wave — none of them waits for learner_state to resolve first', async () => {
    let resolveLearnerState: (value: unknown) => void = () => {}
    const pendingLearnerState = new Promise((resolve) => { resolveLearnerState = resolve })
    const calledTables: string[] = []
    mocks.from.mockImplementation((table: string) => {
      calledTables.push(table)
      if (table === 'learner_state') return { select: () => ({ eq: () => ({ maybeSingle: () => pendingLearnerState }) }) }
      return makeBuilder(table)
    })
    // Resolve the dynamic import first (cached after the first test in this
    // file, but still at least one microtask) so the timing below is about
    // AppLayout's own body, not module resolution.
    const { default: Layout } = await import('./layout')
    const treePromise = Layout({ children: <p>Protected child</p> })
    // A handful of microtask turns is enough for every synchronous entry in
    // the Promise.all array to have been invoked, while learner_state's own
    // promise is still deliberately unresolved — a two-serial-waves
    // implementation would not have called any of these yet.
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
    expect(calledTables).toEqual(expect.arrayContaining(['learner_state', 'wellness', 'attempts', 'lesson_progress', 'user_achievements']))
    expect(mocks.rpc).toHaveBeenCalledWith('my_activity_days')
    resolveLearnerState({ data: null, error: null })
    await treePromise
  })
  it('expires saved streaks with the server clock and keeps dates and aggregates', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    saved.streak = { exerciseDays: 8, derotDays: 4, lastExerciseDate: '2020-01-08', lastDerotDate: '2020-01-04' }
    saved.points = 3210
    withSavedState(saved, 9)
    const tree = await layout()
    expect(tree.props.initialState.learnerState.streak).toEqual({ exerciseDays: 0, derotDays: 0, lastExerciseDate: '2020-01-08', lastDerotDate: '2020-01-04' })
    expect(tree.props.initialState.learnerState.points).toBe(3210)
    expect(tree.props.initialState.learnerState.version).toBe(9)
  })
  it('keeps a persisted Planner focus line through hydration', async () => {
    // `focus` is not part of the frozen LearnerState contract; it rides along as an extra
    // jsonb key that onboarding and useExerciseLoop write. Hydration spreads `row.state`
    // into the compiled state, so this extra key must survive untouched.
    const saved = { ...compileLearnerState({ id: 'student' }, [], [], [], null), focus: 'Work on loops next.' }
    withSavedState(saved, 3)
    const tree = await layout()
    expect((tree.props.initialState.learnerState as typeof saved).focus).toBe('Work on loops next.')
  })
  it('recomputes a current streak from my_activity_days, not a paginated attempts scan', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    withSavedState(saved, 2)
    mocks.rpc.mockImplementation((name: string) => name === 'my_activity_days'
      ? Promise.resolve({ data: [{ kind: 'exercise', day: today }, { kind: 'exercise', day: yesterday }], error: null })
      : Promise.resolve({ data: null, error: null }))
    const tree = await layout()
    expect(tree.props.initialState.learnerState.streak.exerciseDays).toBe(2)
  })
  it('derives a 30-day streak purely from my_activity_days, which a 50-row attempts cap could never carry', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    withSavedState(saved, 2)
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.now() - i * 86_400_000)
      return { kind: 'exercise', day: date.toISOString().slice(0, 10) }
    })
    mocks.rpc.mockImplementation((name: string) => name === 'my_activity_days'
      ? Promise.resolve({ data: days, error: null })
      : Promise.resolve({ data: null, error: null }))
    // The capped attempts read must never be asked to stand in for this — it
    // is fetched for the `['attempts', userId]` seed only, never read for streaks.
    mocks.query.mockImplementation((table: string) => {
      if (table === 'learner_state') return { data: { state: saved, version: 2 }, error: null }
      if (table === 'attempts') return { data: [], error: null }
      return defaultQueryResult(table)
    })
    const tree = await layout()
    expect(tree.props.initialState.learnerState.streak.exerciseDays).toBe(30)
  })
  it('seeds attempts (capped), wellness, lesson_progress and achievements for a returning learner, and reads learner_state and my_activity_days exactly once each', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    withSavedState(saved, 2)
    mocks.query.mockImplementation((table: string) => {
      if (table === 'learner_state') return { data: { state: saved, version: 2 }, error: null }
      if (table === 'attempts') return { data: [{ id: 'a1', exercise_id: 'ex1', code: 'x', results: [], passed: true, duration_ms: 100, hint_count: 0, created_at: '2026-09-05T00:00:00Z' }], error: null }
      if (table === 'wellness') return { data: { user_id: 'student', prefs: { theme: 'amber' }, drill_results: [] }, error: null }
      if (table === 'lesson_progress') return { data: [{ lesson_id: 'C1-1', clo_id: 'C1-1', status: 'started', block_index: 1, checks_passed: 0, checks_failed: 0, lesson_version: 1, started_at: '2026-09-05T00:00:00Z', completed_at: null, updated_at: '2026-09-05T00:00:00Z' }], error: null }
      if (table === 'user_achievements') return { data: [{ achievement_id: 'first-blood', unlocked_at: '2026-09-05T00:00:00Z' }], error: null }
      if (table === 'my_activity_days') return { data: [{ kind: 'exercise', day: '2026-09-05' }], error: null }
      return defaultQueryResult(table)
    })
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(seed.props.attempts).toHaveLength(1)
    // Seeded already resolved (C4): a stored row missing every v2 key still
    // comes out as a complete WellnessPrefs, `theme` carried through.
    expect(resolvedPrefs(seed.props.wellness)?.theme).toBe('amber')
    expect(resolvedPrefs(seed.props.wellness)?.dock).toEqual({ placement: 'right', collapsed: false, compactOnExercise: true, corner: 'br' })
    expect(seed.props.lessonProgress).toHaveLength(1)
    expect(seed.props.achievements).toHaveLength(1)
    expect(seed.props.activityDays).toHaveLength(1)
    expect(mocks.from.mock.calls.map(([table]) => table).filter((t) => t === 'learner_state')).toHaveLength(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('my_activity_days')
  })
  it('tolerates lesson_progress and user_achievements not existing yet (migrations 0006/0007), seeding empty arrays with no thrown error', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    mocks.query.mockImplementation((table: string) => {
      if (table === 'learner_state') return { data: { state: saved, version: 2 }, error: null }
      if (table === 'lesson_progress' || table === 'user_achievements') return { data: null, error: { message: 'relation does not exist', code: '42P01' } }
      return defaultQueryResult(table)
    })
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(seed.props.lessonProgress).toEqual([])
    expect(seed.props.achievements).toEqual([])
  })
  it('throws when learner_state itself fails to load, unlike the tolerated 0006/0007 tables', async () => {
    mocks.query.mockImplementation((table: string) => table === 'learner_state' ? { data: null, error: { message: 'Database unavailable' } } : defaultQueryResult(table))
    await expect(layout()).rejects.toThrow('Unable to load your learning progress')
  })
  it('seeds a fully-resolved wellness row even for a brand-new account with no learner_state document yet', async () => {
    // No `withSavedState` here: `learner_state` stays the default empty
    // response, so `saved` is null. The wellness dock still needs its
    // placement seeded on this very first load (the Opus review of T2.4:
    // "every load paints the default right rail and then reflows").
    mocks.query.mockImplementation((table: string) => table === 'wellness'
      ? { data: { user_id: 'student', prefs: { dock: { placement: 'left' } } }, error: null }
      : defaultQueryResult(table))
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(resolvedPrefs(seed.props.wellness)?.dock.placement).toBe('left')
    // Deep-merged, not a half-built object missing the other three dock keys.
    expect(resolvedPrefs(seed.props.wellness)?.dock).toEqual({ placement: 'left', collapsed: false, compactOnExercise: true, corner: 'br' })
  })
  it('I2: expires a stale saved streak by date when my_activity_days is missing (migration 0008 not deployed), rather than freezing the exact bug R5.2a exists to kill', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    saved.streak = { exerciseDays: 12, derotDays: 5, lastExerciseDate: '2020-01-08', lastDerotDate: '2020-01-04' }
    withSavedState(saved, 5)
    mocks.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'Could not find the function public.my_activity_days', code: 'PGRST202' } }))
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(seed.props.activityDays).toEqual([])
    const rendered = findChild<RenderedSession>(tree, SessionProvider)
    // Zeroed, not frozen: a stored streak with a three-week-old
    // lastExerciseDate must not keep reading as a live streak forever just
    // because the RPC that would normally verify it is not deployed yet.
    expect(rendered.props.initialState.learnerState.streak.exerciseDays).toBe(0)
    expect(rendered.props.initialState.learnerState.streak.derotDays).toBe(0)
    // The dates themselves still survive untouched -- only the counts expire.
    expect(rendered.props.initialState.learnerState.streak.lastExerciseDate).toBe('2020-01-08')
    expect(rendered.props.initialState.learnerState.streak.lastDerotDate).toBe('2020-01-04')
  })
  it('I2: a current saved streak (last activity today or yesterday, UTC) survives the same RPC-missing path', async () => {
    const now = new Date()
    const todayKey = now.toISOString().slice(0, 10)
    const yesterdayKey = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    saved.streak = { exerciseDays: 6, derotDays: 1, lastExerciseDate: todayKey, lastDerotDate: yesterdayKey }
    withSavedState(saved, 5)
    mocks.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'Could not find the function public.my_activity_days', code: 'PGRST202' } }))
    const tree = await layout()
    expect(tree.props.initialState.learnerState.streak.exerciseDays).toBe(6)
    expect(tree.props.initialState.learnerState.streak.derotDays).toBe(1)
  })
  it('I1: seeds undefined, not an empty array, for lesson_progress/achievements/activity-days on a non-schema error, so the client hook fetches instead of caching a false empty', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    const transientError = { message: 'Connection pool exhausted' }
    mocks.query.mockImplementation((table: string) => {
      if (table === 'learner_state') return { data: { state: saved, version: 2 }, error: null }
      if (table === 'lesson_progress' || table === 'user_achievements') return { data: null, error: transientError }
      return defaultQueryResult(table)
    })
    mocks.rpc.mockImplementation(() => Promise.resolve({ data: null, error: transientError }))
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(seed.props.lessonProgress).toBeUndefined()
    expect(seed.props.achievements).toBeUndefined()
    expect(seed.props.activityDays).toBeUndefined()
  })
  it('I1: still seeds an empty array (never undefined) for the confirmed "not there yet" codes', async () => {
    const saved = compileLearnerState({ id: 'student' }, [], [], [], null)
    mocks.query.mockImplementation((table: string) => {
      if (table === 'learner_state') return { data: { state: saved, version: 2 }, error: null }
      if (table === 'lesson_progress') return { data: null, error: { message: 'relation does not exist', code: '42P01' } }
      if (table === 'user_achievements') return { data: null, error: { message: 'not found', code: 'PGRST205' } }
      return defaultQueryResult(table)
    })
    mocks.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'function missing', code: '42883' } }))
    const tree = await layoutTree()
    const seed = findChild<Parameters<typeof QuerySeed>[0]>(tree, QuerySeed)
    expect(seed.props.lessonProgress).toEqual([])
    expect(seed.props.achievements).toEqual([])
    expect(seed.props.activityDays).toEqual([])
  })
  it('throws when wellness fails to load, since the dock has nothing honest to fall back to', async () => {
    mocks.query.mockImplementation((table: string) => table === 'wellness' ? { data: null, error: { message: 'Database unavailable' } } : defaultQueryResult(table))
    await expect(layout()).rejects.toThrow('Unable to load your wellness settings')
  })
  it('never issues an unbounded, paginated attempts scan — the deleted pager stays deleted', () => {
    expect(LAYOUT_SOURCE).not.toMatch(/\.range\(/)
    expect(LAYOUT_SOURCE).not.toMatch(/auth\.getUser\(/)
  })
})
