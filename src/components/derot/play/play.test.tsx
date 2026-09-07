import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayGameResult } from './types'
import FollowTheDot, { dotPathPosition } from './FollowTheDot'
import Twitch, { randomWaitMs } from './Twitch'
import KeepTime, { beatProgressAt, buildBeatSchedule, nearestBeatOffsetMs } from './KeepTime'

/** Fix round 1: toggles the same property every game's `useHiddenTab()` reads, dispatching the event those hooks listen for. Always restore to visible so later tests never inherit a hidden document. */
function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

const mocks = vi.hoisted(() => ({ play: vi.fn() }))
vi.mock('@/lib/sound/manager', () => ({ play: mocks.play, withInterfaceSounds: (run: () => void) => run() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  mocks.play.mockClear()
  // A test that throws before its own cleanup line would otherwise leave `document.hidden`
  // permanently overridden (Object.defineProperty on the instance shadows the prototype getter
  // for every later test in this file, not just the one that set it) -- always visible by default.
  setDocumentHidden(false)
})

/** A controllable requestAnimationFrame double: frames only advance when `flush` is called, never on their own, so a game's rAF loop is fully deterministic under test. */
function stubRaf() {
  let queue: FrameRequestCallback[] = []
  let nextId = 1
  const raf = vi.fn((cb: FrameRequestCallback) => {
    queue.push(cb)
    return nextId++
  })
  const caf = vi.fn()
  vi.stubGlobal('requestAnimationFrame', raf as unknown as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', caf as unknown as typeof cancelAnimationFrame)
  return {
    raf,
    caf,
    flush(time: number) {
      const current = queue
      queue = []
      current.forEach((cb) => cb(time))
    },
  }
}

function noop() {}

describe('FollowTheDot', () => {
  it('the dot path is a pure, deterministic function of elapsed time and area size', () => {
    const a = dotPathPosition(0, 320, 320)
    const b = dotPathPosition(0, 320, 320)
    expect(a).toEqual(b)
    // At the origin of the drift, the dot sits inside the play area, never at a corner.
    expect(a.x).toBeGreaterThan(0)
    expect(a.x).toBeLessThan(320)
    expect(a.y).toBeGreaterThan(0)
    expect(a.y).toBeLessThan(320)
  })

  it('keeping the pointer glued to the dot every frame completes with raw 1 and a consistent frame count', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const rafStub = stubRaf()
    const onComplete = vi.fn<(result: PlayGameResult) => void>()
    render(<FollowTheDot timeLimitS={1} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)

    const area = screen.getByTestId('follow-the-dot-area')
    const FRAME_COUNT = 6
    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = i * 16
      const dot = dotPathPosition(t / 1000, 320, 320)
      fireEvent.pointerMove(area, { clientX: dot.x, clientY: dot.y })
      act(() => rafStub.flush(t))
    }

    act(() => { vi.advanceTimersByTime(1000) })

    expect(onComplete).toHaveBeenCalledTimes(1)
    const result = onComplete.mock.calls[0][0]
    expect(result.raw).toBeCloseTo(1, 5)
    expect(result.payload.framesTotal).toBe(FRAME_COUNT)
    expect(result.payload.framesInside).toBe(FRAME_COUNT)
  })

  it('never counts a frame where the pointer never caught up to the dot', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const rafStub = stubRaf()
    const onComplete = vi.fn<(result: PlayGameResult) => void>()
    render(<FollowTheDot timeLimitS={1} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)

    const area = screen.getByTestId('follow-the-dot-area')
    // Parked far outside the play area for every frame -- never inside, regardless of where the dot drifts.
    fireEvent.pointerMove(area, { clientX: -500, clientY: -500 })
    for (let i = 0; i < 4; i++) act(() => rafStub.flush(i * 16))

    act(() => { vi.advanceTimersByTime(1000) })

    const result = onComplete.mock.calls[0][0]
    expect(result.raw).toBe(0)
    expect(result.payload.framesInside).toBe(0)
  })

  it('keyboard arrow keys drive the virtual pointer without crashing, and cancel the frame loop on unmount', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const rafStub = stubRaf()
    const { unmount } = render(<FollowTheDot timeLimitS={10} soundOn={false} reducedMotion={false} onComplete={noop} onAbort={noop} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    act(() => rafStub.flush(16))
    act(() => rafStub.flush(32))
    fireEvent.keyUp(window, { key: 'ArrowRight' })

    expect(screen.getByTestId('follow-the-dot-pointer')).toBeTruthy()
    unmount()
    expect(rafStub.caf).toHaveBeenCalled()
  })

  it('under resolved reduced motion, shows the substitute card instead of the game and never starts the frame loop', () => {
    const rafStub = stubRaf()
    const onComplete = vi.fn()
    render(<FollowTheDot timeLimitS={75} soundOn={false} reducedMotion onComplete={onComplete} onAbort={noop} />)

    expect(screen.queryByTestId('follow-the-dot-area')).toBeNull()
    expect(rafStub.raf).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /Grid/ })).toHaveProperty('href', expect.stringContaining('/derot/play/memory-grid'))
    expect(screen.getByRole('link', { name: /Twitch/ })).toHaveProperty('href', expect.stringContaining('/derot/play/reaction'))
    expect(onComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Play anyway' }))
    expect(screen.getByTestId('follow-the-dot-area')).toBeTruthy()
  })
})

