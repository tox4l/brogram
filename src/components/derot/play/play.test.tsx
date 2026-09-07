import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayGameResult } from './types'
import FollowTheDot, { dotPathPosition } from './FollowTheDot'
import Twitch, { randomWaitMs } from './Twitch'
import KeepTime, { beatProgressAt, buildBeatSchedule, nearestBeatOffsetMs } from './KeepTime'

const mocks = vi.hoisted(() => ({ play: vi.fn() }))
vi.mock('@/lib/sound/manager', () => ({ play: mocks.play, withInterfaceSounds: (run: () => void) => run() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  mocks.play.mockClear()
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
})
