import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { Attempt, DrillResult, LearnerState, LessonProgress } from '@/lib/contracts'
import { LINE_BANK } from '@/lib/voice/lines'
import { clearQueryClient, getQueryClient } from '@/lib/query/client'
import { qk } from '@/lib/query/keys'
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
  play: vi.fn(),
  recordGoalDay: vi.fn(),
  recordAchievements: vi.fn(),
  hasPendingPrefsWrite: vi.fn(() => false),
}))
vi.mock('next/navigation', () => ({
  useParams: () => mocks.params(),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/store/session', () => ({
  useSession: (selector: (session: { user: { id: string }; learnerState: LearnerState | null; setLearnerState: typeof mocks.setLearnerState }) => unknown) =>
    selector({ user: { id: 'student' }, learnerState: mocks.learnerState, setLearnerState: mocks.setLearnerState }),
}))
vi.mock('@/lib/sound/manager', () => ({ play: mocks.play, withInterfaceSounds: (run: () => void) => run() }))
// X2/X7/X1: mirrors Arcade's own page.test.tsx -- this file only proves the
// runner calls the shared writers with a context built from the run it just
// saved, not their own internals (unit-tested in record.test.ts).
//
// Fix round 3 (W2FIX-F3): `@/lib/query/client` is now the REAL module, not a
// bare-object mock -- the page mounts a genuine `useQuery` observer
// (`useKeepAttemptsResident`) to keep `qk.attempts` resident past its
// five-minute `gcTime`, which needs a real `QueryClient`/`QueryClientProvider`
// underneath it to prove anything. `getQueryClient()`'s cache is seeded and
// read directly (`setQueryData`/`getQueryData`) and `invalidateQueries` is
// spied on, rather than mocking the module away.
vi.mock('@/lib/rewards/record', () => ({ recordGoalDay: mocks.recordGoalDay, recordAchievements: mocks.recordAchievements }))
// F3-2: the wellness dock's own writer is unit-tested against the real
// implementation in prefsMutation.test.ts -- this file only proves the
// runner consults the guard before invalidating.
vi.mock('@/app/(app)/account/prefsMutation', () => ({ hasPendingPrefsWrite: mocks.hasPendingPrefsWrite }))

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
vi.mock('@/components/derot/play/ColorBack', () => ({ default: stubs.makeStub('color-nback', 500, { hits: 6, falseAlarms: 1, plantedMatches: 8 }) }))
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

/**
 * Fix round 3 (W2FIX-F3): wraps the page in a real `QueryClientProvider`
 * bound to the same singleton `getQueryClient()` the page's own imports
 * resolve to -- mirrors Arcade's own `page.test.tsx` fix.
 */
function renderPage() {
  return render(
    <QueryClientProvider client={getQueryClient()}>
      <DerotPlayRunnerPage />
    </QueryClientProvider>,
  )
}

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

let invalidateSpy: MockInstance

beforeEach(() => {
  osReducedMotion = false
  // Fix round 3 (W2FIX-F3): a fresh, unmocked `QueryClient` per test, since
  // `getQueryClient()` is now the real module-level browser singleton.
  clearQueryClient()
  invalidateSpy = vi.spyOn(getQueryClient(), 'invalidateQueries')
  mocks.params.mockReturnValue({ game: 'follow-the-dot' })
  mocks.learnerState = learnerState()
  wellnessRow = { prefs: {}, drill_results: [] }
  wellnessSelectError = null
  rpcError = null
  rpcData = []
  mocks.hasPendingPrefsWrite.mockReturnValue(false)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  clearQueryClient()
})

