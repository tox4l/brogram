import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const closQuery = vi.hoisted(() => ({
  result: { data: [{ id: 'INFS1101-1', ordinal: 1, course: 'INFS1101', patterns: ['trace'] }], error: null as unknown },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(closQuery.result).then(resolve),
      }
      return builder
    },
  }),
}))

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response)
}

beforeEach(() => {
  closQuery.result = { data: [{ id: 'INFS1101-1', ordinal: 1, course: 'INFS1101', patterns: ['trace'] }], error: null }
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/admin/invites') {
      return jsonResponse({ ok: true, invites: [{ code: 'c1', email: 'a@uni.edu.qa', created_at: '2026-01-01T00:00:00Z', redeemed_at: null, redeemed_by: null }] })
    }
    if (url === '/api/admin/users') {
      return jsonResponse({
        ok: true,
        users: [{ id: 'u1', display_name: 'Aisha', email: 'aisha@uni.edu.qa', account_status: 'active', restricted_until: null, integrity_score: 0, event_counts: {}, last_seen_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }],
      })
    }
    if (url === '/api/admin/bank-stats') {
      return jsonResponse({ ok: true, stats: [{ clo_id: 'INFS1101-1', pattern: 'trace', seed_count: 2, generated_count: 0, verified_count: 0 }] })
    }
    if (url === '/api/admin/agent-usage') {
      return jsonResponse({ ok: true, usage: [{ day: '2026-01-01', agent: 'coach', calls: 3, fallback_calls: 0, prompt_tokens: 10, completion_tokens: 5, cache_hit_tokens: 0 }] })
    }
    return jsonResponse({ ok: false, error: 'unexpected url' }, false)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('/admin dashboard', () => {
  it('renders all four sections once their fetches resolve', async () => {
    const { AdminDashboard } = await import('./AdminDashboard')
    render(<AdminDashboard />)

    expect(screen.getByText('Invites')).toBeTruthy()
    expect(screen.getByText('Users')).toBeTruthy()
    expect(screen.getByText('Bank')).toBeTruthy()
    expect(screen.getByText('Agents')).toBeTruthy()

    await waitFor(() => expect(screen.getByText('a@uni.edu.qa')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('Aisha')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('INFS1101-1')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('coach')).toBeTruthy())
  })

  it('shows a retryable error for a section whose fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/admin/invites') return jsonResponse({ ok: false, error: 'invites unavailable' }, false)
      return jsonResponse({ ok: true, invites: [], users: [], stats: [], usage: [] })
    }))
    const { AdminDashboard } = await import('./AdminDashboard')
    render(<AdminDashboard />)
    await waitFor(() => expect(screen.getByText('invites unavailable')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
