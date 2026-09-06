import type { PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnvelope, AgentName, ExercisePublic, LearnerState, RunResult } from '@/lib/contracts'
import { compileLearnerState } from '@/lib/learner/compile'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { useExerciseLoop } from './useExerciseLoop'

const spies = vi.hoisted(() => ({ call: vi.fn(), stream: vi.fn(), run: vi.fn(), warmup: vi.fn(), abort: vi.fn(), push: vi.fn(), from: vi.fn(), progress: vi.fn() }))
vi.mock('@/lib/agents/client', () => ({ callAgent: spies.call, streamAgent: spies.stream }))
vi.mock('@/lib/runtimes', () => ({ getRuntime: vi.fn(() => ({ language: 'javascript', run: spies.run, warmup: spies.warmup, abort: spies.abort })), subscribeRuntimeProgress: spies.progress }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: spies.from }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: spies.push }) }))

const current: ExercisePublic = { id: 'e1', cloId: 'c1', language: 'javascript', kind: 'code', difficulty: 3, pattern: 'scan', title: 'Find a value', prompt: 'Return the requested value.', starterCode: 'function solve() {}', origin: 'seed', tags: [], tests: [{ id: 't1', input: '[]', expected: '1', hidden: false }] }
const candidate: ExercisePublic = { ...current, id: 'e2', pattern: 'reduce', title: 'Count the values' }
const clo = { id: 'c1', course: 'course1', ordinal: 1, outcome: 'Use collections', topics: [], prerequisites: [], patterns: ['scan', 'reduce', 'partition'], assessable_in_code: true, draft: false }
const diagnosis = { intent: 'You were finding a value.', rootCause: 'The result is absent.', mistakeLabel: 'missing-return', fixPlan: ['Read the return path.', 'Return the value.', 'Run the tests again.'] }
const hint = { hint: 'Check the return path.', planStep: 2 }
const review = { improvements: ['Name the result clearly.', 'Keep the return path short.'] as [string, string], quality: 90, praise: 'You followed the data.' }
const envelope = (agent: AgentName, reply: unknown): AgentEnvelope<unknown> => ({ ok: true, agent, reply, fallback: false, usage: { promptTokens: 1, completionTokens: 1, cacheHitTokens: 0 } })
type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let failWrite: string | null
let loseStateAck = false
let store: LearnerState
let lastOrFilter: string | null = null
const rowOf = (e: ExercisePublic): Row => ({ ...e, clo_id: e.cloId, starter_code: e.starterCode, verified: true })

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
    then: (resolve: (result: { data: Row | Row[] | null; error: { message: string } | null }) => unknown) => {
      if (failWrite === table && action !== 'read') { failWrite = null; return Promise.resolve(resolve({ data: null, error: { message: 'write temporarily unavailable' } })) }
      const rows = tables[table] ??= []
      let found = rows.filter(row => filters.every(filter => filter(row))).slice(0, limit)
      if (action === 'insert' || action === 'upsert') {
        const batch = Array.isArray(payload) ? payload : [payload!]
        found = batch.map(value => {
          const old = rows.find(row => table === 'attempts' ? row.id === value.id : table === 'mastery' ? row.user_id === value.user_id && row.clo_id === value.clo_id : row.user_id === value.user_id)
          if (old) { if (action === 'upsert' && table !== 'attempts') Object.assign(old, value); return old }
          rows.push({ ...value }); return rows[rows.length - 1]
        })
      } else if (action === 'update') { found.forEach(row => Object.assign(row, payload)) }
      if (table === 'learner_state' && action !== 'read' && found[0]) store = found[0].state as LearnerState
      if (loseStateAck && table === 'learner_state' && action !== 'read') { loseStateAck = false; return Promise.resolve(resolve({ data: null, error: { message: 'acknowledgement lost' } })) }
      return Promise.resolve(resolve({ data: single ? found[0] ?? null : found, error: null }))
    },
  }
  return builder
}

function resultOf(ok: boolean, tests = current.tests): RunResult {
  return { ok, results: tests.map(test => ({ testId: test.id, passed: ok, actual: ok ? test.expected : 'undefined', expected: test.expected, stdout: '', stderr: '', durationMs: 2, ...(ok ? {} : { failureKind: 'wrong-answer' as const }) })), passedCount: ok ? tests.length : 0, totalCount: tests.length, runtime: 'browser' }
}
function setup() {
  const initial = { user: { id: 'student' } as User, profile: { id: 'student', account_status: 'active' as const, restricted_until: null }, learnerState: store }
  const wrapper = ({ children }: PropsWithChildren) => <SessionProvider initialState={initial}>{children}</SessionProvider>
  return renderHook(() => useExerciseLoop('e1'), { wrapper })
}
async function loaded() { const hook = setup(); await waitFor(() => expect(hook.result.current.status).toBe('ready')); return hook }
beforeEach(() => {
  vi.clearAllMocks()
  store = { ...compileLearnerState({ id: 'student' }, [], [], [], null), version: 1 }
  tables = { exercises_public: [rowOf(current), rowOf(candidate)], clos: [clo], courses: [{ code: 'course1', packages: [] }], attempts: [], mastery: [], learner_state: [{ user_id: 'student', state: store, version: 1 }] }
  failWrite = null
  loseStateAck = false
  lastOrFilter = null
  spies.from.mockImplementation(query)
  spies.warmup.mockResolvedValue(undefined)
  spies.progress.mockImplementation(() => () => {})
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
    expect(spies.push).toHaveBeenCalledWith('/exercise/e2')
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
