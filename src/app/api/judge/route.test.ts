// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { getUserAndProfile, serviceClient } from '@/lib/supabase/server'
import { checkRate } from '@/lib/agents/ratelimit'
import { POST } from './route'

vi.mock('@/lib/supabase/server', () => ({ getUserAndProfile: vi.fn(), serviceClient: vi.fn() }))
vi.mock('@/lib/agents/ratelimit', () => ({ checkRate: vi.fn() }))

/** Supabase builders are lazy: a stub that only records on `.then()` proves the route awaits the insert. */
function usageStub(onInsert: (row: unknown) => void) {
  return {
    from: (_table: string) => ({
      insert: (row: unknown) => ({
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve().then(() => { onInsert(row); return { data: null, error: null } }).then(resolve, reject),
      }),
    }),
  }
}

const signedIn = { user: { id: 'student' } as User, profile: { id: 'student', account_status: 'active' as const, restricted_until: null } }
const body = { language: 'java', code: 'public class Solution {}', stdin: 'square 2', fixture: 'public class Main {}' }
function request(value: unknown = body) {
  return new Request('http://localhost/api/judge', { method: 'POST', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } })
}
const upstream = (id = 3) => ({ stdout: 'square:4.0', stderr: null, compile_output: null, status: { id, description: 'status' }, time: '0.02', memory: 10, token: 'token-123' })

beforeEach(() => {
  vi.mocked(getUserAndProfile).mockResolvedValue(signedIn)
  vi.mocked(checkRate).mockResolvedValue({ ok: true, message: '' })
  vi.mocked(serviceClient).mockReturnValue(usageStub(() => {}) as never)
  vi.stubEnv('JUDGE0_API_KEY', 'test-key')
  vi.stubEnv('JUDGE0_HOST', 'judge0-ce.p.rapidapi.com')
  vi.stubEnv('JUDGE_PROVIDER', 'judge0')
  vi.stubEnv('JUDGE_ALL_LANGUAGES', '')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(upstream())))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('POST /api/judge', () => {
  it('denies signed-out users before contacting the judge', async () => {
    vi.mocked(getUserAndProfile).mockResolvedValue({ user: null, profile: null })
    expect((await POST(request())).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('denies banned profiles', async () => {
    vi.mocked(getUserAndProfile).mockResolvedValue({ ...signedIn, profile: { ...signedIn.profile, account_status: 'banned' } })
    expect((await POST(request())).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects 65,000 characters and counts stdin plus fixture in the cap', async () => {
    expect((await POST(request({ ...body, code: 'x'.repeat(65_000) }))).status).toBe(413)
    expect((await POST(request({ ...body, code: 'x'.repeat(63_999), stdin: 'xx' }))).status).toBe(413)
    expect((await POST(request({ ...body, code: '', stdin: '', fixture: 'x'.repeat(65_000) }))).status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps non-Java judging disabled by default', async () => {
    const response = await POST(request({ ...body, language: 'python' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'judge-disabled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns judge-not-configured when the key is absent', async () => {
    vi.stubEnv('JUDGE0_API_KEY', '')
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'judge-not-configured' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the existing per-user judge limiter and returns 429 when exhausted', async () => {
    vi.mocked(checkRate).mockResolvedValue({ ok: false, message: 'judge is limited to 30 per hour' })
    const response = await POST(request())
    expect(response.status).toBe(429)
    expect(checkRate).toHaveBeenCalledWith('student', 'judge')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed fields without spending an upstream submission', async () => {
    for (const invalid of [null, { ...body, code: 42 }, { ...body, language: 'bash' }, { ...body, stdin: [] }]) {
      expect((await POST(request(invalid))).status).toBe(400)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends the Java harness and normalized Solution as one authenticated Judge0 file', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ stdout: 'square:4.0', stderr: '', compileOutput: '', exitCode: 0, timedOut: false })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true')
    expect(init?.headers).toMatchObject({ 'X-RapidAPI-Key': 'test-key', 'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com' })
    expect(JSON.parse(init!.body as string)).toEqual({ language_id: 62, source_code: 'public class Main {}\nclass Solution {}', stdin: 'square 2', cpu_time_limit: 10, wall_time_limit: 15 })
  })

  it.each([[3, undefined], [5, 'timeout'], [6, 'compile-error'], [4, 'runtime-error'], [7, 'runtime-error'], [13, 'runtime-error']])('maps terminal Judge0 status %s', async (id, failureKind) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...upstream(id as number), compile_output: id === 6 ? 'syntax error' : null })))
    const response = await POST(request())
    const reply = await response.json()
    expect(reply.failureKind).toBe(failureKind)
    expect(reply.timedOut).toBe(id === 5)
    expect(reply.exitCode).toBe(id === 3 ? 0 : 1)
    if (id === 6) expect(reply.compileOutput).toBe('syntax error')
  })

  it.each(['refused', 'missing-status'])('reposts wait=false and polls when wait=true is %s', async (mode) => {
    vi.useFakeTimers()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mode === 'refused' ? new Response('no wait', { status: 400 }) : Response.json({ token: 'discarded' }))
      .mockResolvedValueOnce(Response.json({ token: 'token-123' }))
      .mockResolvedValueOnce(Response.json(upstream(2)))
      .mockResolvedValueOnce(Response.json(upstream(3)))
    vi.stubGlobal('fetch', fetcher)
    const pending = POST(request())
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await pending).status).toBe(200)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true',
      'https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=false',
      'https://judge0-ce.p.rapidapi.com/submissions/token-123?base64_encoded=false',
      'https://judge0-ce.p.rapidapi.com/submissions/token-123?base64_encoded=false',
    ])
  })

  it('ends polling after ten seconds and returns a timeout result', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ token: 'token-123' })).mockImplementation(async () => Response.json(upstream(2))))
    const pending = POST(request())
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await (await pending).json()).toMatchObject({ timedOut: true, failureKind: 'timeout', exitCode: 1 })
  })

  it('returns a safe 502 when the fallback does not provide a submission token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: 'judge-unavailable' })
  })

  it('inserts and awaits an agent_usage row after a successful run, so the hourly backstop counts Java submissions across instances', async () => {
    const calls: unknown[] = []
    vi.mocked(serviceClient).mockReturnValue(usageStub(row => calls.push(row)) as never)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(calls).toEqual([{ user_id: 'student', agent: 'judge', trigger: 'judge-submit', prompt_tokens: 0, completion_tokens: 0, cache_hit_tokens: 0, fallback: false }])
  })

  it('does not fail the response when the usage insert errors', async () => {
    vi.mocked(serviceClient).mockReturnValue({ from: () => ({ insert: () => Promise.reject(new Error('db down')) }) } as never)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ stdout: 'square:4.0' })
  })

  it('does not insert a usage row when the judge is never reached', async () => {
    const calls: unknown[] = []
    vi.mocked(serviceClient).mockReturnValue(usageStub(row => calls.push(row)) as never)
    vi.mocked(getUserAndProfile).mockResolvedValue({ user: null, profile: null })
    await POST(request())
    expect(calls).toHaveLength(0)
  })

  it('enables the Python Judge0 language id only with the server flag', async () => {
    vi.stubEnv('JUDGE_ALL_LANGUAGES', 'true')
    const response = await POST(request({ language: 'python', code: 'print(1)', stdin: '' }))
    expect(response.status).toBe(200)
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).language_id).toBe(71)
  })
})
