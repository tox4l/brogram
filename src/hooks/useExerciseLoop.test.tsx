import type { PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, AgentName, Clo, ExercisePublic, LearnerState, RunResult } from '@/lib/contracts'
import { compileLearnerState } from '@/lib/learner/compile'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { qk } from '@/lib/query/keys'
import { __resetExerciseLoopModuleStateForTests, useExerciseLoop } from './useExerciseLoop'

const spies = vi.hoisted(() => ({
  call: vi.fn(), stream: vi.fn(), run: vi.fn(), warmup: vi.fn(), abort: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(),
  from: vi.fn(), progress: vi.fn(), exerciseFrom: vi.fn<(code: string, id: string) => unknown>(() => null), celebrate: vi.fn(), play: vi.fn(),
  invalidate: vi.fn(), getQueryData: vi.fn(),
}))
vi.mock('@/lib/agents/client', () => ({ callAgent: spies.call, streamAgent: spies.stream }))
vi.mock('@/lib/runtimes', () => ({ getRuntime: vi.fn(() => ({ language: 'javascript', run: spies.run, warmup: spies.warmup, abort: spies.abort })), subscribeRuntimeProgress: spies.progress }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: spies.from }) }))
// Fix round 5: `prefetch` is new -- `queueNext` now calls `router.prefetch()` the moment it
// chooses the next exercise (see the hook's own comment), well before `next()` itself runs.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: spies.push, replace: spies.replace, prefetch: spies.prefetch }) }))
vi.mock('@/lib/sound/manager', () => ({ play: spies.play }))
// Fix round 5: `onUserChange` is a real, top-level side effect this hook now runs at module load
// (registering its own cleanup with `src/lib/query/client.ts`'s registry) -- mocked as a no-op
// here since this file tests the hook, not the registry (that lives in `client.test.ts`).
// `getQueryData` is new (X1/X7): `recordRewardsAfterSettle` reads `lessonProgress`/`wellness`/
// `achievements` straight from the cache -- `spies.getQueryData` defaults to "nothing cached"
// (below) so every existing test keeps exercising the honest cold-cache path unless it opts in.
vi.mock('@/lib/query/client', () => ({ getQueryClient: () => ({ invalidateQueries: spies.invalidate, getQueryData: spies.getQueryData }), onUserChange: () => {} }))
vi.mock('@/lib/rewards/useCelebration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rewards/useCelebration')>()
  return { ...actual, celebrate: spies.celebrate }
})

const current: ExercisePublic = { id: 'e1', cloId: 'c1', language: 'javascript', kind: 'code', difficulty: 3, pattern: 'scan', title: 'Find a value', prompt: 'Return the requested value.', starterCode: 'function solve() {}', origin: 'seed', tags: [], tests: [{ id: 't1', input: '[]', expected: '1', hidden: false }] }
const candidate: ExercisePublic = { ...current, id: 'e2', pattern: 'reduce', title: 'Count the values' }
const clo = { id: 'c1', course: 'course1', ordinal: 1, outcome: 'Use collections', topics: [], prerequisites: [], patterns: ['scan', 'reduce', 'partition'], assessable_in_code: true, draft: false }
const mapClo = (row: Record<string, unknown>): Clo => ({ id: String(row.id), course: String(row.course), ordinal: Number(row.ordinal), outcome: String(row.outcome), topics: row.topics as string[] ?? [], prerequisites: row.prerequisites as string[] ?? [], patterns: row.patterns as string[] ?? [], assessableInCode: row.assessable_in_code === true })

/**
 * R5.1b's "memoised static course bundle" (`@/lib/curriculum`) stands in for
 * Supabase's `clos`/`courses` tables in this suite: `tables.clos`/`tables.courses`
 * stay the single fixture source of truth, just read through the curriculum's
 * shape instead of a network round trip. `exerciseFrom` defaults to "not in any
 * bundle" (`spies.exerciseFrom`, itself defaulting to `null`) so every existing
 * test keeps exercising the `exercises_public` fallback path unchanged; only the
 * dedicated bundle-hit test below overrides it.
 */
vi.mock('@/lib/curriculum', () => ({
  courses: () => tables.courses.map((row) => ({ code: String(row.code), packages: (row.packages as string[] | undefined) ?? [] })),
  course: (code: string) => { const row = tables.courses.find((c) => c.code === code); return row ? { code: String(row.code), packages: (row.packages as string[] | undefined) ?? [] } : null },
  clo: (id: string) => { const row = tables.clos.find((c) => c.id === id); return row ? mapClo(row) : null },
  closFor: (course: string) => tables.clos.filter((c) => c.course === course).map(mapClo),
  exerciseFrom: (code: string, id: string) => spies.exerciseFrom(code, id),
}))
const diagnosis = { intent: 'You were finding a value.', rootCause: 'The result is absent.', mistakeLabel: 'missing-return', fixPlan: ['Read the return path.', 'Return the value.', 'Run the tests again.'] }
const hint = { hint: 'Check the return path.', planStep: 2 }
const review = { improvements: ['Name the result clearly.', 'Keep the return path short.'] as [string, string], quality: 90, praise: 'You followed the data.' }
const envelope = (agent: AgentName, reply: unknown): AgentEnvelope<unknown> => ({ ok: true, agent, reply, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } })
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let failWrite: string | null
/** X1: simulates schema 0005, where `user_achievements` does not exist yet -- a real Postgres
 *  "relation does not exist" carries `code: '42P01'`, which `record.ts`'s `isMissingObjectError`
 *  checks for to no-op instead of throwing. */
let missingTable: string | null = null
let loseStateAck = false
let store: LearnerState
let lastOrFilter: string | null = null
const rowOf = (e: ExercisePublic): Row => ({ ...e, clo_id: e.cloId, starter_code: e.starterCode, verified: true })

/** Holds one table's next operation (read or write) open until released -- proves the graded
 *  verdict renders before that write's promise ever resolves (brief acceptance: "spy on the
 *  Supabase insert and resolve it late"), and separately that `next()`'s in-place swap (fix
 *  round C1) never waits on the background attempts refresh, a read. */
let holds: Partial<Record<string, { promise: Promise<void>; release: () => void }>> = {}
function holdWrite(table: string): () => void {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  holds[table] = { promise, release }
  return () => release()
}

