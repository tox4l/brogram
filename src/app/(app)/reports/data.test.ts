import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Clo } from '@/lib/contracts'
import { fetchReportData } from './data'

const cloRow: Clo = {
  id: 'INFS1101-1', course: 'INFS1101', ordinal: 1, outcome: 'Write a loop that accumulates a total',
  topics: ['loops'], prerequisites: [], patterns: ['accumulate'], assessableInCode: true,
}

/** X4: the report has no `clos` table leg any more -- every CLO comes from
 *  the static bundle's `closFor`, so these cases hand it rows through this
 *  mock rather than a Postgres client stub. */
const closForMock = vi.fn((course: string) => (course === 'INFS1101' ? [cloRow] : []))
vi.mock('@/lib/curriculum', () => ({ closFor: (course: string) => closForMock(course) }))

function makeClient(overrides: {
  wellness?: { data: unknown; error: unknown }
  attempts?: { data: unknown; error: unknown }
} = {}) {
  const wellnessResult = overrides.wellness ?? { data: { drill_results: [] }, error: null }
  const attemptsResult = overrides.attempts ?? { data: [], error: null }
  const tablesRead: string[] = []
  const attemptCalls: { select: string; column: string; value: unknown; order: string; options: unknown; limit: number }[] = []

  return {
    client: {
      from: (table: string) => {
        tablesRead.push(table)
        if (table === 'wellness') {
          return {
            select: (columns: string) => {
              expect(columns).toBe('drill_results')
              return { eq: (column: string) => {
                expect(column).toBe('user_id')
                return { maybeSingle: () => Promise.resolve(wellnessResult) }
              } }
            },
          }
        }
        if (table === 'attempts') {
          return {
            select: (select: string) => ({
              eq: (column: string, value: unknown) => ({
                order: (orderColumn: string, options: { ascending: boolean }) => ({
                  limit: (limit: number) => {
                    attemptCalls.push({ select, column, value, order: orderColumn, options, limit })
                    return Promise.resolve(attemptsResult)
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    },
    tablesRead,
    attemptCalls,
  }
}

describe('fetchReportData', () => {
  it('reads every clo for the current course from the static bundle, drafts included, and maps every field', async () => {
    closForMock.mockClear()
    const { client } = makeClient()
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(closForMock).toHaveBeenCalledWith('INFS1101')
    expect(result.clos).toEqual([{
      id: 'INFS1101-1', course: 'INFS1101', ordinal: 1, outcome: 'Write a loop that accumulates a total',
      topics: ['loops'], prerequisites: [], patterns: ['accumulate'], assessableInCode: true,
    }])
  })

  it('marks a draft clo with a " (draft)" outcome suffix instead of excluding it', async () => {
    closForMock.mockReturnValueOnce([{ ...cloRow, draft: true }])
    const { client } = makeClient()
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(result.clos).toEqual([expect.objectContaining({ outcome: 'Write a loop that accumulates a total (draft)' })])
  })

  it('never reads a different course than the one requested', async () => {
    closForMock.mockClear()
    const { client } = makeClient()
    await fetchReportData(client as never, 'user-1', 'CSCI2001')
    expect(closForMock).toHaveBeenCalledWith('CSCI2001')
  })

  it('never issues a `clos` Postgres request -- CLOs come from the static bundle only', async () => {
    const { client, tablesRead } = makeClient()
    await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(tablesRead).not.toContain('clos')
  })

  it('maps attempt rows to camelCase Attempt records, stamps the given userId, and backfills code/results as empty', async () => {
    // The row itself carries neither column (the select string never asks for
    // them — see the next test) — this only proves the mapper never crashes
    // reading a row shaped exactly like what the real narrow query returns.
    const row = {
      id: 'a1', exercise_id: 'ex-1',
      passed: true, duration_ms: 4200, hint_count: 1, created_at: '2026-09-01T00:00:00.000Z',
    }
    const { client } = makeClient({ attempts: { data: [row], error: null } })
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(result.attempts).toEqual([{
      id: 'a1', userId: 'user-1', exerciseId: 'ex-1', code: '', results: [],
      passed: true, durationMs: 4200, hintCount: 1, createdAt: '2026-09-01T00:00:00.000Z',
    }])
  })

  it('never selects code or results, caps at 1000, and orders most-recent-first', async () => {
    const { client, attemptCalls } = makeClient()
    await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(attemptCalls).toHaveLength(1)
    const [call] = attemptCalls
    expect(call.select).not.toMatch(/\bcode\b/)
    expect(call.select).not.toMatch(/\bresults\b/)
    expect(call.select).toContain('passed')
    expect(call.column).toBe('user_id')
    expect(call.value).toBe('user-1')
    expect(call.order).toBe('created_at')
    expect(call.options).toEqual({ ascending: false })
    expect(call.limit).toBe(1000)
  })

  it('reads drill results from wellness and defaults to an empty list when there is no row', async () => {
    const drillResults = [{ drillId: 'd1', kind: 'trace', correct: true, timeMs: 500, score: 80, at: '2026-09-01T00:00:00.000Z' }]
    const { client } = makeClient({ wellness: { data: { drill_results: drillResults }, error: null } })
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(result.drillResults).toEqual(drillResults)

    const { client: emptyClient } = makeClient({ wellness: { data: null, error: null } })
    const emptyResult = await fetchReportData(emptyClient as never, 'user-1', 'INFS1101')
    expect(emptyResult.drillResults).toEqual([])
  })

  it('surfaces a clear error when the wellness query fails', async () => {
    const { client } = makeClient({ wellness: { data: null, error: { message: 'db down' } } })
    await expect(fetchReportData(client as never, 'user-1', 'INFS1101')).rejects.toThrow('Unable to load your de-rot scores.')
  })

  it('never selects from the exercises table', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(app)/reports/data.ts'), 'utf8')
    expect(source).not.toMatch(/from\(['"]exercises['"]\)/)
  })
})