describe('Twitch', () => {
  it('randomWaitMs stays within the documented wait window and is deterministic given an injected source', () => {
    expect(randomWaitMs(() => 0)).toBe(700)
    expect(randomWaitMs(() => 1)).toBe(2200)
  })

  it('completes ten rounds and reports the mean reaction time as raw, with all ten reactions in the payload', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0) // pins every round's wait to 700ms (randomWaitMs's floor)
    const onComplete = vi.fn<(result: PlayGameResult) => void>()
    render(<Twitch timeLimitS={60} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)

    for (let round = 0; round < 10; round++) {
      act(() => { vi.advanceTimersByTime(700) }) // the shape lights
      act(() => { vi.advanceTimersByTime(150) }) // a steady, simulated 150ms reaction
      fireEvent.click(screen.getByTestId('twitch-target'))
      act(() => { vi.advanceTimersByTime(250) }) // the resolve pause before the next round
    }

    expect(onComplete).toHaveBeenCalledTimes(1)
    const result = onComplete.mock.calls[0][0]
    expect(result.raw).toBeCloseTo(150, 0)
    expect(result.payload.reactions).toHaveLength(10)
  })

  it('an early tap (during the wait) voids the round instead of registering a reaction', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<Twitch timeLimitS={60} soundOn={false} reducedMotion={false} onComplete={noop} onAbort={noop} />)

    expect(screen.getByText('Round 1 of 10')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(300) }) // still waiting -- the light has not come on yet
    fireEvent.click(screen.getByTestId('twitch-target'))
    expect(screen.getByText('Too soon')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(400) }) // the resolve pause before the next round
    expect(screen.getByText('Round 2 of 10')).toBeTruthy()
  })

  it('the space bar doubles as the tap, and Quit calls onAbort', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onAbort = vi.fn()
    render(<Twitch timeLimitS={60} soundOn={false} reducedMotion={false} onComplete={noop} onAbort={onAbort} />)

    act(() => { vi.advanceTimersByTime(700) })
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText('Got it')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('plays a tone when the shape lights and a hit/miss cue on tap, only when soundOn is true', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<Twitch timeLimitS={60} soundOn reducedMotion={false} onComplete={noop} onAbort={noop} />)

    act(() => { vi.advanceTimersByTime(700) })
    expect(mocks.play).toHaveBeenCalledWith('ui.tap', expect.any(Object))
    fireEvent.click(screen.getByTestId('twitch-target'))
    expect(mocks.play).toHaveBeenCalledWith('drill.hit', expect.any(Object))
  })

  // Fix round 1 (A-C1): every setState call is a plain value now, never an updater function that
  // pushes into a ref or fires the run's single submit from inside it -- so a StrictMode
  // dev double-invoke of an effect (which this route's real mount goes through twice over, via
  // `<Suspense>` and `next/dynamic`) must produce the exact same ten reactions and one submit as
  // a normal mount, not a corrupted eleven-entry array or a skipped round.
  it('under StrictMode, ten rounds still produce exactly ten reactions and exactly one submit', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onComplete = vi.fn<(result: PlayGameResult) => void>()
    render(
      <StrictMode>
        <Twitch timeLimitS={60} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />
      </StrictMode>
    )

    for (let round = 0; round < 10; round++) {
      act(() => { vi.advanceTimersByTime(700) })
      act(() => { vi.advanceTimersByTime(150) })
      fireEvent.click(screen.getByTestId('twitch-target'))
      act(() => { vi.advanceTimersByTime(250) })
    }

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].payload.reactions).toHaveLength(10)
  })

  // Fix round 1 (A-I2/A-I3): a hidden tab used to keep lighting and expiring rounds unseen (one
  // real probe recorded round 1 -> 4 after twelve seconds hidden, each expiry a full void
  // penalty). Now the per-round effect schedules nothing at all while hidden, and the overall
  // countdown's `active` flag is gated the same way, so neither can silently advance or expire.
  it('pauses the current round while the tab is hidden and restarts it fresh on return', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const onComplete = vi.fn()
    render(<Twitch timeLimitS={60} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)
    expect(screen.getByText('Round 1 of 10')).toBeTruthy()

    // Committed in its own `act()`, separately from the timer advance below: the per-round
    // effect's cleanup (clearing round 1's already-scheduled wait timer) only runs once React
    // actually re-renders on the `hidden` change, and a single `vi.advanceTimersByTime` call
    // fires every due timer synchronously, before React gets a chance to commit an update that
    // was merely queued (not yet flushed) going into it.
    act(() => { setDocumentHidden(true) })
    // Long enough that, unpaused, several rounds would have lit and expired unseen.
    act(() => { vi.advanceTimersByTime(12000) })
    expect(screen.getByText('Round 1 of 10')).toBeTruthy()
    expect(screen.queryByText('Tap now')).toBeNull()
    expect(onComplete).not.toHaveBeenCalled()

    act(() => { setDocumentHidden(false) })
    act(() => { vi.advanceTimersByTime(700) }) // the restarted round's own fresh wait
    expect(screen.getByText('Tap now')).toBeTruthy()
  })

  it('reducedMotion drops the colour cross-fade and passes through to the countdown ring', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<Twitch timeLimitS={60} soundOn={false} reducedMotion onComplete={noop} onAbort={noop} />)

    expect(screen.getByTestId('twitch-target').className).not.toContain('transition-colors')
    // CountdownRing.tsx swaps its animated SVG arc for a plain numeral under reduced motion.
    expect(screen.getByRole('timer').querySelector('svg')).toBeNull()
  })

  it('reducedMotion=false keeps the colour cross-fade and the animated countdown ring', () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<Twitch timeLimitS={60} soundOn={false} reducedMotion={false} onComplete={noop} onAbort={noop} />)

    expect(screen.getByTestId('twitch-target').className).toContain('transition-colors')
    expect(screen.getByRole('timer').querySelector('svg')).toBeTruthy()
  })
})