function query(table: string) {
  let action = 'read'; let payload: Row | Row[] | undefined; let single = false; let limit = Infinity
  const filters: Array<(row: Row) => boolean> = []
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return builder },
    or: (condition: string) => { lastOrFilter = condition; const raw = condition.split('last_attempt_at.lte.')[1]; const timestamp = raw?.replace(/^"|"$/g, ''); filters.push(row => row.last_attempt_at == null || String(row.last_attempt_at) <= timestamp); return builder },
    order: () => builder,
    limit: (count: number) => { limit = count; return builder },
    maybeSingle: () => { single = true; return builder },
    single: () => { single = true; return builder },
    insert: (value: Row | Row[]) => { action = 'insert'; payload = value; return builder },
    upsert: (value: Row | Row[], options?: { ignoreDuplicates?: boolean }) => { action = options?.ignoreDuplicates ? 'insert' : 'upsert'; payload = value; return builder },
    update: (value: Row) => { action = 'update'; payload = value; return builder },
    then: (resolve: (result: { data: Row | Row[] | null; error: { message: string; code?: string } | null }) => unknown) => (async () => {
      const hold = holds[table]
      if (hold) { delete holds[table]; await hold.promise }
      if (missingTable === table) return resolve({ data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } })
      if (failWrite === table && action !== 'read') { failWrite = null; return resolve({ data: null, error: { message: 'write temporarily unavailable' } }) }
      const rows = tables[table] ??= []
      let found = rows.filter(row => filters.every(filter => filter(row))).slice(0, limit)
      if (action === 'insert' || action === 'upsert') {
        const batch = Array.isArray(payload) ? payload : [payload!]
        found = batch.map(value => {
          const old = rows.find(row => table === 'attempts' ? row.id === value.id : table === 'mastery' ? row.user_id === value.user_id && row.clo_id === value.clo_id : table === 'user_achievements' ? row.user_id === value.user_id && row.achievement_id === value.achievement_id : row.user_id === value.user_id)
          if (old) { if (action === 'upsert' && table !== 'attempts') Object.assign(old, value); return old }
          rows.push({ ...value }); return rows[rows.length - 1]
        })
      } else if (action === 'update') { found.forEach(row => Object.assign(row, payload)) }
      if (table === 'learner_state' && action !== 'read' && found[0]) store = found[0].state as LearnerState
      if (loseStateAck && table === 'learner_state' && action !== 'read') { loseStateAck = false; return resolve({ data: null, error: { message: 'acknowledgement lost' } }) }
      return resolve({ data: single ? found[0] ?? null : found, error: null })
    })(),
  }
  return builder
}

