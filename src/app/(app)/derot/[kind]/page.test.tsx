import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrillItem, DrillResult } from '@/lib/contracts'
import DerotRunnerPage from './page'

const mocks = vi.hoisted(() => ({ params: vi.fn(), searchParams: vi.fn(), lockdown: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => mocks.params(), useSearchParams: () => mocks.searchParams() }))
vi.mock('@/store/session', () => ({ useSession: (selector: (session: { user: { id: string } }) => unknown) => selector({ user: { id: 'student' } }) }))
vi.mock('@/hooks/useLockdown', () => ({ useLockdown: (...args: unknown[]) => mocks.lockdown(...args) }))
vi.mock('@/components/derot', () => ({
  DrillRunner: ({ item, onResult }: { item: DrillItem; onResult: (result: DrillResult) => void }) => (
    <button onClick={() => onResult({ drillId: item.id, kind: item.kind, correct: true, timeMs: 500, score: 88, at: '2026-09-06T12:00:00.000Z' })}>
      Simulate result for {item.id}
    </button>
  ),
}))

let drillsRows: Record<string, unknown>[]
let wellnessRow: { drill_results: DrillResult[] } | null
const updateSpy = vi.fn()
const eqAfterUpdateSpy = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'drills') {
        return { select: () => ({ eq: (_col: string, value: string) => Promise.resolve({ data: drillsRows.filter((row) => row.kind === value), error: null }) }) }
      }
      if (table === 'wellness') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: wellnessRow, error: null }) }) }),
          update: (payload: Record<string, unknown>) => {
            updateSpy(payload)
            return { eq: (col: string, value: string) => { eqAfterUpdateSpy(col, value); return Promise.resolve({ error: null }) } }
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

function drillRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return { id: 'd1', kind: 'trace', difficulty: 3, time_limit_s: 60, payload: {}, ...overrides }
}
function result(overrides: Partial<DrillResult>): DrillResult {
  return { drillId: 'd1', kind: 'trace', correct: true, timeMs: 500, score: 50, at: '2026-01-01T00:00:00.000Z', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.params.mockReturnValue({ kind: 'trace' })
  mocks.searchParams.mockReturnValue(new URLSearchParams())
  mocks.lockdown.mockReturnValue({ overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', loggingError: null })
  drillsRows = [drillRow({ id: 'd1' })]
  wellnessRow = { drill_results: [] }
})
afterEach(cleanup)

describe('de-rot runner', () => {
  it('picks a never-played item over one already played', async () => {
    drillsRows = [drillRow({ id: 't-played' }), drillRow({ id: 't-fresh' })]
    // Played on a previous day: survives the "not done today" filter but counts as played.
    wellnessRow = { drill_results: [result({ drillId: 't-played', at: '2026-09-01T08:00:00.000Z' })] }
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for t-fresh')).toBeTruthy())
  })

  it('mounts lockdown with the picked drill id once it loads', async () => {
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for d1')).toBeTruthy())
    const lastCall = mocks.lockdown.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('d1')
    expect((lastCall?.[1] as { enabled?: boolean })?.enabled).toBe(true)
  })

  it("onResult updates only wellness.drill_results, filtered by the student's user_id", async () => {
    wellnessRow = { drill_results: [result({ drillId: 'other', kind: 'n-back', score: 10, at: '2026-09-01T00:00:00.000Z' })] }
    render(<DerotRunnerPage />)
    const button = await screen.findByText('Simulate result for d1')
    fireEvent.click(button)

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(['drill_results'])
    const nextResults = payload.drill_results as DrillResult[]
    expect(nextResults).toHaveLength(2)
    expect(nextResults[1]).toEqual({ drillId: 'd1', kind: 'trace', correct: true, timeMs: 500, score: 88, at: '2026-09-06T12:00:00.000Z' })
    expect(eqAfterUpdateSpy).toHaveBeenCalledWith('user_id', 'student')

    expect(await screen.findByText('Score: 88')).toBeTruthy()
  })

  it('shows a designed empty state when the kind has no drill items', async () => {
    drillsRows = []
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('No items yet')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Simulate result/ })).toBeNull()
  })

  it('rejects a kind that is not one of the six drills', () => {
    mocks.params.mockReturnValue({ kind: 'made-up' })
    render(<DerotRunnerPage />)
    expect(screen.getByText('This drill could not open')).toBeTruthy()
  })

  it('honors an explicit ?item= deep link even when other items would otherwise be preferred', async () => {
    drillsRows = [drillRow({ id: 'a' }), drillRow({ id: 'b' })]
    mocks.searchParams.mockReturnValue(new URLSearchParams('item=b'))
    render(<DerotRunnerPage />)
    await waitFor(() => expect(screen.getByText('Simulate result for b')).toBeTruthy())
  })
})