describe('DerotPlayRunnerPage', () => {
  it('rejects an id outside the six Playground kinds', async () => {
    mocks.params.mockReturnValue({ game: 'not-a-game' })
    renderPage()
    expect(await screen.findByText('This game could not open')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to de-rot' })).toHaveProperty('href', expect.stringContaining('/derot'))
  })

  it('opens the game, runs the three-two-one, mounts it with the right props, and produces one DrillResult with lane play', async () => {
    wellnessRow = { prefs: { motion: 'reduced', sound: { enabled: true, volume: 0.6, interface: true } }, drill_results: [] }
    rpcData = [result({ score: 50, timeMs: 500 })]
    renderPage()

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
    renderPage()
    const mounted = await screen.findByText(/follow-the-dot mounted/, {}, COUNTDOWN_TIMEOUT)
    expect(mounted.textContent).toContain('soundOn=false')
  })

  it('resolves reducedMotion from the OS signal when the preference is system', async () => {
    osReducedMotion = true
    wellnessRow = { prefs: { motion: 'system' }, drill_results: [] }
    renderPage()
    const mounted = await screen.findByText(/follow-the-dot mounted/, {}, COUNTDOWN_TIMEOUT)
    expect(mounted.textContent).toContain('reducedMotion=true')
  })

  it('shows a personal-best badge and voice line when the new score beats the stored best', async () => {
    wellnessRow = { prefs: {}, drill_results: [result({ score: 20 })] }
    rpcData = [result({ score: 20 }), result({ score: 50 })]
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    expect(await screen.findByText('New best')).toBeTruthy()
    expect(screen.getByText('New personal best. Run it again.')).toBeTruthy()
  })

  // Fix round 1 (T2.9a re-check): mirrors Arcade's own corrected rule -- a personal best requires
  // a genuine previous run to beat (`previousBest !== null`), not merely a non-negative score
  // against a `?? -1` fallback -- which let a flat 0 badge itself "New best" on a first run,
  // since 0 > -1. The `previousBest !== null` guard rules out every score on a first run,
  // zero included, by construction rather than by re-checking the score itself.
  it('never badges a first run as a personal best', async () => {
    wellnessRow = { prefs: {}, drill_results: [] } // no prior run of this kind at all
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    expect(await screen.findByText('Run complete')).toBeTruthy()
    expect(screen.queryByText('New best')).toBeNull()
    expect(screen.getByText('First run logged')).toBeTruthy()
    expect(screen.queryByText('New personal best. Run it again.')).toBeNull()
  })

  it('surfaces a save error with a working retry, without blocking the run summary', async () => {
    wellnessRow = { prefs: {}, drill_results: [] }
    rpcError = { code: '23505', message: 'unique violation' } // a real failure, never the missing-RPC fallback shape
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))

    expect(await screen.findByText('Run complete')).toBeTruthy()
    // TI-3: pinned against the bank's own three variants (never a single
    // `toBe`, which would fail every unseeded draw -- pickIndex guarantees
    // consecutive draws differ) rather than a loose non-empty/regex check
    // that would still pass with a raw thrown error leaking into the copy.
    // The message is the alert's own <p> only -- the region also wraps the
    // "Retry save" button, so a whole-region textContent check could never
    // equal one bare variant string.
    const alertBeforeRetry = await screen.findByRole('alert')
    expect(LINE_BANK['error.save'].variants).toContain(alertBeforeRetry.querySelector('p')!.textContent)
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy()

    rpcError = null
    rpcData = [result()]
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await screen.findByText('50') // the summary is already showing; this just lets the retry's promise settle
    expect(screen.queryByRole('button', { name: 'Retry save' })).toBeNull()
  })

  it('surfaces a load error with a working retry', async () => {
    wellnessSelectError = { message: 'network down' }
    renderPage()
    expect(await screen.findByText('This game could not open.')).toBeTruthy()

    wellnessSelectError = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/follow-the-dot mounted/, {}, COUNTDOWN_TIMEOUT)).toBeTruthy()
  })

  it('invalidates the shared wellness cache once a save succeeds, and not when it fails (X2)', async () => {
    rpcData = [result({ score: 50, timeMs: 500 })]
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('Run complete')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['wellness', 'student'] })
  })

  it('does not invalidate the wellness cache while a dock prefs write is queued (F3-2)', async () => {
    mocks.hasPendingPrefsWrite.mockReturnValue(true)
    rpcData = [result({ score: 50, timeMs: 500 })]
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('Run complete')
    expect(mocks.hasPendingPrefsWrite).toHaveBeenCalledWith('student')
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('does not invalidate the wellness cache, or record a goal day / achievements, when the save fails (X2)', async () => {
    rpcError = { code: '23505', message: 'unique violation' }
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('Run complete')
    expect(invalidateSpy).not.toHaveBeenCalled()
    expect(mocks.recordGoalDay).not.toHaveBeenCalled()
    expect(mocks.recordAchievements).not.toHaveBeenCalled()
  })

  it('calls recordGoalDay with a context whose drillResults carry the run just saved (X7)', async () => {
    rpcData = [result({ drillId: 'play-follow-the-dot', kind: 'follow-the-dot', lane: 'play', score: 50 })]
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('Run complete')
    expect(mocks.recordGoalDay).toHaveBeenCalledTimes(1)
    const [, calledUserId, ctx] = mocks.recordGoalDay.mock.calls[0] as [unknown, string, { drillResults: DrillResult[] }]
    expect(calledUserId).toBe('student')
    expect(ctx.drillResults.some((r) => r.kind === 'follow-the-dot' && r.lane === 'play')).toBe(true)
  })

  it('builds the ctx with the REAL lessonProgress and attempts off the query cache, not empty arrays (F3-1)', async () => {
    // F3-1: without this, a mixed day (a walkthrough completed earlier today
    // plus this Playground run) would undercount `winsToday` and silently
    // drop today's goal day -- reproducing X7 one layer down. Seeded
    // directly on the real cache (keyed, not positional) rather than a
    // mocked `getQueryData`.
    const todayLessonProgress: LessonProgress = { lessonId: 'l1', userId: 'student', cloId: 'l1', status: 'completed', blockIndex: 5, checksPassed: 1, checksFailed: 0, lessonVersion: 1, startedAt: '2026-09-06T08:50:00.000Z', completedAt: '2026-09-06T09:00:00.000Z', updatedAt: '2026-09-06T09:00:00.000Z' }
    const todayAttempt: Attempt = { id: 'a1', userId: 'student', exerciseId: 'e1', code: '', results: [], passed: true, durationMs: 0, hintCount: 0, createdAt: '2026-09-06T08:00:00.000Z' }
    getQueryClient().setQueryData(qk.lessonProgress('student'), [todayLessonProgress])
    getQueryClient().setQueryData(qk.attempts('student'), [todayAttempt])
    rpcData = [result({ drillId: 'play-follow-the-dot', kind: 'follow-the-dot', lane: 'play', score: 50 })]
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('Run complete')
    expect(mocks.recordGoalDay).toHaveBeenCalledTimes(1)
    const [, , ctx] = mocks.recordGoalDay.mock.calls[0] as [unknown, string, { lessonProgress: unknown[]; attempts: unknown[] }]
    expect(ctx.lessonProgress).toEqual([todayLessonProgress])
    expect(ctx.attempts).toEqual([todayAttempt])
  })

  it('F3 fix round 3: an attempts row seeded before any observer survives an idle five minutes on this screen, so recordGoalDay still sees it in context', async () => {
    // Reproduces the exact hazard the finding named: nothing under
    // src/app/(app)/derot mounted an observer on qk.attempts, so TanStack's
    // default five-minute gcTime silently dropped a row `QuerySeed` had
    // already put in the cache before this screen's own observer attached.
    // `shouldAdvanceTime` keeps real wall-clock time ticking underneath the
    // faked one (mirrors lesson.test.tsx's own R1 test and Arcade's own
    // page.test.tsx fix) so this file's real setTimeout-driven three-two-one
    // countdown and testing-library's polling both keep working; only the
    // explicit `advanceTimersByTimeAsync` call jumps the five minutes.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const seededAttempt: Attempt = { id: 'a1', userId: 'student', exerciseId: 'e1', code: '', results: [], passed: true, durationMs: 0, hintCount: 0, createdAt: '2026-09-06T08:00:00.000Z' }
      // Seeded before render -- no observer exists on this key yet, exactly
      // like `QuerySeed`'s server-side hydration landing before any client
      // component mounts.
      getQueryClient().setQueryData(qk.attempts('student'), [seededAttempt])
      rpcData = [result({ drillId: 'play-follow-the-dot', kind: 'follow-the-dot', lane: 'play', score: 50 })]
      renderPage()
      await screen.findByText('Follow the Dot')

      // No other observer anywhere in this test subscribes to qk.attempts --
      // only this page's own `useKeepAttemptsResident` observer can be
      // keeping the row alive past this mark.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1_000)

      fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
      await screen.findByText('Run complete')
      expect(mocks.recordGoalDay).toHaveBeenCalledTimes(1)
      const [, , ctx] = mocks.recordGoalDay.mock.calls[0] as [unknown, string, { attempts: unknown[] }]
      expect(ctx.attempts).toEqual([seededAttempt])
    } finally {
      vi.useRealTimers()
    }
  })

  it('calls recordAchievements with a context whose drillResults carry the run just saved (X1)', async () => {
    rpcData = [result({ drillId: 'play-follow-the-dot', kind: 'follow-the-dot', lane: 'play', score: 50 })]
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('Run complete')
    expect(mocks.recordAchievements).toHaveBeenCalledTimes(1)
    const [, calledUserId, ctx, held] = mocks.recordAchievements.mock.calls[0] as [unknown, string, { drillResults: DrillResult[] }, readonly string[]]
    expect(calledUserId).toBe('student')
    expect(ctx.drillResults.some((r) => r.kind === 'follow-the-dot' && r.lane === 'play')).toBe(true)
    expect(held).toEqual([])
  })

  it('plays drill.hit at run end and best only when this run genuinely beats a real previous best (X8)', async () => {
    wellnessRow = { prefs: {}, drill_results: [result({ score: 20 })] }
    rpcData = [result({ score: 20 }), result({ score: 50 })]
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('New best')
    expect(mocks.play).toHaveBeenCalledWith('drill.hit')
    expect(mocks.play).toHaveBeenCalledWith('best')
  })

  it('never plays best on a first run of a kind, even with a perfect score', async () => {
    wellnessRow = { prefs: {}, drill_results: [] } // no prior run of this kind at all
    renderPage()
    fireEvent.click(await screen.findByText('Complete follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    await screen.findByText('Run complete')
    expect(mocks.play).toHaveBeenCalledWith('drill.hit')
    expect(mocks.play).not.toHaveBeenCalledWith('best')
  })

  it('quitting mid-game (onAbort) navigates back to de-rot without submitting a run', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Abort follow-the-dot', {}, COUNTDOWN_TIMEOUT))
    expect(mocks.push).toHaveBeenCalledWith('/derot')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  // Expected raw labels match this file's own stub payloads run through the route's real
  // scoreForGame/timeMsForGame/rawLabelFor dispatch: color-nback and memory-grid read their
  // primitive out of `payload` (hits/falseAlarms/plantedMatches, roundsCleared) rather than
  // `raw`, exactly like the real ColorBack.tsx / MemoryGrid.tsx components do.
  const gameCases: [string, number, string, number][] = [
    ['color-nback', 90, '5 net hits', 63], // normalizeColorNBack(6, 1, 8): net 5 of 8 planted; timeMs reads the payload's net, not the game's already-scaled raw (A-I1)
    ['reaction', 60, '842 ms mean reaction', 92], // normalizeReaction(842)
    ['rhythm', 60, '150 ms mean offset from the beat', 70], // normalizeRhythm(150)
    ['breathe', 90, '100% of the pacer completed', 100], // normalizeBreathe(100)
    ['memory-grid', 90, '3 rounds cleared', 25], // normalizeMemoryGrid(3)
  ]

  it.each(gameCases)('mounts %s with timeLimitS %d and produces a lane-play DrillResult with score in [0,100]', async (game, timeLimitS, rawLabel, expectedScore) => {
    mocks.params.mockReturnValue({ game })
    rpcData = [result({ drillId: `play-${game}`, kind: game as DrillResult['kind'] })]
    renderPage()
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