function resultOf(ok: boolean, tests = current.tests): RunResult {
  return { ok, results: tests.map(test => ({ testId: test.id, passed: ok, actual: ok ? test.expected : 'undefined', expected: test.expected, stdout: '', stderr: '', durationMs: 2, ...(ok ? {} : { failureKind: 'wrong-answer' as const }) })), passedCount: ok ? tests.length : 0, totalCount: tests.length, runtime: 'browser' }
}
function setup(id = 'e1', motionPref?: 'system' | 'reduced' | 'full') {
  const initial = { user: { id: 'student' } as User, profile: { id: 'student', account_status: 'active' as const, restricted_until: null }, learnerState: store }
  const wrapper = ({ children }: PropsWithChildren) => <SessionProvider initialState={initial}>{children}</SessionProvider>
  return renderHook(() => useExerciseLoop(id, motionPref), { wrapper })
}
async function loaded(id = 'e1', motionPref?: 'system' | 'reduced' | 'full') { const hook = setup(id, motionPref); await waitFor(() => expect(hook.result.current.status).toBe('ready')); return hook }
beforeEach(() => {
  vi.clearAllMocks()
  // Fix round 4: `pendingHandoff`/`pendingSubmissions` are real module-scope singletons (the
  // whole point is surviving a remount) -- shared by every `it()` in this file's single process,
  // so a record an earlier test left pending (several fixtures below fail a write on purpose)
  // would otherwise leak into a later test's fresh mount of the same user+exercise id.
  __resetExerciseLoopModuleStateForTests()
  store = { ...compileLearnerState({ id: 'student' }, [], [], [], null), version: 1 }
  tables = { exercises_public: [rowOf(current), rowOf(candidate)], clos: [clo], courses: [{ code: 'course1', packages: [] }], attempts: [], mastery: [], learner_state: [{ user_id: 'student', state: store, version: 1 }] }
  failWrite = null
  missingTable = null
  loseStateAck = false
  lastOrFilter = null
  holds = {}
  spies.from.mockImplementation(query)
  spies.warmup.mockResolvedValue(undefined)
  spies.progress.mockImplementation(() => () => {})
  spies.exerciseFrom.mockReturnValue(null)
  spies.invalidate.mockResolvedValue(undefined)
  spies.getQueryData.mockReturnValue(undefined)
  spies.run.mockImplementation(async req => req.tests.length === 0 ? { ...resultOf(true, []), stdout: 'free output' } : resultOf(req.code.includes('fixed') || req.code.includes('reference'), req.tests))
  spies.stream.mockImplementation(async (req, partial) => { partial(req.agent === 'diagnoser' ? { rootCause: 'Unvalidated partial.' } : { hint: 'Partial hint.' }); return envelope(req.agent, req.agent === 'diagnoser' ? diagnosis : hint) })
  spies.call.mockImplementation(async req => envelope(req.agent, req.agent === 'reviewer' ? review : { path: ['c1'], nextExerciseIds: ['e2'], focus: 'Continue.' }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('exercise loop triggers and durable progress', () => {
  it('calls no agents on mount, typing, free run, or timer; calls only the triggered agents once', async () => {
    const hook = await loaded()
    vi.useFakeTimers()
    act(() => hook.result.current.setCode('wrong'))
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); await hook.result.current.run() })
    expect(spies.call).not.toHaveBeenCalled(); expect(spies.stream).not.toHaveBeenCalled()
    expect(hook.result.current.stdout).toBe('free output')
    await act(async () => { await hook.result.current.submit() })
    expect(spies.stream.mock.calls.map(([req]) => req.agent)).toEqual(['diagnoser'])
    expect(hook.result.current.diagnosis).toEqual(diagnosis)
    expect(hook.result.current.partialDiagnosis).toBeNull()
    expect(tables.attempts).toHaveLength(1)
    expect(store.recentMistakes[0].label).toBe('missing-return')
    expect(lastOrFilter).toBe(`last_attempt_at.is.null,last_attempt_at.lte."${tables.attempts[0].created_at}"`)
    expect(hook.result.current.hintAvailable).toBe(false)
    act(() => hook.result.current.setCode('edited'))
    expect(hook.result.current.hintAvailable).toBe(true)
    await act(async () => { await hook.result.current.requestHint() })
    expect(spies.stream.mock.calls.map(([req]) => req.agent)).toEqual(['diagnoser', 'coach'])
    act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await Promise.all([hook.result.current.submit(), hook.result.current.submit()]) })
    expect(spies.call.mock.calls.map(([req]) => req.agent)).toEqual(['reviewer'])
    expect(store.points).toBe(335)
    expect(store.mastery.c1).toMatchObject({ chain: 1, closed: false, patternsPassed: ['scan'] })
    expect(hook.result.current.nextExercise?.pattern).toBe('reduce')
    await act(async () => { await hook.result.current.submit(); await hook.result.current.next() })
    expect(spies.call).toHaveBeenCalledTimes(1)
    expect(tables.attempts).toHaveLength(2)
    // Step 4 / fix round 5 (binding ruling on the review's C1/I1/I2): back through the real
    // router -- `router.replace`, never `router.push` (which would pile onto the back stack) and
    // never the raw History API round 4 used (which left the route's own param permanently stale,
    // filing every later integrity event under the wrong exercise -- C1). `queueNext` already
    // prefetched this exact route the moment it chose 'e2', well before this `next()` call.
    expect(spies.replace).toHaveBeenCalledWith('/exercise/e2')
    expect(spies.push).not.toHaveBeenCalled()
    expect(spies.prefetch).toHaveBeenCalledWith('/exercise/e2')
  })

  it('unlocks first hints at 60 seconds or edit after each failure, then requires cooldown and caps five', async () => {
    const hook = await loaded(); vi.useFakeTimers()
    await act(async () => { await hook.result.current.submit(); await vi.advanceTimersByTimeAsync(59_000) })
    expect(hook.result.current.hintAvailable).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); await hook.result.current.requestHint() })
    act(() => hook.result.current.setCode('edited'))
    await act(async () => { await hook.result.current.submit(); await hook.result.current.requestHint() })
    expect(spies.stream.mock.calls.filter(([req]) => req.agent === 'coach')).toHaveLength(1)
    act(() => hook.result.current.setCode('edit after the new failure'))
    await act(async () => { await hook.result.current.requestHint(); await hook.result.current.requestHint() })
    expect(spies.stream.mock.calls.filter(([req]) => req.agent === 'coach')).toHaveLength(2)
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await hook.result.current.requestHint() })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await hook.result.current.requestHint() })
    expect(hook.result.current.hintCount).toBe(5)
    expect(spies.stream.mock.calls.filter(([req]) => req.agent === 'coach')).toHaveLength(5)
    expect(hook.result.current.hintAvailable).toBe(false)
  })

  it('refunds a hint when streamAgent rejects without ever streaming a partial frame', async () => {
    const hook = await loaded()
    await act(async () => { await hook.result.current.submit() })
    act(() => hook.result.current.setCode('edited'))
    spies.stream.mockImplementationOnce(async () => { throw new Error('network down') })
    await act(async () => { await hook.result.current.requestHint() })
    expect(hook.result.current.hintCount).toBe(0)
    expect(hook.result.current.error).toContain('network down')
    expect(hook.result.current.hintAvailable).toBe(true)
    const receipt = JSON.parse(sessionStorage.getItem('brogram:hints:student:e1')!)
    expect(receipt.count).toBe(0)
    expect(receipt.calledAt).toBeNull()
  })

  it('keeps a spent hint charged when streamAgent rejects after streaming a partial frame', async () => {
    const hook = await loaded()
    await act(async () => { await hook.result.current.submit() })
    act(() => hook.result.current.setCode('edited'))
    spies.stream.mockImplementationOnce((_req, partial) => { partial({ hint: 'partial hint' }); return Promise.reject(new Error('dropped mid-stream')) })
    await act(async () => { await hook.result.current.requestHint() })
    expect(hook.result.current.hintCount).toBe(1)
    expect(hook.result.current.error).toContain('dropped mid-stream')
    const receipt = JSON.parse(sessionStorage.getItem('brogram:hints:student:e1')!)
    expect(receipt.count).toBe(1)
  })

  it('retries persistence without repeating the attempt or Reviewer and awards points once', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    failWrite = 'learner_state'
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.error).toContain('write temporarily unavailable')
    expect(hook.result.current.controlsDisabled).toBe(true)
    act(() => hook.result.current.setCode('must not overwrite the pending answer'))
    expect(hook.result.current.code).toBe('fixed')
    await act(async () => { await hook.result.current.retry() })
    expect(hook.result.current.status).toBe('passed')
    expect(tables.attempts).toHaveLength(1)
    expect(spies.call.mock.calls.filter(([req]) => req.agent === 'reviewer')).toHaveLength(1)
    expect(store.points).toBe(345)
  })

  it('does not diagnose or append a mistake until the attempt is durable', async () => {
    const hook = await loaded(); failWrite = 'attempts'
    await act(async () => { await hook.result.current.submit() })
    expect(spies.stream).not.toHaveBeenCalled(); expect(store.recentMistakes).toEqual([])
    await act(async () => { await hook.result.current.retry() })
    expect(tables.attempts).toHaveLength(1); expect(store.recentMistakes).toHaveLength(1)
    expect(spies.stream).toHaveBeenCalledTimes(1)
    expect(hook.result.current.controlsDisabled).toBe(false)
  })

  it('keeps Coach consumption across reload and only reopens the first hint on a new failed attempt', async () => {
    const first = await loaded()
    await act(async () => { await first.result.current.submit() })
    act(() => first.result.current.setCode('edited'))
    await act(async () => { await first.result.current.requestHint() })
    expect(first.result.current.hintCount).toBe(1)
    first.unmount()
    const second = await loaded()
    expect(second.result.current.hintCount).toBe(1)
    await act(async () => { await second.result.current.requestHint() })
    expect(spies.stream.mock.calls.filter(([req]) => req.agent === 'coach')).toHaveLength(1)
    await act(async () => { await second.result.current.submit() })
    act(() => second.result.current.setCode('edited again'))
    expect(second.result.current.hintAvailable).toBe(true)
    await act(async () => { await second.result.current.requestHint() })
    expect(spies.stream.mock.calls.filter(([req]) => req.agent === 'coach')).toHaveLength(2)
    const receipt = JSON.parse(sessionStorage.getItem('brogram:hints:student:e1')!)
    expect(receipt.failureId).toBe(tables.attempts[1].id)
  })

  it('keeps hidden grading output out of free-run output', async () => {
    spies.run.mockResolvedValue({ ...resultOf(false), stdout: 'HIDDEN INPUT', stderr: 'HIDDEN EXPECTED' })
    const hook = await loaded()
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.stdout).toBe('')
    expect(hook.result.current.stderr).toBe('')
  })

  it('keeps the first hint unlocked after an edit is undone', async () => {
    const hook = await loaded()
    await act(async () => { await hook.result.current.submit() })
    act(() => { hook.result.current.setCode('edit'); hook.result.current.setCode(current.starterCode) })
    expect(hook.result.current.hintAvailable).toBe(true)
  })

  it('publishes attempt activity for the wellness and lockdown seams and clears it on exit', async () => {
    const hook = await loaded()
    expect(sessionStorage.getItem('brogram:attempt-active')).toBe('false')
    act(() => hook.result.current.setCode('edited'))
    expect(sessionStorage.getItem('brogram:attempt-active')).toBe('true')
    await act(async () => { await hook.result.current.submit() })
    expect(sessionStorage.getItem('brogram:attempt-active')).toBe('false')
    act(() => hook.result.current.setCode('edit again'))
    hook.unmount()
    expect(sessionStorage.getItem('brogram:attempt-active')).toBe('false')
  })

  it('times each submission from its first edit rather than accumulating earlier attempts', async () => {
    const hook = await loaded(); vi.useFakeTimers()
    act(() => hook.result.current.setCode('wrong'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); await hook.result.current.submit() })
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await hook.result.current.submit() })
    expect(tables.attempts.map(row => row.duration_ms)).toEqual([10_000, 5000])
  })

  it('does not replay points after a lost acknowledgement and newer progress in another tab', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed')); loseStateAck = true
    await act(async () => { await hook.result.current.submit() })
    expect(store.points).toBe(345)
    const newer = { ...store, version: store.version + 1, points: 700, mastery: { c1: { ...store.mastery.c1, lastAttemptAt: '2099-01-01T00:00:00Z' } } }
    tables.learner_state[0] = { user_id: 'student', state: newer, version: newer.version }; store = newer
    await act(async () => { await hook.result.current.retry() })
    expect(store.points).toBe(700)
    expect(hook.result.current.error).toContain('newer')
    expect(spies.call.mock.calls.filter(([req]) => req.agent === 'reviewer')).toHaveLength(1)
  })

  it('repairs a failed mastery write using the latest state without overwriting newer mastery', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed')); failWrite = 'mastery'
    await act(async () => { await hook.result.current.submit() })
    const newer = { ...store, version: store.version + 1, points: 999, mastery: { c1: { ...store.mastery.c1, score: 99, lastAttemptAt: '2099-01-01T00:00:00Z' } } }
    tables.learner_state[0] = { user_id: 'student', state: newer, version: newer.version }; store = newer
    tables.mastery[0] = { user_id: 'student', clo_id: 'c1', score: 99, last_attempt_at: '2099-01-01T00:00:00Z' }
    await act(async () => { await hook.result.current.retry() })
    expect(tables.mastery[0].score).toBe(99)
    expect(store.points).toBe(999)
  })

  it('renders partial diagnosis without storing it, then replaces it with the terminal reply', async () => {
    const hook = await loaded()
    let finish!: (value: AgentEnvelope<unknown>) => void
    spies.stream.mockImplementationOnce((_req, partial) => { partial({ rootCause: 'Partial cause', mistakeLabel: 'do-not-store' }); return new Promise(resolve => { finish = resolve }) })
    let pending!: Promise<void>
    await act(async () => { pending = hook.result.current.submit(); await Promise.resolve() })
    expect(hook.result.current.partialDiagnosis?.rootCause).toBe('Partial cause')
    expect(store.recentMistakes).toEqual([])
    await act(async () => { finish(envelope('diagnoser', diagnosis)); await pending })
    expect(store.recentMistakes[0].label).toBe('missing-return')
    expect(hook.result.current.partialDiagnosis).toBeNull()
  })

  it('closes only with the frozen closed flag and refreshes the Planner once', async () => {
    store.mastery.c1 = { userId: 'student', cloId: 'c1', score: 28, chain: 2, patternsPassed: ['reduce', 'partition'], closed: false, lastAttemptAt: null }
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(store.mastery.c1.closed).toBe(true)
    expect(spies.call.mock.calls.map(([req]) => req.agent)).toEqual(['reviewer', 'planner'])
    // `focus` is not part of the frozen LearnerState contract; it rides along as an extra
    // jsonb key alongside path and nextExerciseIds from the same plan-refresh reply.
    expect((store as LearnerState & { focus?: string }).focus).toBe('Continue.')
    await act(async () => { await hook.result.current.next() })
    expect(spies.push).toHaveBeenCalledWith('/dashboard')
  })

  it('continues a CLO across runtimes when its next pattern is a web exercise', async () => {
    tables.exercises_public[1] = rowOf({ ...candidate, language: 'web' })
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.nextExercise).toMatchObject({ id: 'e2', language: 'web', pattern: 'reduce' })
    expect(spies.call.mock.calls.map(([req]) => req.agent)).toEqual(['reviewer'])
  })

  it('verifies an authored reference and opens only its public shape after a bank miss', async () => {
    tables.exercises_public[0] = rowOf({ ...current, difficulty: 1 })
    tables.attempts = [{ id: 'old', user_id: 'student', exercise_id: 'e2', passed: true, hint_count: 0, created_at: '2026-09-04T10:00:00Z' }]
    const generated = { ...candidate, id: 'generated', referenceSolution: 'reference' }
    spies.call.mockImplementation(async req => envelope(req.agent, req.agent === 'reviewer' ? review : { exercise: generated }))
    const verify = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', verify)
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    const author = spies.call.mock.calls.find(([req]) => req.agent === 'author')?.[0]
    expect(author).toMatchObject({ exampleIds: ['e1', 'e2'], parentExerciseId: 'e1', pattern: 'reduce', difficulty: 3 })
    expect(verify).toHaveBeenCalledWith('/api/exercises/verify', expect.objectContaining({ body: JSON.stringify({ id: 'generated' }) }))
    expect(hook.result.current.nextExercise?.id).toBe('generated')
    expect(hook.result.current.nextExercise).not.toHaveProperty('referenceSolution')
  })

  it('falls back to the nearest different bank pattern if Author verification fails', async () => {
    tables.attempts = [{ id: 'old', user_id: 'student', exercise_id: 'e2', passed: true, hint_count: 0 }]
    spies.call.mockImplementation(async req => envelope(req.agent, req.agent === 'reviewer' ? review : { exercise: { ...candidate, id: 'generated', referenceSolution: 'wrong' } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.nextExercise?.id).toBe('e2')
    expect(warn).toHaveBeenCalled(); warn.mockRestore()
  })

  it('uses the nearest course fallback without calling Author when two distinct CLO examples are absent', async () => {
    tables.exercises_public = [rowOf(current), rowOf({ ...candidate, cloId: 'c2' })]
    tables.clos.push({ ...clo, id: 'c2' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.nextExercise?.id).toBe('e2')
    expect(spies.call.mock.calls.map(([req]) => req.agent)).toEqual(['reviewer'])
    expect(warn).toHaveBeenCalled(); warn.mockRestore()
  })

  it.each(['predict-output', 'spot-the-bug', 'trace', 'schema'] as const)('sends typed %s answers to Diagnoser and an empty Coach diff', async kind => {
    tables.exercises_public[0] = rowOf({ ...current, kind, tests: [{ ...current.tests[0], expected: kind === 'spot-the-bug' ? '[2]' : kind === 'trace' ? '{"count":"1"}' : '1' }] })
    const hook = await loaded(); act(() => hook.result.current.setCode('wrong answer'))
    await act(async () => { await hook.result.current.submit() })
    act(() => hook.result.current.setCode('edited answer'))
    await act(async () => { await hook.result.current.requestHint() })
    expect(spies.stream.mock.calls[0][0]).toMatchObject({ agent: 'diagnoser', code: 'wrong answer' })
    expect(spies.stream.mock.calls[1][0]).toMatchObject({ agent: 'coach', diffSinceLastHint: '', currentCode: 'edited answer' })
  })
})

describe('the optimistic submit path (T2.2)', () => {
  it('C1 fix round: next() swaps the exercise in place, synchronously, never waiting on the attempts read', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.nextExercise?.id).toBe('e2')
    // Hold the background attempts refresh open -- if next() depended on it, the exercise would
    // still read 'e1' (or the page would blank) until `release()` is called below.
    const release = holdWrite('attempts')
    act(() => { void hook.result.current.next() })
    expect(hook.result.current.exercise?.id).toBe('e2')
    expect(hook.result.current.exercise?.pattern).toBe('reduce')
    expect(hook.result.current.code).toBe(candidate.starterCode)
    expect(hook.result.current.status).toBe('ready')
    expect(hook.result.current.outcome).toBeNull()
    // Fix round 5: the local, synchronous swap above happens regardless of the router call below
    // it (they're deliberately independent -- see the hook's own comment on `next()`) -- proven
    // here by asserting it landed even though the background attempts refresh is still held open.
    expect(spies.replace).toHaveBeenCalledWith('/exercise/e2')
    release()
  })

  it("V4 / A11Y-03 fix round: honours an in-app reduced motion preference for next()'s view transition, even on a full-motion OS", async () => {
    // jsdom in this suite reports no `matchMedia` at all (never stubbed here), which
    // `useReducedMotion`'s own OS reader treats as "no preference either way" -- exactly the
    // full-motion-OS case this fix exists for. A bare `useReducedMotion()` would resolve to
    // `false` here; passing `'reduced'` as this hook's own second argument must still win.
    const startViewTransition = vi.fn((cb: () => void) => cb())
    const doc = document as unknown as { startViewTransition?: typeof startViewTransition }
    doc.startViewTransition = startViewTransition
    try {
      const hook = await loaded('e1', 'reduced'); act(() => hook.result.current.setCode('fixed'))
      await act(async () => { await hook.result.current.submit() })
      expect(hook.result.current.nextExercise?.id).toBe('e2')
      act(() => { void hook.result.current.next() })
      expect(hook.result.current.exercise?.id).toBe('e2') // the swap still lands either way
      expect(startViewTransition).not.toHaveBeenCalled()
    } finally {
      delete doc.startViewTransition
    }
  })

  it("V4 / A11Y-03 fix round: still takes the view transition for a 'full' preference on the same OS", async () => {
    const startViewTransition = vi.fn((cb: () => void) => cb())
    const doc = document as unknown as { startViewTransition?: typeof startViewTransition }
    doc.startViewTransition = startViewTransition
    try {
      const hook = await loaded('e1', 'full'); act(() => hook.result.current.setCode('fixed'))
      await act(async () => { await hook.result.current.submit() })
      expect(hook.result.current.nextExercise?.id).toBe('e2')
      act(() => { void hook.result.current.next() })
      expect(hook.result.current.exercise?.id).toBe('e2')
      expect(startViewTransition).toHaveBeenCalledTimes(1)
    } finally {
      delete doc.startViewTransition
    }
  })

  it('N1 fix round 2: next() takes the CLO from the target exercise, not the CLO the learner just left', async () => {
    // The exact cross-CLO fallback scenario from "uses the nearest course fallback..." above:
    // the bank/Author path both come up empty for c1, so `queueNext` widens to every CLO in the
    // course (`closFor`) and can legitimately hand back an exercise that belongs to a sibling
    // CLO (c2). Reusing the stale `cloRef.current` (c1) here would run the new rep under the
    // wrong outcome text, the wrong bank query on its own next submit, and a wrong clo-close name.
    tables.exercises_public = [rowOf(current), rowOf({ ...candidate, cloId: 'c2' })]
    tables.clos.push({ ...clo, id: 'c2', outcome: 'A sibling outcome' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.nextExercise?.id).toBe('e2')
    expect(hook.result.current.nextExercise?.cloId).toBe('c2')
    expect(hook.result.current.clo?.id).toBe('c1') // still on the CLO just passed, pre-next()
    act(() => { void hook.result.current.next() })
    expect(hook.result.current.exercise?.id).toBe('e2')
    expect(hook.result.current.clo?.id).toBe('c2') // the TARGET's CLO, not the one left behind
    expect(hook.result.current.clo?.outcome).toBe('A sibling outcome')
    warn.mockRestore()
  })

  it('fix round 4/5: a forced remount mid-submit (before grading resolves) still lands the eventual verdict, its durability writes, and a usable nextExercise', async () => {
    // "mid-submit": the remount happens while the runtime call itself is still in flight -- before
    // any verdict exists at all. The old per-instance `generation` guard right after this exact
    // call used to make the whole submission vanish the instant the calling instance unmounted;
    // fix round 4 registers a placeholder in the module-level `pendingSubmissions` store BEFORE
    // this call starts, so a freshly mounted instance for the same user+exercise can find it.
    const hook1 = await loaded(); act(() => hook1.result.current.setCode('fixed'))
    let releaseRun!: () => void
    spies.run.mockImplementationOnce(() => new Promise(resolve => { releaseRun = () => resolve(resultOf(true)) }))
    let settled = false
    const submission = hook1.result.current.submit().then(() => { settled = true })
    await waitFor(() => expect(hook1.result.current.busy).toBe(true))
    hook1.unmount() // simulate the App Router remounting the segment mid-run
    const hook2 = setup() // a genuinely fresh instance -- same user, same exercise id
    await waitFor(() => expect(hook2.result.current.status).toBe('submitting'))
    expect(settled).toBe(false) // the original run is still genuinely in flight, not lost
    releaseRun()
    await act(async () => { await submission })
    await waitFor(() => expect(hook2.result.current.status).toBe('passed'))
    expect(hook2.result.current.outcome).toBe('passed')
    // The durability chain landed for real, even though the instance that started it is gone.
    expect(tables.attempts).toHaveLength(1)
    expect(store.mastery.c1).toMatchObject({ chain: 1, closed: false, patternsPassed: ['scan'] })
    // Fix round 5, C2 (review): the remounted instance is not stranded at "Pass saved." with a
    // dead button -- `queueNext` (part of the same durability chain, run before `setStatus('passed')`)
    // recorded the exercise it chose onto the module record, and the settle handler restored it.
    expect(hook2.result.current.nextExercise?.id).toBe('e2')
    expect(hook2.result.current.canAdvance).toBe(true)
  })

  it('fix round 4/5: a forced remount mid-grade (verdict known, durability chain still saving) hydrates the verdict immediately and reconciles once the save lands, canAdvance included', async () => {
    // "mid-grade": the remount happens right after grading resolves (the CPU-throttle
    // investigation's own reproduced mechanism, exactly this timing) but before the background
    // `attempts`/`learner_state`/`mastery` writes finish.
    const hook1 = await loaded(); act(() => hook1.result.current.setCode('fixed'))
    const release = holdWrite('attempts')
    let settled = false
    const submission = hook1.result.current.submit().then(() => { settled = true })
    await waitFor(() => expect(hook1.result.current.status).toBe('graded'))
    expect(hook1.result.current.outcome).toBe('passed')
    hook1.unmount() // simulate the App Router remounting the segment right after the verdict
    const hook2 = setup()
    await waitFor(() => expect(hook2.result.current.status).toBe('graded'))
    expect(hook2.result.current.outcome).toBe('passed')
    expect(hook2.result.current.pointsProvisional).toBe(true) // hydrated straight off the optimistic snapshot
    expect(hook2.result.current.canAdvance).toBe(false) // the save this snapshot stands in for hasn't landed -- honestly disabled
    expect(settled).toBe(false) // the save this snapshot is standing in for has not landed yet
    release()
    await act(async () => { await submission })
    await waitFor(() => expect(hook2.result.current.status).toBe('passed'))
    expect(hook2.result.current.pointsProvisional).toBe(false) // reconciled to the real Reviewer quality
    expect(tables.attempts).toHaveLength(1)
    expect(store.mastery.c1).toMatchObject({ chain: 1, closed: false, patternsPassed: ['scan'] })
    // Fix round 5, C2 (review): C2's own repro -- without this the remounted instance reached
    // `status: 'passed'` with `nextExercise: null` and `canAdvance: false`, a permanent dead end.
    expect(hook2.result.current.nextExercise?.id).toBe('e2')
    expect(hook2.result.current.canAdvance).toBe(true)
  })

  it('fix round 5: a remounted instance for the exercise `queueNext` already chose hydrates synchronously from the prefetch store, no exercises_public fetch', async () => {
    // The "invisible remount" half of the binding ruling: `queueNext` prefetches the chosen
    // route and stashes its already-fetched content in `pendingHandoff` the moment it is known --
    // well before the learner ever clicks "Next rep" -- so the instance the real router.replace()
    // eventually remounts for that exercise never shows a loading state or refetches it.
    const hook1 = await loaded(); act(() => hook1.result.current.setCode('fixed'))
    await act(async () => { await hook1.result.current.submit() })
    expect(hook1.result.current.nextExercise?.id).toBe('e2')
    expect(spies.prefetch).toHaveBeenCalledWith('/exercise/e2') // queueNext prefetched it already
    spies.from.mockClear() // isolate hook2's own network calls from setup/submit above
    const hook2 = setup('e2') // simulates the App Router's remount landing on the target id
    expect(hook2.result.current.exercise?.id).toBe('e2') // synchronous -- no waitFor needed
    expect(hook2.result.current.status).not.toBe('loading')
    expect(spies.from.mock.calls.some(([table]) => table === 'exercises_public')).toBe(false)
  })

  it('T2.2 round 5 re-check, New-1: code typed in the ~500ms remount window survives, carried on the handoff', async () => {
    // Same shape as the zero-fetch hydration test above -- the fix is that `pendingHandoff` now
    // also carries whatever `setCode` wrote for the exercise on screen, and the remounted
    // instance seeds from it instead of silently reseeding the exercise's own starter code.
    const hook1 = await loaded(); act(() => hook1.result.current.setCode('fixed'))
    await act(async () => { await hook1.result.current.submit() })
    expect(hook1.result.current.nextExercise?.id).toBe('e2')
    act(() => { void hook1.result.current.next() }) // the local, synchronous paint of e2
    expect(hook1.result.current.exercise?.id).toBe('e2')
    expect(hook1.result.current.code).toBe(candidate.starterCode) // nothing typed yet
    // A keystroke landing on the still-displayed (about to be destroyed) old instance, in the
    // window before the real router-driven remount lands.
    act(() => { hook1.result.current.setCode('typed while the router caught up') })
    const hook2 = setup('e2') // the remount: a fresh instance for the same target exercise
    expect(hook2.result.current.exercise?.id).toBe('e2') // synchronous -- no waitFor needed
    expect(hook2.result.current.code).toBe('typed while the router caught up')
  })

  it('reaches the graded verdict before the attempts insert ever resolves', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    const release = holdWrite('attempts')
    let settled = false
    // Intentionally not wrapped in (or awaited by) `act()` here -- the point of this test is to
    // observe state *while* the promise is still in flight, before the held write ever resolves;
    // `waitFor` below does its own act-wrapped polling. The final `await act(...)` after `release()`
    // flushes and settles everything for the assertions that follow.
    const submission = hook.result.current.submit().then(() => { settled = true })
    await waitFor(() => expect(hook.result.current.status).toBe('graded'))
    expect(hook.result.current.outcome).toBe('passed')
    expect(hook.result.current.results.every(result => result.passed)).toBe(true)
    expect(settled).toBe(false)
    expect(tables.attempts).toHaveLength(0)
    release()
    await act(async () => { await submission })
    expect(settled).toBe(true)
    expect(tables.attempts).toHaveLength(1)
  })

  it('reaches the graded verdict on a fail before the attempts insert resolves too', async () => {
    const hook = await loaded()
    const release = holdWrite('attempts')
    let settled = false
    const submission = hook.result.current.submit().then(() => { settled = true })
    await waitFor(() => expect(hook.result.current.status).toBe('graded'))
    expect(hook.result.current.outcome).toBe('failed')
    expect(settled).toBe(false)
    release()
    await act(async () => { await submission })
  })

  it('renders XP at the neutral quality first, then tweens to the Reviewer real value -- including a downward case', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    let releaseReviewer!: () => void
    spies.call.mockImplementationOnce(() => new Promise(resolve => { releaseReviewer = () => resolve(envelope('reviewer', { ...review, quality: 0 })) }))
    const submission = hook.result.current.submit()
    await waitFor(() => expect(hook.result.current.status).toBe('graded'))
    expect(hook.result.current.pointsEarned).toBe(335) // pointsForPass(3, 0, 70): the optimistic neutral figure
    expect(hook.result.current.pointsProvisional).toBe(true)
    releaseReviewer()
    await act(async () => { await submission })
    expect(hook.result.current.pointsEarned).toBe(300) // pointsForPass(3, 0, 0): a genuine drop, not a bump
    expect(hook.result.current.pointsProvisional).toBe(false)
  })

  it('leaves the graded verdict in place when the durability write fails, banner instead of rollback', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    failWrite = 'attempts'
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.outcome).toBe('passed')
    expect(hook.result.current.status).not.toBe('error')
    expect(hook.result.current.error).toContain('write temporarily unavailable')
    expect(hook.result.current.controlsDisabled).toBe(true)
    // C2 fix round: "Next exercise" must never look enabled while a click on it would silently
    // do nothing -- `canAdvance` is false here (no `nextExercise`/`closed` was ever reached).
    expect(hook.result.current.canAdvance).toBe(false)
  })

  it('fires each celebration exactly once per verdict, even across a retry of the background sync', async () => {
    // This first pass legitimately earns two distinct celebrations at once -- 'first-win' (the
    // account's very first pass) and 'chain' (0 -> 1) -- spec 7.6's own table has celebrations
    // compound this way (e.g. "clo.close layered with level.up"); the queue (T2.6) is what shows
    // them one at a time. Both fire from `submit()` itself, which a retry never re-enters, so
    // they are provably exactly-once here regardless of `celebrate()`'s own dedup.
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    failWrite = 'learner_state'
    await act(async () => { await hook.result.current.submit() })
    expect(spies.celebrate).toHaveBeenCalledWith('first-win', undefined, expect.any(String))
    expect(spies.celebrate.mock.calls.filter(([kind]) => kind === 'first-win')).toHaveLength(1)
    await act(async () => { await hook.result.current.retry() })
    expect(hook.result.current.status).toBe('passed')
    expect(spies.celebrate.mock.calls.filter(([kind]) => kind === 'first-win')).toHaveLength(1)
    // Level-up/streak/goal celebrations, by contrast, live inside `finishSubmission`, which a
    // retry genuinely re-enters -- this hook relies on `celebrate()`'s own real `eventId` dedup
    // (T2.6 fix round) to collapse those, exactly as the Opus review confirmed for level-up.
    // What this hook must still guarantee on its own is a STABLE id across the retry, which is
    // what actually lets that dedup work; a fresh id each time would defeat it silently.
    const eventIdsFor = (kind: string) => spies.celebrate.mock.calls.filter(([k]) => k === kind).map(([, , eventId]) => eventId)
    for (const kind of ['streak-ignite', 'streak-milestone', 'level-up', 'goal']) {
      const ids = new Set(eventIdsFor(kind))
      expect(ids.size).toBeLessThanOrEqual(1)
    }
  })

  it('I3 fix round: still reports the level-up crossing after a retried background sync, off the ORIGINAL pre-save points', async () => {
    // pointsForPass(3, 0, 90) === 345 (difficulty 3, no hints, the fixture Reviewer's quality
    // 90); 200 + 345 = 545 crosses xpToReach(2) === 500. The mastery-table write fails on the
    // first attempt -- AFTER the points save already landed -- so a naive re-read of
    // `state.points` inside `finishSubmission` on retry would see 545 on both sides and report
    // no crossing at all. `operation.beforePoints`, captured once at grading time, must not.
    store.points = 200
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    failWrite = 'mastery'
    await act(async () => { await hook.result.current.submit() })
    expect(store.points).toBe(545)
    expect(spies.celebrate).not.toHaveBeenCalledWith('level-up', expect.anything(), expect.any(String))
    await act(async () => { await hook.result.current.retry() })
    expect(hook.result.current.status).toBe('passed')
    expect(spies.celebrate).toHaveBeenCalledWith('level-up', expect.objectContaining({ level: 2 }), `${tables.attempts[0].id}:level`)
  })

  it('I4 fix round: a CLO-close Planner failure never strands the learner -- Submit/Next stay alive on the provisional plan', async () => {
    store.mastery.c1 = { userId: 'student', cloId: 'c1', score: 28, chain: 2, patternsPassed: ['reduce', 'partition'], closed: false, lastAttemptAt: null }
    spies.call.mockImplementation(async req => {
      if (req.agent === 'planner') throw new Error('DeepSeek outage')
      return envelope(req.agent, review)
    })
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(store.mastery.c1.closed).toBe(true)
    expect(hook.result.current.status).toBe('passed')
    expect(hook.result.current.closed).toBe(true)
    // The old behaviour: `pending.current` never clears, so Submit stays disabled and every
    // click on Next silently does nothing forever. The fix: the provisional plan absorbs the
    // outage and the learner is never shown an error for a background model call they cannot
    // see or retry.
    expect(hook.result.current.canAdvance).toBe(true)
    expect(hook.result.current.controlsDisabled).toBe(true) // still true, but for the RIGHT reason (outcome === 'passed')
    expect(hook.result.current.error).toBeNull()
    await act(async () => { await hook.result.current.next() })
    expect(spies.push).toHaveBeenCalledWith('/dashboard')
  })

  it('W2-SCHEMA-I3 fix round: a failed submission leaves state.streak byte-identical -- a streak day is a pass', async () => {
    // Binding ruling: migration 0008's `my_activity_days()` counts passes only, so a fail
    // bumping the client's own `streak.exerciseDays` (the pre-fix behaviour) would disagree with
    // the server the moment 0008 applies. The starter code never contains 'fixed', so submitting
    // it as-is fails without any `setCode` first (same shape as the "plays the fail sound" test).
    const before = { exerciseDays: 4, derotDays: 0, lastExerciseDate: '2020-01-01', lastDerotDate: null }
    store.streak = before
    const hook = await loaded()
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.outcome).toBe('failed')
    expect(store.streak).toBe(before) // reference-identical, not merely deep-equal
  })

  it("I5 fix round: fires streak-ignite on the day's first qualifying action", async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(spies.celebrate).toHaveBeenCalledWith('streak-ignite', { n: 1 }, expect.any(String))
    expect(spies.celebrate).not.toHaveBeenCalledWith('streak-milestone', expect.anything(), expect.any(String))
  })

  it('I5 fix round: fires streak-milestone (not the routine ignite) the day a streak crosses one', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    store.streak = { exerciseDays: 2, derotDays: 0, lastExerciseDate: yesterday, lastDerotDate: null }
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(spies.celebrate).toHaveBeenCalledWith('streak-milestone', { n: 3 }, expect.any(String))
    expect(spies.celebrate).not.toHaveBeenCalledWith('streak-ignite', expect.anything(), expect.any(String))
  })

  it('I5 fix round: fires goal.done and records the goal day once the third win of the day lands', async () => {
    const today = new Date().toISOString().slice(0, 10)
    tables.attempts = [
      { id: 'win-1', user_id: 'student', exercise_id: 'e1', passed: true, hint_count: 0, created_at: `${today}T01:00:00.000Z` },
      { id: 'win-2', user_id: 'student', exercise_id: 'e1', passed: true, hint_count: 0, created_at: `${today}T02:00:00.000Z` },
    ]
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    await waitFor(() => expect(spies.celebrate).toHaveBeenCalledWith('goal', undefined, expect.any(String)))
    const savedPrefs = (tables.wellness.find(row => row.user_id === 'student')?.prefs) as { goalDays?: string[] } | undefined
    expect(savedPrefs?.goalDays).toContain(today)
    // N2 fix round 2: the dock's goal ring reads `qk.wellness` from the shared query cache,
    // which is never refetched on focus -- without this the ring stays stale for the session
    // even though the write above genuinely landed.
    const wellnessInvalidations = spies.invalidate.mock.calls.filter(([arg]) => JSON.stringify(arg.queryKey) === JSON.stringify(qk.wellness('student')))
    expect(wellnessInvalidations.length).toBeGreaterThan(0)
  })

  it('X7 fix round: a goal met by a walkthrough and a de-rot run (not only exercise attempts) still records the goal day', async () => {
    // The bug this replaces: the old local `recordGoalAndStreak` hardcoded `lessonProgress`/
    // `drillResults` to `[]`, so a learner who met today's goal through a walkthrough and a
    // de-rot run (plus this one exercise pass) never got `goal.done` from THIS producer even
    // though the dashboard's own ring, built from the real cache, already read 3/3. The shared
    // `recordGoalDay` (record.ts) reads the same cache this hook now feeds it.
    const today = new Date().toISOString().slice(0, 10)
    spies.getQueryData.mockImplementation((key: readonly unknown[]) => {
      if (key[0] === 'lesson-progress') return [{ userId: 'student', lessonId: 'l1', cloId: 'c1', status: 'completed', blockIndex: 5, checksPassed: 3, checksFailed: 0, lessonVersion: 1, startedAt: `${today}T00:30:00.000Z`, completedAt: `${today}T00:45:00.000Z`, updatedAt: `${today}T00:45:00.000Z` }]
      if (key[0] === 'wellness') return { drill_results: [{ drillId: 'd1', kind: 'reaction', correct: true, timeMs: 400, score: 10, at: `${today}T01:00:00.000Z`, lane: 'play' }] }
      return undefined
    })
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed')) // the third win: this exercise pass
    await act(async () => { await hook.result.current.submit() })
    await waitFor(() => expect(spies.celebrate).toHaveBeenCalledWith('goal', undefined, expect.any(String)))
    const savedPrefs = (tables.wellness.find(row => row.user_id === 'student')?.prefs) as { goalDays?: string[] } | undefined
    expect(savedPrefs?.goalDays).toContain(today)
    // Once, not per source: `shouldRecordGoalDay` is a today-key membership check, and the same
    // context evaluated a second time (the settle handler's own `finally` runs once per settle
    // regardless) must not append a duplicate.
    expect(savedPrefs?.goalDays?.filter(day => day === today)).toHaveLength(1)
  })

  it('I5 fix round: does not fire goal.done before the daily goal is actually met', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    // Give the fire-and-forget goal check a moment to run either way -- it must not decide yes.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(spies.celebrate).not.toHaveBeenCalledWith('goal', expect.anything(), expect.any(String))
  })

  it('plays the routine pass sound and cue on a later pass, not the first-win one', async () => {
    store.points = 500
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(spies.celebrate).toHaveBeenCalledWith('pass', undefined, expect.any(String))
    expect(spies.play).toHaveBeenCalledWith('pass')
  })

  it('plays the fail sound and never celebrates a fail', async () => {
    const hook = await loaded()
    await act(async () => { await hook.result.current.submit() })
    expect(spies.play).toHaveBeenCalledWith('fail')
    expect(spies.celebrate).not.toHaveBeenCalled()
  })

  it('invalidates attempts, activity days, achievements and learner state once a submission settles', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    const keys = spies.invalidate.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey))
    expect(keys).toContain(JSON.stringify(qk.attempts('student')))
    expect(keys).toContain(JSON.stringify(qk.activityDays('student')))
    expect(keys).toContain(JSON.stringify(qk.achievements('student')))
    expect(keys).toContain(JSON.stringify(qk.learnerState('student')))
  })

  it('resolves a bundled exercise (a well-stocked CLO) with a single attempts read', async () => {
    spies.exerciseFrom.mockImplementation((code: string, id: string) => (code === 'course1' && id === 'e1' ? current : null))
    const hook = await loaded()
    expect(hook.result.current.exercise?.id).toBe('e1')
    expect(spies.from.mock.calls.map(([table]) => table)).toEqual(['attempts'])
  })

  it('falls back to a exercises_public read plus attempts for an id no loaded bundle has (the generated case)', async () => {
    const hook = await loaded()
    expect(hook.result.current.exercise?.id).toBe('e1')
    expect(spies.from.mock.calls.map(([table]) => table)).toEqual(['exercises_public', 'attempts'])
  })

  it('TI-4 fix round: pins the verified filter on the single-id read -- an unverified row for this id never resolves', async () => {
    tables.exercises_public = [{ ...rowOf(current), verified: false }, rowOf(candidate)]
    const hook = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('error'))
    expect(hook.result.current.exercise).toBeNull()
  })

  it('X1 fix round: evaluates a context whose first-blood is true off the first pass, and never blocks the optimistic pass on the write', async () => {
    const release = holdWrite('user_achievements')
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    // `submit()` (and the durability chain it awaits) resolves on its own -- `recordAchievements`
    // is called with `void` from `syncInBackground`'s `finally` block, so a slow write to a table
    // this pass does not otherwise touch can never strand the optimistic verdict.
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.outcome).toBe('passed')
    expect(hook.result.current.status).toBe('passed')
    expect((tables.user_achievements ?? []).length).toBe(0) // the held write has not landed yet
    release()
    // `firstBlood` (achievements.ts) is `ctx.attempts.some(a => a.passed)` -- true the instant this,
    // the account's very first pass, lands in `history.current`. The persisted row is the
    // black-box proof that the context handed to `recordAchievements` satisfied it.
    await waitFor(() => expect((tables.user_achievements ?? []).some(row => row.achievement_id === 'first-blood')).toBe(true))
  })

  it('X1 fix round: calls user_achievements, and degrades silently at schema 0005 (no such table yet) -- a pass can never crash on it', async () => {
    missingTable = 'user_achievements'
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.outcome).toBe('passed')
    // `recordAchievements` (record.ts) is fire-and-forget from `syncInBackground`'s `finally`
    // block -- it genuinely calls the table now (X1's whole point), unlike before this fix
    // round, and unlike a missing-table error anywhere else in the chain, this one is caught and
    // swallowed rather than surfaced as a save-failure banner.
    await waitFor(() => expect(spies.from.mock.calls.some(([table]) => table === 'user_achievements')).toBe(true))
    expect(hook.result.current.error).toBeNull()
    expect(hook.result.current.status).toBe('passed')
  })

  it('attaches the exercise difficulty to the reward-shaped attempt the moment it grades', async () => {
    const hook = await loaded(); act(() => hook.result.current.setCode('fixed'))
    await act(async () => { await hook.result.current.submit() })
    expect(hook.result.current.lastRewardAttempt).toMatchObject({ exerciseId: 'e1', difficulty: current.difficulty, passed: true })
  })
})
