import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrillResult, LearnerState } from '@/lib/contracts'
import DerotPlayRunnerPage from './page'

// Real timers throughout (matching the Arcade runner's own page.test.tsx): the three-two-one
// start is ~2.6s of real waiting per test, so this file's tests need headroom beyond the 5s default.
vi.setConfig({ testTimeout: 15000 })
const COUNTDOWN_TIMEOUT = { timeout: 5000 }

let osReducedMotion = false
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: osReducedMotion,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

const mocks = vi.hoisted(() => ({
  params: vi.fn(),
  push: vi.fn(),
  setLearnerState: vi.fn(),
  learnerState: null as LearnerState | null,
}))
vi.mock('next/navigation', () => ({
  useParams: () => mocks.params(),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/store/session', () => ({
  useSession: (selector: (session: { user: { id: string }; learnerState: LearnerState | null; setLearnerState: typeof mocks.setLearnerState }) => unknown) =>
    selector({ user: { id: 'student' }, learnerState: mocks.learnerState, setLearnerState: mocks.setLearnerState }),
}))

/** One tiny stub per game id -- the route's own concerns (id validation, the three-two-one, prop wiring, scoring dispatch, submit, the run summary) are what this file tests, not each game's own mechanics (covered directly in play.test.tsx / play-games.test.tsx). */
const stubs = vi.hoisted(() => {
  function makeStub(id: string, raw: number, payload: Record<string, unknown>) {
    return function StubGame(props: { timeLimitS: number; soundOn: boolean; reducedMotion: boolean; onComplete: (r: { raw: number; payload: Record<string, unknown> }) => void; onAbort: () => void }) {
      return (
        <div>
          <p>{id} mounted timeLimitS={props.timeLimitS} soundOn={String(props.soundOn)} reducedMotion={String(props.reducedMotion)}</p>
          <button onClick={() => props.onComplete({ raw, payload })}>Complete {id}</button>
          <button onClick={props.onAbort}>Abort {id}</button>
        </div>
      )
    }
  }
  return { makeStub }
})

vi.mock('@/components/derot/play/FollowTheDot', () => ({ default: stubs.makeStub('follow-the-dot', 0.5, {}) }))
vi.mock('@/components/derot/play/ColorBack', () => ({ default: stubs.makeStub('color-nback', 0, { hits: 6, falseAlarms: 1, plantedMatches: 8 }) }))
vi.mock('@/components/derot/play/Twitch', () => ({ default: stubs.makeStub('reaction', 842, {}) }))
vi.mock('@/components/derot/play/KeepTime', () => ({ default: stubs.makeStub('rhythm', 150, {}) }))
vi.mock('@/components/derot/play/Breathe', () => ({ default: stubs.makeStub('breathe', 100, {}) }))
vi.mock('@/components/derot/play/MemoryGrid', () => ({ default: stubs.makeStub('memory-grid', 750, { roundsCleared: 3 }) }))

let wellnessRow: { prefs?: unknown; drill_results?: DrillResult[] } | null
let rpcError: { code?: string; message?: string } | null
let rpcData: DrillResult[]
const rpcSpy = vi.fn()
let wellnessSelectError: { message: string } | null = null

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => {
      rpcSpy(...args)
      return Promise.resolve(rpcError ? { data: null, error: rpcError } : { data: rpcData, error: null })
    },
    from: (table: string) => {
      if (table === 'wellness') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: wellnessSelectError ? null : wellnessRow, error: wellnessSelectError }) }) }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

function learnerState(overrides: Partial<LearnerState> = {}): LearnerState {
  return {
    userId: 'student',
    profile: {
      displayName: '', learningStyle: 'mixed',
      styleVector: { visual: 0.5, verbal: 0.5, example: 0.5, theory: 0.5 },
      tone: 'supportive', verbosity: 'short',
      motivation: { why: '', beyondCourses: false, depth: 'understand', wantsAgenticCoding: false },
      onboardingComplete: true,
    },
    currentCourse: 'course-1', path: [], nextExerciseIds: [], mastery: {}, recentMistakes: [],
    streak: { exerciseDays: 2, derotDays: 0, lastExerciseDate: '2026-09-05', lastDerotDate: null },
    points: 100, integrityScore: 0, accountStatus: 'active', version: 3, updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  }
}

function result(overrides: Partial<DrillResult> = {}): DrillResult {
  return { drillId: 'play-follow-the-dot', kind: 'follow-the-dot', correct: true, timeMs: 500, score: 50, at: '2026-01-01T00:00:00.000Z', lane: 'play', ...overrides }
}

