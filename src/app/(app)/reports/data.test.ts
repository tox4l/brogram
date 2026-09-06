import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fetchReportData } from './data'

const cloRow = {
  id: 'INFS1101-1', course: 'INFS1101', ordinal: 1, outcome: 'Write a loop that accumulates a total',
  topics: ['loops'], prerequisites: [], patterns: ['accumulate'], assessable_in_code: true, draft: false,
}

function makeClient(overrides: {
  clos?: { data: unknown; error: unknown }
  wellness?: { data: unknown; error: unknown }
  attemptPages?: { data: unknown; error: unknown }[]
} = {}) {
  const closResult = overrides.clos ?? { data: [cloRow], error: null }
  const wellnessResult = overrides.wellness ?? { data: { drill_results: [] }, error: null }
  const attemptPages = overrides.attemptPages ?? [{ data: [], error: null }]
  const cloFilters: unknown[] = []
  const attemptCalls: { column: string; value: unknown; from: number; to: number }[] = []

  return {
    client: {
      from: (table: string) => {
        if (table === 'clos') {
          return {
            select: (columns: string) => {
              expect(columns).toContain('assessable_in_code')
              return {
                eq: (column: string, value: unknown) => {
                  cloFilters.push([column, value])
                  return { order: (orderColumn: string) => {
                    expect(orderColumn).toBe('ordinal')
                    return Promise.resolve(closResult)
                  } }
                },
              }
            },
          }
        }
        if (table === 'wellness') {
          return {
            select: (columns: string) => {
              expect(columns).toBe('drill_results')
              return { eq: (column: string, value: unknown) => {
                expect(column).toBe('user_id')
                return { maybeSingle: () => Promise.resolve(wellnessResult) }
              } }
            },
          }
        }
        if (table === 'attempts') {
          return {
            select: () => ({
              eq: (column: string, value: unknown) => ({
                order: (orderColumn: string, options: { ascending: boolean }) => {
                  expect(orderColumn).toBe('created_at')
                  expect(options).toEqual({ ascending: true })
                  return {
                    range: (from: number, to: number) => {
                      attemptCalls.push({ column, value, from, to })
                      const page = attemptPages[attemptCalls.length - 1] ?? { data: [], error: null }
                      return Promise.resolve(page)
                    },
                  }
                },
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    },
    cloFilters,
    attemptCalls,
  }
}

describe('fetchReportData', () => {
  it('loads every clo for the current course, drafts included, and maps every field', async () => {
    const { client, cloFilters } = makeClient()
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(cloFilters).toEqual([['course', 'INFS1101']])
    expect(result.clos).toEqual([{
      id: 'INFS1101-1', course: 'INFS1101', ordinal: 1, outcome: 'Write a loop that accumulates a total',
      topics: ['loops'], prerequisites: [], patterns: ['accumulate'], assessableInCode: true,
    }])
  })

  it('marks a draft clo with a " (draft)" outcome suffix instead of excluding it', async () => {
    const { client } = makeClient({ clos: { data: [{ ...cloRow, draft: true }], error: null } })
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(result.clos).toEqual([expect.objectContaining({ outcome: 'Write a loop that accumulates a total (draft)' })])
  })

  it('never queries a different course than the one requested', async () => {
    const { client, cloFilters } = makeClient()
    await fetchReportData(client as never, 'user-1', 'CSCI2001')
    expect(cloFilters[0]).toEqual(['course', 'CSCI2001'])
  })

  it('maps attempt rows to camelCase Attempt records and stamps the given userId', async () => {
    const row = {
      id: 'a1', exercise_id: 'ex-1', code: 'print(1)',
      results: [{ testId: 't1', passed: true, actual: '1', expected: '1', stdout: '1', stderr: '', durationMs: 5 }],
      passed: true, duration_ms: 4200, hint_count: 1, created_at: '2026-09-01T00:00:00.000Z',
    }
    const { client } = makeClient({ attemptPages: [{ data: [row], error: null }] })
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(result.attempts).toEqual([{
      id: 'a1', userId: 'user-1', exerciseId: 'ex-1', code: 'print(1)',
      results: row.results, passed: true, durationMs: 4200, hintCount: 1, createdAt: '2026-09-01T00:00:00.000Z',
    }])
  })

  it('pages attempts at 1000 rows until a short page ends the fetch', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      id: `a${i}`, exercise_id: 'ex-1', code: '', results: [], passed: true,
      duration_ms: 1, hint_count: 0, created_at: '2026-09-01T00:00:00.000Z',
    }))
    const { client, attemptCalls } = makeClient({
      attemptPages: [{ data: fullPage, error: null }, { data: [{ ...fullPage[0], id: 'a1000' }], error: null }],
    })
    const result = await fetchReportData(client as never, 'user-1', 'INFS1101')
    expect(result.attempts).toHaveLength(1001)
    expect(attemptCalls.map(c => [c.column, c.value, c.from, c.to])).toEqual([
      ['user_id', 'user-1', 0, 999],
      ['user_id', 'user-1', 1000, 1999],
    ])
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

  it('surfaces a clear error when the clos query fails', async () => {
    const { client } = makeClient({ clos: { data: null, error: { message: 'db down' } } })
    await expect(fetchReportData(client as never, 'user-1', 'INFS1101')).rejects.toThrow('Unable to load your course outcomes.')
  })

  it('never selects from the exercises table', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/(app)/reports/data.ts'), 'utf8')
    expect(source).not.toMatch(/from\(['"]exercises['"]\)/)
  })
})
