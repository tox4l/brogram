// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    createUserResult: { data: { user: null as { id: string; email: string } | null }, error: null as { message: string; code?: string } | null },
    createUserCalls: [] as unknown[],
    insertError: null as { code: string; message: string } | null,
    insertCalls: [] as { table: string; args: unknown[] }[],
  }
  const client = {
    auth: {
      admin: {
        createUser: async (attrs: unknown) => {
          state.createUserCalls.push(attrs)
          return state.createUserResult
        },
      },
    },
    from(table: string) {
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(
                  state.insertError ? { data: null, error: state.insertError } : { data: null, error: null }
                ).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              if (prop === 'insert') state.insertCalls.push({ table, args })
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
  return new Request('http://localhost/api/admin/users/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.ADMIN_USER_IDS = 'admin1'
  db.state.user = { id: 'admin1' }
  db.state.createUserResult = { data: { user: null }, error: null }
  db.state.createUserCalls = []
  db.state.insertError = null
  db.state.insertCalls = []
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('POST /api/admin/users/create', () => {
  it('answers 404 for a non-admin', async () => {
    db.state.user = { id: 'not-admin' }
    const res = await POST(post({ email: 'a@uni.edu.qa', password: 'longenough1' }))
    expect(res.status).toBe(404)
    expect(db.state.createUserCalls).toHaveLength(0)
  })

  it('rejects an invalid email', async () => {
    const res = await POST(post({ email: 'not-an-email', password: 'longenough1' }))
    expect(res.status).toBe(400)
    expect(db.state.createUserCalls).toHaveLength(0)
  })

  it('rejects a password shorter than 8 characters', async () => {
    const res = await POST(post({ email: 'a@uni.edu.qa', password: 'short1' }))
    expect(res.status).toBe(400)
    expect(db.state.createUserCalls).toHaveLength(0)
  })

  it('creates the account, lowercases and trims the email, and records a redeemed invite', async () => {
    db.state.createUserResult = { data: { user: { id: 'new-uid', email: 'student@uni.edu.qa' } }, error: null }

    const res = await POST(post({ email: '  Student@UNI.edu.qa  ', password: 'longenough1', displayName: 'Aisha' }))
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ ok: true, id: 'new-uid', email: 'student@uni.edu.qa' })

    expect(db.state.createUserCalls[0]).toEqual({
      email: 'student@uni.edu.qa',
      password: 'longenough1',
      email_confirm: true,
      user_metadata: { display_name: 'Aisha' },
    })

    expect(db.state.insertCalls).toHaveLength(1)
    const inserted = db.state.insertCalls[0].args[0] as {
      code: string; email: string; created_by: string; redeemed_by: string; redeemed_at: string
    }
    expect(db.state.insertCalls[0].table).toBe('invites')
    expect(inserted.email).toBe('student@uni.edu.qa')
    expect(inserted.created_by).toBe('admin1')
    expect(inserted.redeemed_by).toBe('new-uid')
    expect(typeof inserted.redeemed_at).toBe('string')
    expect(typeof inserted.code).toBe('string')
    expect(inserted.code.length).toBeGreaterThan(0)
  })

  it('omits user_metadata display_name when none was given', async () => {
    db.state.createUserResult = { data: { user: { id: 'new-uid', email: 'a@uni.edu.qa' } }, error: null }
    await POST(post({ email: 'a@uni.edu.qa', password: 'longenough1' }))
    expect(db.state.createUserCalls[0]).toEqual({
      email: 'a@uni.edu.qa',
      password: 'longenough1',
      email_confirm: true,
      user_metadata: {},
    })
  })

  it('answers 409 when the email already has an account', async () => {
    db.state.createUserResult = {
      data: { user: null },
      error: { message: 'A user with this email address has already been registered', code: 'email_exists' },
    }
    const res = await POST(post({ email: 'dupe@uni.edu.qa', password: 'longenough1' }))
    expect(res.status).toBe(409)
    expect(db.state.insertCalls).toHaveLength(0)
  })
})