beforeEach(() => {
  osReducedMotion = false
  mocks.params.mockReturnValue({ game: 'follow-the-dot' })
  mocks.learnerState = learnerState()
  wellnessRow = { prefs: {}, drill_results: [] }
  wellnessSelectError = null
  rpcError = null
  rpcData = []
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DerotPlayRunnerPage', () => {
  it('rejects an id outside the six Playground kinds', async () => {
    mocks.params.mockReturnValue({ game: 'not-a-game' })
    render(<DerotPlayRunnerPage />)
    expect(await screen.findByText('This game could not open')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to de-rot' })).toHaveProperty('href', expect.stringContaining('/derot'))
  })

  it('opens the game, runs the three-two-one, mounts it with the right props, and produces one DrillResult with lane play', async () => {
    wellnessRow = { prefs: { motion: 'reduced', sound: { enabled: true, volume: 0.6, interface: true } }, drill_results: [] }
    rpcData = [result({ score: 50, timeMs: 500 })]
    render(<DerotPlayRunnerPage />)

    expect(await screen.findByText('Follow the Dot')).toBeTruthy()
    expect(await screen.findByText('3')).toBeTruthy()

    const mounted = await screen.findByText(/follow-the-dot mounted/, {}, COUNTDOWN_TIMEOUT)
    expect(mounted.textContent).toContain('timeLimitS=75')
    expect(mounted.textContent).toContain('soundOn=true')
    expect(mounted.textContent).toContain('reducedMotion=true') // prefs.motion: 'reduced' overrides the OS signal either way

    fireEvent.click(screen.getByText('Complete follow-the-dot'))

    expect(await screen.findByText('Run complete')).toBeTruthy()
    expect(await screen.findByText('50% of frames inside the dot')).toBeTruthy()
    expect(rpcSpy).toHaveBeenCalledWith('append_drill_result', {
      result: expect.objectContaining({ drillId: 'play-follow-the-dot', kind: 'follow-the-dot', lane: 'play', correct: true, score: 50, timeMs: 500 }),
    })
    const submitted = rpcSpy.mock.calls[0][1].result as DrillResult
    expect(submitted.score).toBeGreaterThanOrEqual(0)
    expect(submitted.score).toBeLessThanOrEqual(100)
    expect(mocks.setLearnerState).toHaveBeenCalled()
  })

  it('reads soundOn from prefs.sound.interface, off by default', async () => {
    wellnessRow = { prefs: {}, drill_results: [] } // DEFAULT_WELLNESS.sound.interface is false
    render(<DerotPlayRunnerPage />)
    const mounted = await screen.findByText(/follow-the-dot mounted/, {}, COUNTDOWN_TIMEOUT)
    expect(mounted.textContent).toContain('soundOn=false')
  })

  it('resolves reducedMotion from the OS signal when the preference is system', async () => {
    osReducedMotion = true
    wellnessRow = { prefs: { motion: 'system' }, drill_results: [] }
    render(<DerotPlayRunnerPage />)
    const mounted = await screen.findByText(/follow-the-dot mounted/, {}, COUNTDOWN_TIMEOUT)
    expect(mounted.textContent).toContain('reducedMotion=true')
  })

  it('shows a personal-best badge and voice line when the new score beats the stored best', async () => {
    wellnessRow = { prefs: {}, drill_results: [result({ score: 20 })] }
    rpcData = [result({ score: 20 }), result({ score: 50 })]
    render(<DerotPlayRunnerPage />)
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    expect(await screen.findByText('New best')).toBeTruthy()
    expect(screen.getByText('New personal best. Run it again.')).toBeTruthy()
  })

  it('surfaces a save error with a working retry, without blocking the run summary', async () => {
    wellnessRow = { prefs: {}, drill_results: [] }
    rpcError = { code: '23505', message: 'unique violation' } // a real failure, never the missing-RPC fallback shape
    render(<DerotPlayRunnerPage />)
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))

    expect(await screen.findByText('Run complete')).toBeTruthy()
    expect(await screen.findByText(/could not be saved/)).toBeTruthy()

    rpcError = null
    rpcData = [result()]
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await screen.findByText('50') // the summary is already showing; this just lets the retry's promise settle
    expect(screen.queryByText(/could not be saved/)).toBeNull()
  })

  it('surfaces a load error with a working retry', async () => {
    wellnessSelectError = { message: 'network down' }
    render(<DerotPlayRunnerPage />)
    expect(await screen.findByText('This game could not open.')).toBeTruthy()

    wellnessSelectError = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/follow-the-dot mounted/, {}, COUNTDOWN_TIMEOUT)).toBeTruthy()
  })

  it('quitting mid-game (onAbort) navigates back to de-rot without submitting a run', async () => {
    render(<DerotPlayRunnerPage />)
    fireEvent.click(await screen.findByText('Abort follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    expect(mocks.push).toHaveBeenCalledWith('/derot')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  // Expected raw labels match this file's own stub payloads run through the route's real
  // scoreForGame/timeMsForGame/rawLabelFor dispatch: color-nback and memory-grid read their
  // primitive out of `payload` (hits/falseAlarms/plantedMatches, roundsCleared) rather than
  // `raw`, exactly like the real ColorBack.tsx / MemoryGrid.tsx components do.
  const gameCases: [string, number, string, number][] = [
    ['color-nback', 90, '0 net hits', 63], // normalizeColorNBack(6, 1, 8): net 5 of 8 planted
    ['reaction', 60, '842 ms mean reaction', 92], // normalizeReaction(842)
    ['rhythm', 60, '150 ms mean offset from the beat', 70], // normalizeRhythm(150)
    ['breathe', 90, '100% of the pacer completed', 100], // normalizeBreathe(100)
    ['memory-grid', 90, '3 rounds cleared', 25], // normalizeMemoryGrid(3)
  ]

  it.each(gameCases)('mounts %s with timeLimitS %d and produces a lane-play DrillResult with score in [0,100]', async (game, timeLimitS, rawLabel, expectedScore) => {
    mocks.params.mockReturnValue({ game })
    rpcData = [result({ drillId: `play-${game}`, kind: game as DrillResult['kind'] })]
    render(<DerotPlayRunnerPage />)
    const mounted = await screen.findByText(new RegExp(`${game} mounted`), {}, COUNTDOWN_TIMEOUT)
    expect(mounted.textContent).toContain(`timeLimitS=${timeLimitS}`)

    fireEvent.click(screen.getByText(`Complete ${game}`))
    await screen.findByText('Run complete')
    await screen.findByText(rawLabel) // unique to the settled run summary, so the submit promise has settled too
    const submitted = rpcSpy.mock.calls[0][1].result as DrillResult
    expect(submitted.lane).toBe('play')
    expect(submitted.drillId).toBe(`play-${game}`)
    expect(submitted.score).toBe(expectedScore)
  })
})
