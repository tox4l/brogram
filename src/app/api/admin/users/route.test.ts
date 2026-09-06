// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => {
  const state = {
    user: null as { id: string } | null,
    profilePages: [] as Record<string, unknown>[][],
    eventPages: [] as Record<string, unknown>[][],
    authUsers: [] as { id: string; email: string | null }[],
    pageIndex: {} as Record<string, number>,
    rpcScores: new Map<string, number>(),
    rpcErrorIds: new Set<string>(),
    rpcCalls: [] as string[],
  }
  const client = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: state.authUsers }, error: null }),
      },
    },
    rpc: async (fn: string, args: { uid: string }) => {
      state.rpcCalls.push(args.uid)
      if (fn !== 'integrity_score') return { data: null, error: { message: `unknown rpc ${fn}` } }
      if (state.rpcErrorIds.has(args.uid)) return { data: null, error: { message: 'rpc failed' } }
      return { data: state.rpcScores.get(args.uid) ?? 0, error: null }
    },
    from(table: string) {
      const pages = table === 'profiles' ? state.profilePages : table === 'integrity_events' ? state.eventPages : []
      const chain: unknown = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
                const idx = state.pageIndex[table] ?? 0
                state.pageIndex[table] = idx + 1
                const page = pages[Math.min(idx, pages.length - 1)] ?? []
                return Promise.resolve({ data: page, error: null }).then(resolve, reject)
              }
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

function profile(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    display_name: id,
    account_status: 'active',
    restricted_until: null,
    created_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-05T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  process.env.ADMIN_USER_IDS = 'admin1'
  db.state.user = { id: 'admin1' }
  db.state.pageIndex = {}
  db.state.rpcScores = new Map()
  db.state.rpcErrorIds = new Set()
  db.state.rpcCalls = []
  db.state.authUsers = [
    { id: 'u1', email: 'aisha@uni.edu.qa' },
    { id: 'u2', email: 'bilal@uni.edu.qa' },
  ]
  db.state.profilePages = [[profile('u1'), profile('u2')]]
  db.state.eventPages = [[
    { user_id: 'u1', type: 'blur' },
    { user_id: 'u1', type: 'paste-blocked' },
    { user_id: 'u1', type: 'paste-blocked' },
    { user_id: 'u2', type: 'printscreen' },
  ]]
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

  it('scores each user through integrity_score(uid), not the JS sum', async () => {
    // JS-summed weights would give u1 = 5 (blur 1 + paste 2*2) and u2 = 3 (printscreen). The rpc
    // values below deliberately differ so a passing test proves the rpc value is what wins.
    db.state.rpcScores.set('u1', 99)
    db.state.rpcScores.set('u2', 42)

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; users: Array<Record<string, unknown>> }

    expect(db.state.rpcCalls.sort()).toEqual(['u1', 'u2'])
    const u1 = body.users.find((u) => u.id === 'u1')!
    const u2 = body.users.find((u) => u.id === 'u2')!
    expect(u1.integrity_score).toBe(99)
    expect(u1.score_source).toBeUndefined()
    expect(u2.integrity_score).toBe(42)
    // event_counts is still the JS per-type aggregation; only the score itself comes from the rpc.
    expect(u1.event_counts).toEqual({ blur: 1, 'paste-blocked': 2 })
    expect(u2.event_counts).toEqual({ printscreen: 1 })
  })

  it('falls back to the JS-summed score and flags score_source when the rpc errors', async () => {
    db.state.rpcErrorIds.add('u1')
    db.state.rpcScores.set('u2', 42)

    const res = await GET()
    const body = (await res.json()) as { ok: boolean; users: Array<Record<string, unknown>> }
    const u1 = body.users.find((u) => u.id === 'u1')!
    const u2 = body.users.find((u) => u.id === 'u2')!

    // fallback: blur(1) + paste-blocked(2) + paste-blocked(2) = 5
    expect(u1.integrity_score).toBe(5)
    expect(u1.score_source).toBe('fallback')
    expect(u2.integrity_score).toBe(42)
    expect(u2.score_source).toBeUndefined()
  })

  it('pages past the 1000-row PostgREST cap for profiles', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => profile(`p${i}`))
    const secondPage = [profile('p1000'), profile('p1001'), profile('p1002')]
    db.state.profilePages = [firstPage, secondPage]
    db.state.eventPages = [[]]
    db.state.authUsers = []

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; users: Array<Record<string, unknown>> }
    expect(body.users).toHaveLength(1003)
  })

  it('pages past the 1000-row PostgREST cap for integrity_events', async () => {
    db.state.profilePages = [[profile('u1')]]
    const firstPage = Array.from({ length: 1000 }, () => ({ user_id: 'u1', type: 'blur' }))
    const secondPage = [
      { user_id: 'u1', type: 'blur' },
      { user_id: 'u1', type: 'blur' },
      { user_id: 'u1', type: 'blur' },
    ]
    db.state.eventPages = [firstPage, secondPage]

    const res = await GET()
    const body = (await res.json()) as { ok: boolean; users: Array<Record<string, unknown>> }
    const u1 = body.users.find((u) => u.id === 'u1')!
    expect((u1.event_counts as Record<string, number>).blur).toBe(1003)
  })
})
