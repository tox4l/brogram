// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    exercises: [] as unknown[],
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
                Promise.resolve({ data: state.exercises, error: null }).then(resolve, reject)
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
  db.state.exercises = [
    { clo_id: 'INFS1101-1', pattern: 'trace', origin: 'seed', verified: true },
    { clo_id: 'INFS1101-1', pattern: 'trace', origin: 'seed', verified: true },
    { clo_id: 'INFS1101-1', pattern: 'trace', origin: 'generated', verified: true },
    { clo_id: 'INFS1101-1', pattern: 'trace', origin: 'generated', verified: false },
    { clo_id: 'INFS1101-2', pattern: 'guard', origin: 'seed', verified: true },
  ]
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('GET /api/admin/bank-stats', () => {
  it('answers 404 for a signed-out caller', async () => {
    db.state.user = null
    expect((await GET()).status).toBe(404)
  })

  it('answers 404 for a signed-in non-admin', async () => {
    db.state.user = { id: 'not-admin' }
    expect((await GET()).status).toBe(404)
  })

  it('never selects prompt, tests, or reference_solution', async () => {
    await GET()
    const selectCall = db.state.calls.find((c) => c.method === 'select')!
    const columns = selectCall.args[0] as string
    expect(columns).not.toMatch(/reference_solution|prompt|tests|starter_code/)
    expect(columns).toBe('clo_id, pattern, origin, verified')
  })

  it('groups counts by clo_id and pattern', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; stats: Array<Record<string, unknown>> }
    const trace = body.stats.find((s) => s.clo_id === 'INFS1101-1' && s.pattern === 'trace')!
    expect(trace).toEqual({ clo_id: 'INFS1101-1', pattern: 'trace', seed_count: 2, generated_count: 2, verified_count: 1 })
    const guard = body.stats.find((s) => s.clo_id === 'INFS1101-2' && s.pattern === 'guard')!
    expect(guard).toEqual({ clo_id: 'INFS1101-2', pattern: 'guard', seed_count: 1, generated_count: 0, verified_count: 0 })
  })
})
