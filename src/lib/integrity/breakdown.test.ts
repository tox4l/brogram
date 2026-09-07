import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { INTEGRITY_WEIGHTS } from '@/lib/contracts'
import { breakdownFromEvents, fetchIntegrityBreakdown, isMissingRpcError } from './breakdown'

function clientReturning(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient
}

describe('isMissingRpcError', () => {
  it('is false for no error', () => {
    expect(isMissingRpcError(null)).toBe(false)
    expect(isMissingRpcError(undefined)).toBe(false)
  })

  it('recognises every Postgres/PostgREST "function does not exist" code', () => {
    expect(isMissingRpcError({ code: '42883' })).toBe(true)
    expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingRpcError({ code: 'PGRST204' })).toBe(true)
  })

  it('recognises the message text even without a matching code', () => {
    expect(isMissingRpcError({ message: 'Could not find the function public.my_integrity_breakdown' })).toBe(true)
    expect(isMissingRpcError({ message: 'schema cache reload needed' })).toBe(true)
    expect(isMissingRpcError({ message: 'function public.my_integrity_breakdown() does not exist' })).toBe(true)
  })

  it('is false for an unrelated error, so a real failure is never hidden', () => {
    expect(isMissingRpcError({ code: '42501', message: 'permission denied for table integrity_events' })).toBe(false)
    expect(isMissingRpcError({ message: 'fetch failed' })).toBe(false)
  })
})

describe('breakdownFromEvents', () => {
  it('matches the spec 9.4 example exactly: 3 screenshots, 4 pastes, 3 tab-aways -> total 20', () => {
    const events = [
      ...Array.from({ length: 3 }, () => ({ type: 'printscreen' as const })),
      ...Array.from({ length: 4 }, () => ({ type: 'paste-blocked' as const })),
      ...Array.from({ length: 3 }, () => ({ type: 'blur' as const })),
    ]
    const breakdown = breakdownFromEvents(events)
    expect(breakdown.source).toBe('local')
    expect(breakdown.total).toBe(20)
    expect(breakdown.rows).toEqual([
      { type: 'printscreen', events: 3, weight: 3, points: 9 },
      { type: 'paste-blocked', events: 4, weight: 2, points: 8 },
      { type: 'blur', events: 3, weight: 1, points: 3 },
    ])
  })

  it('reads every weight from the contracts table, never a hardcoded copy', () => {
    const one = (type: keyof typeof INTEGRITY_WEIGHTS) => breakdownFromEvents([{ type }]).rows[0]
    for (const type of Object.keys(INTEGRITY_WEIGHTS) as (keyof typeof INTEGRITY_WEIGHTS)[]) {
      expect(one(type)).toEqual({ type, events: 1, weight: INTEGRITY_WEIGHTS[type], points: INTEGRITY_WEIGHTS[type] })
    }
  })

  it('is empty for no events', () => {
    expect(breakdownFromEvents([])).toEqual({ rows: [], total: 0, source: 'local' })
  })
})

describe('fetchIntegrityBreakdown', () => {
  it('maps my_integrity_breakdown() rows, in the order the RPC already sorted them', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { event_type: 'printscreen', events: 3, weight: 3, points: 9 },
        { event_type: 'paste-blocked', events: 4, weight: 2, points: 8 },
        { event_type: 'blur', events: 3, weight: 1, points: 3 },
      ],
      error: null,
    })
    const breakdown = await fetchIntegrityBreakdown(clientReturning(rpc), [])
    expect(rpc).toHaveBeenCalledWith('my_integrity_breakdown')
    expect(breakdown).toEqual({
      source: 'server',
      total: 20,
      rows: [
        { type: 'printscreen', events: 3, weight: 3, points: 9 },
        { type: 'paste-blocked', events: 4, weight: 2, points: 8 },
        { type: 'blur', events: 3, weight: 1, points: 3 },
      ],
    })
  })

  it('drops a row whose event_type is not a known IntegrityEventType rather than crashing on it', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ event_type: 'printscreen', events: 1, weight: 3, points: 3 }, { event_type: 'future-guard-type', events: 9, weight: 9, points: 81 }],
      error: null,
    })
    const breakdown = await fetchIntegrityBreakdown(clientReturning(rpc), [])
    expect(breakdown.rows).toEqual([{ type: 'printscreen', events: 1, weight: 3, points: 3 }])
    expect(breakdown.total).toBe(3)
  })

  it('falls back to the local events when the RPC is missing (schema 0005)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.my_integrity_breakdown' } })
    const local = [{ type: 'paste-blocked' as const }, { type: 'paste-blocked' as const }, { type: 'blur' as const }]
    const breakdown = await fetchIntegrityBreakdown(clientReturning(rpc), local)
    expect(breakdown).toEqual(breakdownFromEvents(local))
    expect(breakdown.source).toBe('local')
  })

  it('rethrows any other RPC error instead of silently returning a fabricated zero receipt', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(fetchIntegrityBreakdown(clientReturning(rpc), [{ type: 'blur' }])).rejects.toEqual({ code: '42501', message: 'permission denied' })
  })
})
