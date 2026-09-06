// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
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
                Promise.resolve({ data: null, error: null }).then(resolve, reject)
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

import { POST } from './route'

const ORIGINAL_ADMIN_USER_IDS = process.env.ADMIN_USER_IDS

function post(body: unknown) {
  return new Request('http://localhost/api/admin/users/u1/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function ctx(id = 'u1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  process.env.ADMIN_USER_IDS = 'admin1'
  db.state.user = { id: 'admin1' }
  db.state.calls = []
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('POST /api/admin/users/[id]/status', () => {
  it('answers 404 for a signed-out caller', async () => {
    db.state.user = null
    expect((await POST(post({ action: 'lift' }), ctx())).status).toBe(404)
  })

  it('answers 404 for a signed-in non-admin', async () => {
    db.state.user = { id: 'not-admin' }
    expect((await POST(post({ action: 'lift' }), ctx())).status).toBe(404)
  })

  it('rejects an unknown action', async () => {
    const res = await POST(post({ action: 'delete' }), ctx())
    expect(res.status).toBe(400)
  })

  it('lift sets account_status active and clears restricted_until', async () => {
    const res = await POST(post({ action: 'lift' }), ctx('u1'))
    expect(res.status).toBe(200)
    const update = db.state.calls.find((c) => c.method === 'update')!
    expect(update.args[0]).toEqual({ account_status: 'active', restricted_until: null })
    expect(db.state.calls.find((c) => c.method === 'eq')?.args).toEqual(['id', 'u1'])
  })

  it('restrict sets account_status restricted with a restricted_until 24h out', async () => {
    const before = Date.now()
    const res = await POST(post({ action: 'restrict' }), ctx('u2'))
    expect(res.status).toBe(200)
    const update = db.state.calls.find((c) => c.method === 'update')!
    const patch = update.args[0] as { account_status: string; restricted_until: string }
    expect(patch.account_status).toBe('restricted')
    const until = new Date(patch.restricted_until).getTime()
    const hours = (until - before) / (60 * 60 * 1000)
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24.1)
    expect(db.state.calls.find((c) => c.method === 'eq')?.args).toEqual(['id', 'u2'])
  })

  it('ban sets account_status banned', async () => {
    const res = await POST(post({ action: 'ban' }), ctx('u3'))
    expect(res.status).toBe(200)
    const update = db.state.calls.find((c) => c.method === 'update')!
    expect(update.args[0]).toEqual({ account_status: 'banned' })
    expect(db.state.calls.find((c) => c.method === 'eq')?.args).toEqual(['id', 'u3'])
  })
})
