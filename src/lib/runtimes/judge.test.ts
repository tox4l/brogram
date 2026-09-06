// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import smoke from '../../../seed/exercises/smoke.json'
import type { RunRequest, TestCase } from '@/lib/contracts'
import { JudgeAdapter } from './judge'

const tests: TestCase[] = [
  { id: 'first', input: 'square 2', expected: 'square:4.0', hidden: false },
  { id: 'second', input: 'circle 1', expected: 'circle:3.1', hidden: true },
]
const request: RunRequest = { language: 'java', code: 'public class Solution {}', fixture: 'public class Main {}', tests, timeoutMs: 5_000 }
const accepted = (stdout: string) => Response.json({ stdout, stderr: '', compileOutput: '', exitCode: 0, timedOut: false })

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('JudgeAdapter', () => {
  it('grades every Java smoke test with its reference and sends one compilable Main source file', async () => {
    const exercise = smoke.exercises.find(ex => ex.language === 'java')!
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.code).toContain('public class Main')
      expect(body.code).toContain('class Solution')
      expect(body.code).not.toContain('public class Solution')
      const test = exercise.tests.find(t => t.input === body.stdin)
      if (!test) throw new Error('unexpected stdin')
      return accepted(test.expected)
    })
    vi.stubGlobal('fetch', fetcher)
    const adapter = new JudgeAdapter()
    await adapter.warmup()
    const result = await adapter.run({ language: 'java', code: exercise.referenceSolution, fixture: exercise.fixture, tests: exercise.tests, timeoutMs: 5_000 })
    expect(result).toMatchObject({ ok: true, runtime: 'judge', totalCount: 5, passedCount: 5 })
    expect(result.results.every(r => r.passed && !r.failureKind)).toBe(true)
  })

  it('reports a missing judge key once with a clear runtime error but counts every requested test toward the total', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'judge-not-configured' }, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const result = await new JudgeAdapter().run(request)
    // A transport/configuration failure surfaces one actionable failure, not a duplicate
    // per hidden test, but totalCount must still reflect the full request so the UI does
    // not report "1 of 1" when the student actually submitted more tests.
    expect(result).toMatchObject({ ok: false, passedCount: 0, totalCount: request.tests.length })
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({ testId: 'first', failureKind: 'runtime-error', passed: false })
    expect(result.results[0].stderr).toMatch(/not configured|JUDGE0_API_KEY/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports an absent judge provider once with a clear runtime error but counts every requested test toward the total', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: false, error: 'judge-absent', message: 'Code execution for this language is not available yet.' }, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const result = await new JudgeAdapter().run(request)
    expect(result).toMatchObject({ ok: false, passedCount: 0, totalCount: request.tests.length })
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({ testId: 'first', failureKind: 'runtime-error', passed: false, stderr: 'Java execution is not available yet.' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ stdout: 'different', stderr: '', compileOutput: '', exitCode: 0, timedOut: false }, 'wrong-answer'],
    [{ stdout: '', stderr: 'limit', compileOutput: '', exitCode: 1, timedOut: true }, 'timeout'],
    [{ stdout: '', stderr: '', compileOutput: 'cannot find symbol', exitCode: 1, timedOut: false, failureKind: 'compile-error' }, 'compile-error'],
    [{ stdout: '', stderr: 'NullPointerException', compileOutput: '', exitCode: 1, timedOut: false }, 'runtime-error'],
  ])('maps provider result %j to %s', async (reply, failureKind) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(reply)))
    const result = await new JudgeAdapter().run({ ...request, tests: [tests[0]] })
    expect(result.results[0]).toMatchObject({ passed: false, failureKind })
  })

  it('captures a free run without requiring a test case', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accepted('hello\n')))
    const result = await new JudgeAdapter().run({ ...request, tests: [] })
    expect(result).toMatchObject({ ok: true, results: [], stdout: 'hello\n', stderr: '', totalCount: 0, passedCount: 0 })
  })

  it('aborts an in-flight request, settles remaining tests as timeouts, and permits another run', async () => {
    const fetcher = vi.fn().mockImplementationOnce((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })).mockImplementation(async () => accepted('square:4.0'))
    vi.stubGlobal('fetch', fetcher)
    const adapter = new JudgeAdapter()
    const pending = adapter.run(request)
    adapter.abort()
    const result = await pending
    expect(result.results).toHaveLength(2)
    expect(result.results.every(r => r.failureKind === 'timeout')).toBe(true)
    expect((await adapter.run({ ...request, tests: [tests[0]] })).ok).toBe(true)
  })

  it('settles a stalled network fetch at the requested deadline even if fetch ignores abort', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const pending = new JudgeAdapter().run({ ...request, timeoutMs: 45_000 })
    await vi.advanceTimersByTimeAsync(45_000)
    const result = await pending
    expect(result.results.every(r => r.failureKind === 'timeout')).toBe(true)
    expect(result.results).toHaveLength(2)
  })

  it('floors a short browser timeoutMs at 30 seconds for the remote judge deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const pending = new JudgeAdapter().run({ ...request, timeoutMs: 250 })
    // A 250ms browser timeout must not cut off a remote Judge0 round trip early.
    await vi.advanceTimersByTimeAsync(29_000)
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await pending
    expect(result.results.every(r => r.failureKind === 'timeout')).toBe(true)
    expect(result.results).toHaveLength(2)
  })
})
