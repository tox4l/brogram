// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    profiles: [] as unknown[],
    events: [] as unknown[],
    authUsers: [] as { id: string; email: string | null }[],
  }
  const client = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: state.authUsers }, error: null }),
      },
    },
    from(table: string) {
      const rows = table === 'profiles' ? state.profiles : table === 'integrity_events' ? state.events : []
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve({ data: rows, error: null }).then(resolve, reject)
            }
            return () => chain
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
  db.state.profiles = [
    { id: 'u1', display_name: 'Aisha', account_status: 'active', restricted_until: null, created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-05T00:00:00Z' },
    { id: 'u2', display_name: 'Bilal', account_status: 'restricted', restricted_until: '2026-01-06T00:00:00Z', created_at: '2026-01-02T00:00:00Z', last_seen_at: '2026-01-05T00:00:00Z' },
  ]
  db.state.events = [
    { user_id: 'u1', type: 'blur' },
    { user_id: 'u1', type: 'paste-blocked' },
    { user_id: 'u1', type: 'paste-blocked' },
    { user_id: 'u2', type: 'printscreen' },
  ]
  db.state.authUsers = [
    { id: 'u1', email: 'aisha@uni.edu.qa' },
    { id: 'u2', email: 'bilal@uni.edu.qa' },
  ]
})

afterEach(() => {
  if (ORIGINAL_ADMIN_USER_IDS === undefined) delete process.env.ADMIN_USER_IDS
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN_USER_IDS
})

describe('GET /api/admin/users', () => {
  it('answers 404 for a signed-out caller', async () => {
    db.state.user = null
    expect((await GET()).status).toBe(404)
  })

  it('answers 404 for a signed-in non-admin', async () => {
    db.state.user = { id: 'not-admin' }
    expect((await GET()).status).toBe(404)
  })

  it('joins profiles with auth email and computes score and event counts over the window', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; users: Array<Record<string, unknown>> }
    expect(body.ok).toBe(true)
    const u1 = body.users.find((u) => u.id === 'u1')!
    // blur(1) + paste-blocked(2) + paste-blocked(2) = 5
    expect(u1.email).toBe('aisha@uni.edu.qa')
    expect(u1.integrity_score).toBe(5)
    expect(u1.event_counts).toEqual({ blur: 1, 'paste-blocked': 2 })

    const u2 = body.users.find((u) => u.id === 'u2')!
    expect(u2.email).toBe('bilal@uni.edu.qa')
    expect(u2.integrity_score).toBe(3)
    expect(u2.event_counts).toEqual({ printscreen: 1 })
  })

  it('defaults to a zero score and empty counts for a user with no events', async () => {
    db.state.events = []
    const res = await GET()
    const body = (await res.json()) as { users: Array<Record<string, unknown>> }
    const u1 = body.users.find((u) => u.id === 'u1')!
    expect(u1.integrity_score).toBe(0)
    expect(u1.event_counts).toEqual({})
  })
})