describe('KeepTime pure helpers', () => {
  it('buildBeatSchedule starts at zero, stays sorted, and stops once past the duration', () => {
    const beats = buildBeatSchedule(3000, 750, 0, 8) // no drift: an even 750ms metronome
    expect(beats[0]).toBe(0)
    for (let i = 1; i < beats.length; i++) expect(beats[i]).toBeGreaterThan(beats[i - 1])
    expect(beats[beats.length - 1]).toBeGreaterThanOrEqual(3000)
    expect(beats).toEqual([0, 750, 1500, 2250, 3000])
  })

  it('drifting tempo still floors every interval at 200ms, so the beat never bunches up', () => {
    const beats = buildBeatSchedule(6000)
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(200)
  })

  it('nearestBeatOffsetMs finds the closest scheduled beat, before or after', () => {
    const beats = [0, 700, 1400, 2100]
    expect(nearestBeatOffsetMs(700, beats)).toBe(0)
    expect(nearestBeatOffsetMs(650, beats)).toBe(50)
    expect(nearestBeatOffsetMs(760, beats)).toBe(60)
  })

  it('beatProgressAt is 0 right at a beat and approaches 1 just before the next one', () => {
    const beats = [0, 1000, 2000]
    expect(beatProgressAt(0, beats).progress).toBe(0)
    expect(beatProgressAt(0, beats).index).toBe(0)
    expect(beatProgressAt(999, beats).progress).toBeCloseTo(0.999, 3)
    expect(beatProgressAt(1000, beats).index).toBe(1)
  })
})

