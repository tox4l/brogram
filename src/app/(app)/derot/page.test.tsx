import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrillResult } from '@/lib/contracts'
import DerotPage from './page'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), searchParams: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => mocks.searchParams() }))
vi.mock('@/store/session', () => ({ useSession: (selector: (session: { user: { id: string } }) => unknown) => selector({ user: { id: 'student' } }) }))

let wellnessRow: { drill_results: DrillResult[] } | null
let drillKinds: string[]
let failWellness: boolean
let failDrills: boolean

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'wellness') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                failWellness
                  ? Promise.resolve({ data: null, error: { message: 'unavailable' } })
                  : Promise.resolve({ data: wellnessRow, error: null }),
            }),
          }),
        }
      }
      if (table === 'drills') {
        return {
          select: () =>
            failDrills
              ? Promise.resolve({ data: null, error: { message: 'unavailable' } })
              : Promise.resolve({ data: drillKinds.map((kind) => ({ kind })), error: null }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

const allKinds = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']

function result(overrides: Partial<DrillResult>): DrillResult {
  return { drillId: 'd', kind: 'trace', correct: true, timeMs: 500, score: 0, at: '2026-01-01T00:00:00.000Z', ...overrides }
}

function cardFor(title: string): HTMLElement {
  const heading = screen.getByText(title)
  const card = heading.closest('[data-slot="card"]')
  if (!card) throw new Error(`No card found for ${title}`)
  return card as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchParams.mockReturnValue(new URLSearchParams())
  drillKinds = [...allKinds]
  wellnessRow = { drill_results: [] }
  failWellness = false
  failDrills = false
})
afterEach(cleanup)

describe('de-rot section', () => {
  it('lists all six kinds, showing best and last score where the student has results and an invitation otherwise', async () => {
    wellnessRow = {
      drill_results: [
        result({ drillId: 't1', kind: 'trace', score: 90, at: '2026-09-04T10:00:00.000Z' }),
        result({ drillId: 't2', kind: 'trace', score: 60, at: '2026-09-05T10:00:00.000Z' }),
      ],
    }
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Trace by hand')).toBeTruthy())

    for (const title of ['Predict the output', 'Spot the bug', 'Trace by hand', 'Hold focus', 'N-back', 'Speed type']) {
      expect(screen.getByText(title)).toBeTruthy()
    }

    const trace = cardFor('Trace by hand')
    expect(within(trace).getByText('90')).toBeTruthy() // best
    expect(within(trace).getByText('60')).toBeTruthy() // last (most recent)

    const predictOutput = cardFor('Predict the output')
    expect(within(predictOutput).getByText('Not attempted yet. Give it a try.')).toBeTruthy()
  })

  it('shows the de-rot streak as consecutive days ending today', async () => {
    const now = new Date()
    const today = now.toISOString()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    wellnessRow = { drill_results: [result({ kind: 'n-back', score: 70, at: today }), result({ kind: 'n-back', score: 65, at: yesterday })] }
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('2 days')).toBeTruthy())
  })

  it('shows a designed empty state and disables Start for a kind with no drills in the bank', async () => {
    drillKinds = allKinds.filter((kind) => kind !== 'n-back')
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('N-back')).toBeTruthy())
    const nBack = cardFor('N-back')
    expect(within(nBack).getByText('No items yet. This drill is still being prepared.')).toBeTruthy()
    expect(within(nBack).getByRole('button', { name: 'Start' })).toHaveProperty('disabled', true)
    expect(within(cardFor('Trace by hand')).getByRole('link', { name: /Start/ })).toBeTruthy()
  })

  it('shows a retry option when de-rot progress fails to load', async () => {
    failWellness = true
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('Your de-rot progress could not load.')).toBeTruthy()
  })

  it('redirects ?drill=trace to the trace runner', () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('drill=trace'))
    render(<DerotPage />)
    expect(mocks.replace).toHaveBeenCalledWith('/derot/trace')
  })

  it('ignores an unknown drill query value', () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('drill=not-a-kind'))
    render(<DerotPage />)
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
