// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    usage: [] as unknown[],
    calls: [] as { method: string; args: unknown[] }[],
  }
  const client = {
    from(table: string) {
      state.calls.push({ method: `from:${table}`, args: [] })
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve({ data: state.usage, error: null }).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              state.calls.push({ method: prop, args })
              return chain
            }
          },
        }
      )
      return chain
    },
  }
  return { state, client }
})

vi.mock('@/lib/supabase/server', () => ({
  getUserAndProfile: async () => ({ user: db.state.user, profile: null }),
  serviceClient: () => db.client,
}))

import { GET } from './route'

const ORIGINAL_ADMIN_USER_IDS = process.env.ADMIN_USER_IDS

beforeEach(() => {
  process.env.ADMIN_USER_IDS = 'admin1'
  db.state.user = { id: 'admin1' }
  db.state.calls = []
  db.state.usage = [
    { agent: 'coach', prompt_tokens: 100, completion_tokens: 20, cache_hit_tokens: 0, fallback: false, created_at: '2026-01-01T08:00:00Z' },
    { agent: 'coach', prompt_tokens: 50, completion_tokens: 10, cache_hit_tokens: 5, fallback: true, created_at: '2026-01-01T20:00:00Z' },
    { agent: 'buddy', prompt_tokens: 200, completion_tokens: 40, cache_hit_tokens: 0, fallback: false, created_at: '2026-01-02T09:00:00Z' },
  ]
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('GET /api/admin/agent-usage', () => {
  it('answers 404 for a signed-out caller', async () => {
    db.state.user = null
    expect((await GET()).status).toBe(404)
  })

  it('answers 404 for a signed-in non-admin', async () => {
    db.state.user = { id: 'not-admin' }
    expect((await GET()).status).toBe(404)
  })

  it('filters to the last 14 days', async () => {
    await GET()
    const gteCall = db.state.calls.find((c) => c.method === 'gte')!
    expect(gteCall.args[0]).toBe('created_at')
  })

  it('groups calls by day and agent, summing tokens and fallback counts', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; usage: Array<Record<string, unknown>> }
    const coachDay1 = body.usage.find((u) => u.agent === 'coach' && u.day === '2026-01-01')!
    expect(coachDay1).toEqual({
      day: '2026-01-01',
      agent: 'coach',
      calls: 2,
      fallback_calls: 1,
      prompt_tokens: 150,
      completion_tokens: 30,
      cache_hit_tokens: 5,
    })
    const buddyDay2 = body.usage.find((u) => u.agent === 'buddy' && u.day === '2026-01-02')!
    expect(buddyDay2).toEqual({
      day: '2026-01-02',
      agent: 'buddy',
      calls: 1,
      fallback_calls: 0,
      prompt_tokens: 200,
      completion_tokens: 40,
      cache_hit_tokens: 0,
    })
  })
})
