// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentName } from '@/lib/contracts'

const db = vi.hoisted(() => {
  const state = {
    user: { id: 'u1' } as { id: string } | null,
    profile: { id: 'u1', account_status: 'active', restricted_until: null } as Record<string, unknown> | null,
    hintCount: 0,
    usageCount: 0,
    exercise: { reference_solution: 'the real reference', tests: [{ id: 't1', input: '[]', expected: '0', hidden: true }] } as Record<string, unknown> | null,
    exerciseRows: [
      { id: 'bank_1', pattern: 'accumulate', title: 'One', prompt: 'p', starter_code: 's', tests: [], reference_solution: 'r' },
      { id: 'bank_2', pattern: 'count', title: 'Two', prompt: 'p', starter_code: 's', tests: [], reference_solution: 'r' },
    ],
    calls: [] as string[],
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    /** Only rows whose builder was actually awaited land here; a `void`-ed builder never runs. */
    executed: [] as { table: string; op: string }[],
    insertError: null as { message: string } | null,
  }

  const client = {
    from(table: string) {
      const ctx = { op: '', head: false }
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              state.executed.push({ table, op: ctx.op || 'select' })
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(result()).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              state.calls.push(`${table}.${prop}`)
              if (prop === 'insert') {
                ctx.op = 'insert'
                state.inserts.push({ table, row: args[0] as Record<string, unknown> })
              }
              if (prop === 'select' && (args[1] as { head?: boolean } | undefined)?.head) ctx.head = true
              if (prop === 'single') ctx.op = ctx.op === 'insert' ? 'insert-single' : 'single'
              return chain
            }
          },
        },
      )
      const result = () => {
        if (table === 'attempts') return { data: [{ hint_count: state.hintCount }] }
        if (table === 'agent_usage') return ctx.head ? { count: state.usageCount } : { data: null, error: null }
        if (ctx.op === 'insert-single') return state.insertError ? { data: null, error: state.insertError } : { data: { id: 'generated_1' }, error: null }
        if (ctx.op === 'single') return { data: state.exercise }
        return { data: state.exerciseRows }
      }
      return chain
    },
  }
  return { state, client }
})

vi.mock('@/lib/supabase/server', () => ({
  getUserAndProfile: async () => ({ user: db.state.user, profile: db.state.profile }),
  serviceClient: () => db.client,
}))

const AGENTS: AgentName[] = ['profiler', 'planner', 'author', 'diagnoser', 'coach', 'reviewer', 'buddy']
const request = (agent: AgentName) =>
  JSON.parse(readFileSync(`src/lib/agents/fixtures/requests/${agent}.json`, 'utf8'))

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const route = () => import('./route')

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('AGENT_DRY_RUN', 'true')
  db.state.user = { id: 'u1' }
  db.state.profile = { id: 'u1', account_status: 'active', restricted_until: null }
  db.state.hintCount = 0
  db.state.usageCount = 0
  db.state.calls = []
  db.state.inserts = []
  db.state.executed = []
  db.state.insertError = null
  db.state.exercise = { reference_solution: 'the real reference', tests: [{ id: 't1', input: '[]', expected: '0', hidden: true }] }
})

describe('POST /api/agent', () => {
  it('answers every agent with its fallback in a dry run', async () => {
    const { POST } = await route()
    for (const agent of AGENTS.filter(a => a !== 'author')) {
      const res = await POST(post(request(agent)))
      const body = await res.json()
      expect(res.status, agent).toBe(200)
      expect(body, agent).toMatchObject({ ok: true, agent, fallback: true })
      expect(body.usage.promptTokens, agent).toBeGreaterThan(0)
      expect(body.reply, agent).toBeTruthy()
    }
  })

  it('refuses the author with an upstream error, because it has no fallback', async () => {
    const { POST } = await route()
    const res = await POST(post(request('author')))
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ ok: false, agent: 'author', error: 'upstream' })
  })

  it('rejects an unknown agent', async () => {
    const { POST } = await route()
    const res = await POST(post({ agent: 'oracle', trigger: 'buddy-message', state: {} }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ ok: false, agent: 'unknown', error: 'invalid-request' })
  })

  it('rejects a body that is not json', async () => {
    const { POST } = await route()
    const res = await POST(new Request('http://localhost/api/agent', { method: 'POST', body: 'not json' }))
    expect(res.status).toBe(400)
  })

  it('hydrates the reference solution server side and ignores the one the client sent', async () => {
    const { POST } = await route()
    const body = request('reviewer')
    body.exercise.referenceSolution = 'client guess'
    const res = await POST(post(body))
    expect(res.status).toBe(200)
    expect(db.state.calls).toContain('exercises.select')
  })

  it('rejects an unknown exercise for an agent that needs hydration', async () => {
    const { POST } = await route()
    db.state.exercise = null
    const res = await POST(post(request('reviewer')))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid-request', message: 'unknown exercise' })
  })

  it('rejects an unknown parent exercise instead of skipping the variant check', async () => {
    const { POST } = await route()
    const res = await POST(post({ ...request('author'), parentExerciseId: 'bank_404' }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ agent: 'author', error: 'invalid-request', message: 'unknown parent exercise' })
  })

  it('rejects a planner request with no CLOs, whose fallback could not name a path', async () => {
    const { POST } = await route()
    const res = await POST(post({ ...request('planner'), clos: [] }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ agent: 'planner', error: 'invalid-request' })
  })

  it('rejects code over the twenty thousand character cap', async () => {
    const { POST } = await route()
    const res = await POST(post({ ...request('diagnoser'), code: 'x'.repeat(20001) }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ agent: 'diagnoser', error: 'invalid-request' })
  })

  it('refuses a prompt that stays over budget after trimming', async () => {
    const { POST } = await route()
    const body = request('profiler')
    body.answers = [{ questionId: 'p1f1', answer: 'z'.repeat(40000) }]
    const res = await POST(post(body))
    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toMatchObject({ agent: 'profiler', error: 'budget-exceeded' })
  })

  it('streams a partial frame and an envelope frame when the client asks for events', async () => {
    const { POST } = await route()
    const res = await POST(post(request('coach'), { Accept: 'text/event-stream' }))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const frames = (await res.text()).split('\n\n').filter(Boolean).map(f => JSON.parse(f.replace('data: ', '')))
    expect(frames).toHaveLength(2)
    expect(frames[0]).toHaveProperty('partial')
    expect(frames[1].envelope).toMatchObject({ ok: true, agent: 'coach', fallback: true })
  })

  it('sends json to a streaming agent that did not ask for events', async () => {
    const { POST } = await route()
    const res = await POST(post(request('coach')))
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('turns a second hint inside a minute into a rate-limited error', async () => {
    const { POST } = await route()
    expect((await POST(post(request('coach')))).status).toBe(200)
    const res = await POST(post(request('coach')))
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: 'rate-limited' })
  })

  it('turns nobody away politely when they are not signed in', async () => {
    db.state.user = null
    db.state.profile = null
    const { POST } = await route()
    const res = await POST(post(request('buddy')))
    expect(res.status).toBe(401)
  })

  it('refuses a banned account', async () => {
    db.state.profile = { id: 'u1', account_status: 'banned', restricted_until: null }
    const { POST } = await route()
    const res = await POST(post(request('buddy')))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'banned' })
  })

  it('runs on the node runtime, because it streams', async () => {
    expect((await route()).runtime).toBe('nodejs')
  })
})
