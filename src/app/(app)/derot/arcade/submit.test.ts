import { describe, expect, it, vi } from 'vitest'
import type { DrillResult } from '@/lib/contracts'
import { isMissingRpcError, submitRunResult } from './submit'

function result(overrides: Partial<DrillResult> = {}): DrillResult {
  return { drillId: 'd1', kind: 'trace', correct: true, timeMs: 3000, score: 80, at: '2026-09-06T12:00:00.000Z', lane: 'arcade', ...overrides }
}

describe('isMissingRpcError', () => {
  it('is true for the Postgres undefined_function code', () => {
    expect(isMissingRpcError({ code: '42883', message: 'function public.append_drill_result(jsonb) does not exist' })).toBe(true)
  })

  it('is true for PostgREST schema-cache miss codes', () => {
    expect(isMissingRpcError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true)
    expect(isMissingRpcError({ code: 'PGRST204' })).toBe(true)
  })

  it('is true when only the message text signals a missing function', () => {
    expect(isMissingRpcError({ message: 'Could not find the function public.append_drill_result in the schema cache' })).toBe(true)
  })

  it('is false for an unrelated error -- RLS denial, bad payload, network failure', () => {
    expect(isMissingRpcError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingRpcError({ message: 'append_drill_result: invalid kind foo' })).toBe(false)
    expect(isMissingRpcError({ message: 'network error' })).toBe(false)
  })

  it('is false for null or undefined', () => {
    expect(isMissingRpcError(null)).toBe(false)
    expect(isMissingRpcError(undefined)).toBe(false)
  })
})

describe('submitRunResult', () => {
  function client(overrides: { rpcError?: unknown; rpcData?: unknown; wellnessRow?: { drill_results: DrillResult[] } | null; updateAffectsRow?: boolean } = {}) {
    const { rpcError = null, rpcData = [], wellnessRow = { drill_results: [] }, updateAffectsRow = true } = overrides
    const rpcSpy = vi.fn().mockResolvedValue(rpcError ? { data: null, error: rpcError } : { data: rpcData, error: null })
    const updateSpy = vi.fn()
    const insertSpy = vi.fn()
    const eqSpy = vi.fn()
    return {
      rpcSpy,
      updateSpy,
      insertSpy,
      eqSpy,
      client: {
        rpc: rpcSpy,
        from: (table: string) => {
          if (table !== 'wellness') throw new Error(`Unexpected table: ${table}`)
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: wellnessRow, error: null }) }) }),
            update: (payload: Record<string, unknown>) => {
              updateSpy(payload)
              return {
                eq: (...args: unknown[]) => {
                  eqSpy(...args)
                  return { select: () => ({ maybeSingle: () => Promise.resolve(updateAffectsRow ? { data: { user_id: 'u1' }, error: null } : { data: null, error: null }) }) }
                },
              }
            },
            insert: (payload: Record<string, unknown>) => {
              insertSpy(payload)
              return Promise.resolve({ error: null })
            },
          }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    }
  }

  it('goes through the RPC and returns its capped array when the RPC succeeds', async () => {
    const capped = [result({ drillId: 'x' })]
    const { client: c, rpcSpy, updateSpy } = client({ rpcData: capped })
    const out = await submitRunResult(c, 'u1', result())
    expect(rpcSpy).toHaveBeenCalledWith('append_drill_result', { result: result() })
    expect(out).toEqual(capped)
    expect(updateSpy).not.toHaveBeenCalled() // the fallback path never runs when the RPC exists
  })

  it('falls back to the direct read-modify-write when the RPC is missing (pre-0009 schema)', async () => {
    const { client: c, rpcSpy, updateSpy, eqSpy } = client({
      rpcError: { code: '42883', message: 'function public.append_drill_result(jsonb) does not exist' },
      wellnessRow: { drill_results: [result({ drillId: 'earlier' })] },
    })
    const out = await submitRunResult(c, 'u1', result({ drillId: 'new' }))
    expect(rpcSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const payload = updateSpy.mock.calls[0][0] as { drill_results: DrillResult[] }
    expect(payload.drill_results).toHaveLength(2)
    expect(out).toHaveLength(2)
    // TI-2: the two safety assertions the old runner test carried, restored here --
    // the fallback writes exactly one column (never prefs, water_log or
    // pomodoro_sessions, all sharing this same row), scoped to this user's own row.
    expect(Object.keys(payload)).toEqual(['drill_results'])
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('inserts a wellness row in the fallback when the update affects no rows', async () => {
    const { client: c, insertSpy } = client({
      rpcError: { code: 'PGRST202' },
      updateAffectsRow: false,
    })
    await submitRunResult(c, 'u1', result())
    expect(insertSpy).toHaveBeenCalledTimes(1)
  })

  it('caps the fallback array at 300, oldest dropped first', async () => {
    const many = Array.from({ length: 305 }, (_, i) => result({ drillId: `r${i}`, at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z` }))
    const { client: c, updateSpy } = client({ rpcError: { code: '42883' }, wellnessRow: { drill_results: many } })
    const out = await submitRunResult(c, 'u1', result({ drillId: 'newest' }))
    expect(out.length).toBe(300)
    expect(out[out.length - 1].drillId).toBe('newest')
    const payload = updateSpy.mock.calls[0][0] as { drill_results: DrillResult[] }
    expect(payload.drill_results.length).toBe(300)
  })

  it('rethrows a non-missing-function RPC error instead of silently falling back', async () => {
    const { client: c, updateSpy } = client({ rpcError: { code: '42501', message: 'permission denied' } })
    await expect(submitRunResult(c, 'u1', result())).rejects.toBeTruthy()
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