describe('KeepTime component', () => {
  it('renders the visual pulse, marker and track even with sound disabled, and never calls play', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const rafStub = stubRaf()
    render(<KeepTime timeLimitS={5} soundOn={false} reducedMotion={false} onComplete={noop} onAbort={noop} />)

    expect(screen.getByTestId('rhythm-pulse')).toBeTruthy()
    expect(screen.getByTestId('rhythm-marker')).toBeTruthy()
    expect(screen.getByTestId('rhythm-track')).toBeTruthy()

    for (let i = 0; i < 10; i++) act(() => rafStub.flush(i * 100))
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('a tap made exactly on a beat scores a near-zero mean offset', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const rafStub = stubRaf()
    const onComplete = vi.fn<(result: PlayGameResult) => void>()
    render(<KeepTime timeLimitS={1} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)

    act(() => rafStub.flush(0))
    act(() => rafStub.flush(750)) // the schedule's first real beat at the default 750ms base interval
    fireEvent.click(screen.getByTestId('rhythm-tap'))

    act(() => { vi.advanceTimersByTime(1000) })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].raw).toBeLessThan(50)
  })

  it('completing the run with zero taps scores the tolerance ceiling, never blocking completion', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const onComplete = vi.fn<(result: PlayGameResult) => void>()
    render(<KeepTime timeLimitS={1} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].raw).toBe(500)
  })

  it('Quit calls onAbort', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    stubRaf()
    const onAbort = vi.fn()
    render(<KeepTime timeLimitS={60} soundOn={false} reducedMotion={false} onComplete={noop} onAbort={onAbort} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  // Fix round 1 (A-I4): the pulse and marker used to tween on every single frame regardless of
  // `reducedMotion` -- and rule 1's substitute card offers this exact game as the reduced-motion
  // alternative to Follow the Dot. Under reduced motion the DOM is only ever touched once a beat
  // boundary is actually crossed, a discrete snap, never a per-frame interpolation.
  it('reducedMotion snaps the pulse and marker once per beat instead of tweening every frame', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const rafStub = stubRaf()
    render(<KeepTime timeLimitS={5} soundOn={false} reducedMotion onComplete={noop} onAbort={noop} />)
    const pulse = screen.getByTestId('rhythm-pulse') as HTMLElement
    const marker = screen.getByTestId('rhythm-marker') as HTMLElement

    // Beat 0 itself is a boundary crossing (the sentinel "no beat yet" -> index 0), so the very
    // first frame already produces one discrete snap -- that is the correct, intended behaviour,
    // not a per-frame tween, so this test pins the state *after* it rather than assuming untouched.
    act(() => rafStub.flush(0))
    const afterBeat0Marker = marker.style.transform
    const afterBeat0Opacity = pulse.style.opacity

    act(() => rafStub.flush(300)) // still inside beat 0's window (the 750ms base interval) -- no boundary crossed
    expect(marker.style.transform).toBe(afterBeat0Marker) // untouched since beat 0: no per-frame write under reduced motion
    expect(pulse.style.opacity).toBe(afterBeat0Opacity)

    act(() => rafStub.flush(760)) // crosses into beat 1 -- exactly one further discrete snap
    expect(marker.style.transform).not.toBe(afterBeat0Marker)
    expect(pulse.style.opacity).not.toBe(afterBeat0Opacity)
  })

  it('passes reducedMotion through to the countdown ring', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    stubRaf()
    render(<KeepTime timeLimitS={60} soundOn={false} reducedMotion onComplete={noop} onAbort={noop} />)
    // CountdownRing.tsx swaps its animated SVG arc for a plain numeral under reduced motion.
    expect(screen.getByRole('timer').querySelector('svg')).toBeNull()
  })
})
