// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: { id: 'u1' } as { id: string } | null,
    updated: [{ id: 'ex_1' }] as { id: string }[],
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
                Promise.resolve({ data: state.updated }).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              state.calls.push({ method: prop, args })
              return chain
            }
          },
        },
      )
      return chain
    },
  }
  return { state, client }
})

vi.mock('@/lib/supabase/server', () => ({
  getUserAndProfile: async () => ({ user: db.state.user, profile: db.state.user ? { id: 'u1', account_status: 'active', restricted_until: null } : null }),
  serviceClient: () => db.client,
}))

import { POST } from './route'

const post = (body: unknown) =>
  new Request('http://localhost/api/exercises/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  db.state.user = { id: 'u1' }
  db.state.updated = [{ id: 'ex_1' }]
  db.state.calls = []
})

describe('POST /api/exercises/verify', () => {
  it('flips verified on a row the caller authored', async () => {
    const res = await POST(post({ id: 'ex_1' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(db.state.calls.find(c => c.method === 'update')?.args[0]).toEqual({ verified: true })
    expect(db.state.calls.filter(c => c.method === 'eq').map(c => c.args)).toEqual([
      ['id', 'ex_1'],
      ['author_user_id', 'u1'],
    ])
  })

  it('answers 404 when the row is missing or belongs to someone else', async () => {
    db.state.updated = []
    const res = await POST(post({ id: 'ex_1' }))
    expect(res.status).toBe(404)
  })

  it('needs a signed-in caller', async () => {
    db.state.user = null
    expect((await POST(post({ id: 'ex_1' }))).status).toBe(401)
  })

  it('needs an id', async () => {
    expect((await POST(post({}))).status).toBe(400)
    expect((await POST(post('not json'))).status).toBe(400)
  })
})
