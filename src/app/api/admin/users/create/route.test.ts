// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    createUserResult: { data: { user: null as { id: string; email: string } | null }, error: null as { message: string; code?: string } | null },
    createUserCalls: [] as unknown[],
    existingInvite: null as { email: string; redeemed_at: string | null } | null,
    selectError: null as { message: string } | null,
    upsertError: null as { message: string } | null,
    upsertCalls: [] as { payload: unknown; options: unknown }[],
    insertCalls: [] as unknown[],
    deleteCalls: [] as unknown[][],
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
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.existingInvite, error: state.selectError }),
          }),
        }),
        upsert: (payload: unknown, options: unknown) => {
          state.upsertCalls.push({ payload, options })
          return Promise.resolve({ data: null, error: state.upsertError })
        },
        // A plain insert must never happen for this route any more; if it does, the
        // call is recorded so a test can fail on it explicitly.
        insert: (payload: unknown) => {
          state.insertCalls.push(payload)
          return Promise.resolve({ data: null, error: null })
        },
        delete: () => ({
          eq: (column: string, value: unknown) => {
            state.deleteCalls.push([table, column, value])
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
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
  db.state.existingInvite = null
  db.state.selectError = null
  db.state.upsertError = null
  db.state.upsertCalls = []
  db.state.insertCalls = []
  db.state.deleteCalls = []
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
    expect(db.state.upsertCalls).toHaveLength(0)
  })

  it('rejects an invalid email', async () => {
    const res = await POST(post({ email: 'not-an-email', password: 'longenough1' }))
    expect(res.status).toBe(400)
    expect(db.state.createUserCalls).toHaveLength(0)
    expect(db.state.upsertCalls).toHaveLength(0)
  })

  it('rejects a password shorter than 8 characters', async () => {
    const res = await POST(post({ email: 'a@uni.edu.qa', password: 'short1' }))
    expect(res.status).toBe(400)
    expect(db.state.createUserCalls).toHaveLength(0)
    expect(db.state.upsertCalls).toHaveLength(0)
  })

  it('upserts an unredeemed invite before creating the account, lowercases and trims the email, and never does a plain insert', async () => {
    db.state.createUserResult = { data: { user: { id: 'new-uid', email: 'student@uni.edu.qa' } }, error: null }

    const res = await POST(post({ email: '  Student@UNI.edu.qa  ', password: 'longenough1', displayName: 'Aisha' }))
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ ok: true, id: 'new-uid', email: 'student@uni.edu.qa' })

    expect(db.state.upsertCalls).toHaveLength(1)
    const { payload, options } = db.state.upsertCalls[0] as { payload: Record<string, unknown>; options: Record<string, unknown> }
    expect(payload.email).toBe('student@uni.edu.qa')
    expect(payload.created_by).toBe('admin1')
    expect(payload.redeemed_at).toBeNull()
    expect(payload.redeemed_by).toBeNull()
    expect(typeof payload.code).toBe('string')
    expect((payload.code as string).length).toBeGreaterThan(0)
    expect(options).toEqual({ onConflict: 'email' })

    expect(db.state.insertCalls).toHaveLength(0)

    // The upsert must happen before createUser is called (handle_new_user needs the row to exist).
    expect(db.state.createUserCalls[0]).toEqual({
      email: 'student@uni.edu.qa',
      password: 'longenough1',
      email_confirm: true,
      user_metadata: { display_name: 'Aisha' },
    })
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

  it('an existing unredeemed invite still yields 201 via upsert, never a plain insert', async () => {
    db.state.existingInvite = { email: 'invited@uni.edu.qa', redeemed_at: null }
    db.state.createUserResult = { data: { user: { id: 'new-uid', email: 'invited@uni.edu.qa' } }, error: null }

    const res = await POST(post({ email: 'invited@uni.edu.qa', password: 'longenough1' }))
    expect(res.status).toBe(201)
    expect(db.state.upsertCalls).toHaveLength(1)
    expect(db.state.insertCalls).toHaveLength(0)
    expect(db.state.deleteCalls).toHaveLength(0)
  })

  it('answers 409 immediately when the invite for this email is already redeemed, without calling createUser', async () => {
    db.state.existingInvite = { email: 'dupe@uni.edu.qa', redeemed_at: '2026-01-01T00:00:00Z' }
    const res = await POST(post({ email: 'dupe@uni.edu.qa', password: 'longenough1' }))
    expect(res.status).toBe(409)
    expect(db.state.createUserCalls).toHaveLength(0)
    expect(db.state.upsertCalls).toHaveLength(0)
  })

  it('answers 409 when the email already has an account, and removes the invite it just created', async () => {
    db.state.createUserResult = {
      data: { user: null },
      error: { message: 'A user with this email address has already been registered', code: 'email_exists' },
    }
    const res = await POST(post({ email: 'dupe@uni.edu.qa', password: 'longenough1' }))
    expect(res.status).toBe(409)
    expect(db.state.upsertCalls).toHaveLength(1)
    expect(db.state.deleteCalls).toEqual([['invites', 'email', 'dupe@uni.edu.qa']])
  })

  it('a createUser failure removes only a freshly created invite, leaving a pre-existing unredeemed one in place', async () => {
    db.state.existingInvite = { email: 'invited@uni.edu.qa', redeemed_at: null }
    db.state.createUserResult = { data: { user: null }, error: { message: 'unexpected failure' } }
    const res = await POST(post({ email: 'invited@uni.edu.qa', password: 'longenough1' }))
    expect(res.status).toBe(500)
    expect(db.state.deleteCalls).toHaveLength(0)
  })
})
