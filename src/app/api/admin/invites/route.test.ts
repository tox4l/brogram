// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    invites: [] as unknown[],
    insertError: null as { code: string; message: string } | null,
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
                Promise.resolve(
                  state.insertError ? { data: null, error: state.insertError } : { data: state.invites, error: null }
                ).then(resolve, reject)
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

import { GET, POST } from './route'

const ORIGINAL_ADMIN_USER_IDS = process.env.ADMIN_USER_IDS

function post(body: unknown) {
  return new Request('http://localhost/api/admin/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.ADMIN_USER_IDS = 'admin1'
  db.state.user = { id: 'admin1' }
  db.state.invites = [{ code: 'c1', email: 'a@uni.edu.qa', created_at: '2026-01-01T00:00:00Z', redeemed_at: null, redeemed_by: null }]
  db.state.insertError = null
  db.state.calls = []
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('GET /api/admin/invites', () => {
  it('answers 404 for a signed-out caller', async () => {
    db.state.user = null
    expect((await GET()).status).toBe(404)
  })

  it('answers 404 for a signed-in non-admin', async () => {
    db.state.user = { id: 'not-admin' }
    expect((await GET()).status).toBe(404)
  })

  it('lists invites for an admin', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, invites: db.state.invites })
  })
})

describe('POST /api/admin/invites', () => {
  it('answers 404 for a non-admin', async () => {
    db.state.user = { id: 'not-admin' }
    expect((await POST(post({ email: 'a@uni.edu.qa' }))).status).toBe(404)
  })

  it('rejects an email without the .edu.qa suffix', async () => {
    const res = await POST(post({ email: 'student@gmail.com' }))
    expect(res.status).toBe(400)
    expect(db.state.calls.find((c) => c.method === 'insert')).toBeUndefined()
  })

  it('lowercases and trims the email, generates a code, and inserts with created_by', async () => {
    const res = await POST(post({ email: '  Student@UNI.edu.qa  ' }))
    expect(res.status).toBe(201)
    const insertCall = db.state.calls.find((c) => c.method === 'insert')
    expect(insertCall).toBeDefined()
    const inserted = insertCall!.args[0] as { code: string; email: string; created_by: string }
    expect(inserted.email).toBe('student@uni.edu.qa')
    expect(inserted.created_by).toBe('admin1')
    expect(typeof inserted.code).toBe('string')
    expect(inserted.code.length).toBeGreaterThan(0)
  })

  it('answers 409 on a duplicate email', async () => {
    db.state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' }
    const res = await POST(post({ email: 'dupe@uni.edu.qa' }))
    expect(res.status).toBe(409)
  })
})
