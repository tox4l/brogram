// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fetchAllRows, ADMIN_PAGE_SIZE } from './paginate'

describe('fetchAllRows', () => {
  it('pages past the 1000-row cap and stops on a short page', async () => {
    const firstPage = Array.from({ length: ADMIN_PAGE_SIZE }, (_, i) => i)
    const secondPage = [1000, 1001, 1002]
    const calls: Array<[number, number]> = []

    const rows = await fetchAllRows<number>(async (from, to) => {
      calls.push([from, to])
      const page = from === 0 ? firstPage : secondPage
      return { data: page, error: null }
    })

    expect(rows).toHaveLength(1003)
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('stops immediately on an empty first page', async () => {
    const rows = await fetchAllRows<number>(async () => ({ data: [], error: null }))
    expect(rows).toEqual([])
  })

  it('throws on a page error', async () => {
    await expect(fetchAllRows(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
  })
})
