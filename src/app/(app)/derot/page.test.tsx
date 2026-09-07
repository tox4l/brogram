import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrillResult } from '@/lib/contracts'
import DerotPage from './page'

beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  // jsdom has no IntersectionObserver; the card idle-motion hook feature-detects
  // and no-ops without one, but a fake here exercises the same code path a
  // real browser would take (spec 10.8's "pauses off-screen" behaviour).
  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: ReadonlyArray<number> = []
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this) }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
  ;(globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver = FakeIntersectionObserver
})

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

const arcadeKinds = ['predict-output', 'spot-the-bug', 'trace', 'hold-focus', 'n-back', 'speed-type']
const playKinds = ['follow-the-dot', 'color-nback', 'reaction', 'rhythm', 'breathe', 'memory-grid']

function result(overrides: Partial<DrillResult>): DrillResult {
  return { drillId: 'd', kind: 'trace', correct: true, timeMs: 500, score: 0, at: '2026-01-01T00:00:00.000Z', lane: 'arcade', ...overrides }
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
  drillKinds = [...arcadeKinds, ...playKinds]
  wellnessRow = { drill_results: [] }
  failWellness = false
  failDrills = false
})
afterEach(cleanup)

describe('the de-rot hub', () => {
  it('notes that four Arcade kinds cap below 100, only on the Arcade lane (fix round 2, N5)', async () => {
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Call It')).toBeTruthy())
    expect(screen.getByText(/cap out near 95/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    await waitFor(() => expect(screen.getByText('Follow the Dot')).toBeTruthy())
    expect(screen.queryByText(/cap out near 95/)).toBeNull()
  })

  it('opens on the Arcade lane, listing the six Arcade cards with their voice titles', async () => {
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Run It in Your Head')).toBeTruthy())
    for (const title of ['Call It', 'Find the Break', 'Run It in Your Head', "Don't Blink", 'Two Back', 'Hands']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
    for (const title of ['Follow the Dot', 'Match Back', 'Twitch', 'Keep Time', 'Breathe', 'Grid']) {
      expect(screen.queryByText(title)).toBeNull()
    }
  })

  it('names each lane\'s promise under the switch, using the voice bank (fix round 1, I7)', async () => {
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText("Timer's on. Beat yesterday's you.")).toBeTruthy())

    fireEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    await waitFor(() => expect(screen.getByText('No code in here. Just you and the screen.')).toBeTruthy())
  })

  it('switches to the Playground lane and shows its six cards instead', async () => {
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Call It')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    await waitFor(() => expect(screen.getByText('Follow the Dot')).toBeTruthy())
    expect(screen.queryByText('Call It')).toBeNull()
  })

  it('shows the personal best inline where the student has results, and an invitation otherwise', async () => {
    wellnessRow = {
      drill_results: [
        result({ drillId: 't1', kind: 'trace', score: 90, at: '2026-09-04T10:00:00.000Z' }),
        result({ drillId: 't2', kind: 'trace', score: 60, at: '2026-09-05T10:00:00.000Z' }),
      ],
    }
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Run It in Your Head')).toBeTruthy())

    const trace = cardFor('Run It in Your Head')
    expect(within(trace).getByText('Best')).toBeTruthy()
    expect(within(trace).getByText('90')).toBeTruthy()

    const predictOutput = cardFor('Call It')
    expect(within(predictOutput).getByText('Not attempted yet. Give it a try.')).toBeTruthy()
  })

  it('shows the de-rot streak as consecutive days ending today, counting activity across both lanes', async () => {
    const now = new Date()
    const today = now.toISOString()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    wellnessRow = { drill_results: [result({ kind: 'n-back', score: 70, at: today }), result({ kind: 'breathe', lane: 'play', score: 65, at: yesterday })] }
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('2 days')).toBeTruthy())
  })

  it("counts today's runs as one row per completed run, across both lanes", async () => {
    const today = new Date().toISOString()
    wellnessRow = {
      drill_results: [
        result({ kind: 'trace', score: 80, at: today }),
        result({ kind: 'breathe', lane: 'play', score: 90, at: today }),
      ],
    }
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText("Today's runs")).toBeTruthy())
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('shows a designed empty state and disables Start for a kind with no drills in the bank', async () => {
    drillKinds = drillKinds.filter((kind) => kind !== 'n-back')
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Two Back')).toBeTruthy())
    const nBack = cardFor('Two Back')
    expect(within(nBack).getByText('No items yet. This drill is still being prepared.')).toBeTruthy()
    expect(within(nBack).getByRole('button', { name: 'Start' })).toHaveProperty('disabled', true)
    expect(within(cardFor('Run It in Your Head')).getByRole('link', { name: /Start/ })).toBeTruthy()
  })

  it('W2G-1: every Playground Start stays enabled at schema 0005, when the drills table holds only Arcade kinds', async () => {
    // The live `drills` table at 0005 never carries the six Playground marker
    // rows -- `lane` and the seed loader's write of them only exist from
    // migration 0009 -- so `availableKinds` here is Arcade-only, exactly the
    // production shape this fix must survive.
    drillKinds = [...arcadeKinds]
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Call It')).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    await waitFor(() => expect(screen.getByText('Follow the Dot')).toBeTruthy())
    for (const title of ['Follow the Dot', 'Match Back', 'Twitch', 'Keep Time', 'Breathe', 'Grid']) {
      const start = within(cardFor(title)).getByRole('link', { name: /Start/ })
      expect(start).toBeTruthy()
      expect(within(cardFor(title)).queryByRole('button', { name: 'Start' })).toBeNull()
    }
  })

  it('links each card to the right lane path', async () => {
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Call It')).toBeTruthy())
    expect(within(cardFor('Call It')).getByRole('link', { name: /Start/ }).getAttribute('href')).toBe('/derot/arcade/predict-output')

    fireEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    await waitFor(() => expect(screen.getByText('Breathe')).toBeTruthy())
    expect(within(cardFor('Breathe')).getByRole('link', { name: /Start/ }).getAttribute('href')).toBe('/derot/play/breathe')
  })

  it('shows a retry option (from the voice bank) when de-rot progress fails to load', async () => {
    failWellness = true
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText("Couldn't load that. Try again.")).toBeTruthy()
  })

  it('T4.8: renders exactly one filled Start across the whole grid, the rest ghost (spec section 4)', async () => {
    wellnessRow = {
      drill_results: [result({ drillId: 't1', kind: 'trace', score: 90, at: '2026-09-04T10:00:00.000Z' })],
    }
    render(<DerotPage />)
    await waitFor(() => expect(screen.getByText('Call It')).toBeTruthy())
    const starts = screen.getAllByRole('link', { name: /Start/ })
    expect(starts).toHaveLength(6)
    // The filled ("default") button variant carries `bg-primary`; the ghost
    // ("outline") variant never does -- see src/components/ui/button.tsx.
    const filled = starts.filter((el) => el.className.includes('bg-primary'))
    expect(filled).toHaveLength(1)

    fireEvent.click(screen.getByRole('tab', { name: 'Playground' }))
    await waitFor(() => expect(screen.getByText('Follow the Dot')).toBeTruthy())
    const playStarts = screen.getAllByRole('link', { name: /Start/ })
    const playFilled = playStarts.filter((el) => el.className.includes('bg-primary'))
    expect(playFilled).toHaveLength(1)
  })

  it('redirects ?drill=trace straight to the Arcade runner', () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('drill=trace'))
    render(<DerotPage />)
    expect(mocks.replace).toHaveBeenCalledWith('/derot/arcade/trace')
  })

  it('redirects ?drill=breathe straight to the Playground runner', () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('drill=breathe'))
    render(<DerotPage />)
    expect(mocks.replace).toHaveBeenCalledWith('/derot/play/breathe')
  })

  it('ignores an unknown drill query value', () => {
    mocks.searchParams.mockReturnValue(new URLSearchParams('drill=not-a-kind'))
    render(<DerotPage />)
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
