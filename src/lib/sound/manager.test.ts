import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  play: vi.fn(() => 1),
  volume: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('howler', () => ({
  Howl: vi.fn(function Howl() {
    return { play: mocks.play, volume: mocks.volume, stop: mocks.stop }
  }),
  Howler: { mute: vi.fn() },
}))

const SPRITE = {
  src: ['/sounds/brogram.webm', '/sounds/brogram.mp3'],
  sprite: {
    'ui.tap': [0, 60],
    'run.go': [100, 90],
    pass: [300, 240],
    fail: [600, 200],
    'chain.tick': [900, 90],
    'first.win': [1100, 900],
    'level.up': [2100, 750],
    hint: [3000, 150],
    'drill.hit': [3200, 90],
  },
}

async function loadModule() {
  vi.resetModules()
  return import('./manager')
}

/** Fires the bound gesture listener and waits for the async load to settle. */
async function fireGestureAndLoad() {
  window.dispatchEvent(new Event('pointerdown'))
  // A macrotask flushes every pending microtask first, however many hops the
  // dynamic import + fetch + json() + Promise.all chain needs to settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  mocks.play.mockClear()
  mocks.volume.mockClear()
  mocks.stop.mockClear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SPRITE }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sound manager', () => {
  it('queues play() calls made before load and flushes them once the sprite loads', async () => {
    const { initSoundOnFirstGesture, play } = await loadModule()
    play('pass')
    expect(mocks.play).not.toHaveBeenCalled()

    initSoundOnFirstGesture()
    await fireGestureAndLoad()

    expect(mocks.play).toHaveBeenCalledWith('pass')
  })

  it('removes its gesture listener after the first pointerdown/keydown so it only ever binds once', async () => {
    const { initSoundOnFirstGesture } = await loadModule()
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    initSoundOnFirstGesture()
    await fireGestureAndLoad()

    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('never throws when the sprite fetch rejects, and play() stays a silent no-op', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { initSoundOnFirstGesture, play } = await loadModule()

    initSoundOnFirstGesture()
    expect(() => window.dispatchEvent(new Event('pointerdown'))).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(() => play('pass')).not.toThrow()
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('plays only the higher-ranked reward sound inside a 250ms window', async () => {
    const { initSoundOnFirstGesture, play } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.play.mockClear()

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    play('pass') // rank 70
    now.mockReturnValue(1_100) // +100ms, inside the 250ms window
    play('fail') // rank 20 — lower, must be suppressed

    expect(mocks.play).toHaveBeenCalledTimes(1)
    expect(mocks.play).toHaveBeenCalledWith('pass')
  })

  it('starts a fresh rank-debounce window once 250ms has passed', async () => {
    const { initSoundOnFirstGesture, play } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.play.mockClear()

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(2_000)
    play('pass')
    now.mockReturnValue(2_300) // +300ms, outside the window
    play('fail')

    expect(mocks.play).toHaveBeenCalledTimes(2)
    expect(mocks.play).toHaveBeenNthCalledWith(1, 'pass')
    expect(mocks.play).toHaveBeenNthCalledWith(2, 'fail')
  })

  it('attenuates the fifth play of one id inside 60s by 6dB', async () => {
    const { initSoundOnFirstGesture, play, setVolume } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    setVolume(1)
    mocks.volume.mockClear()

    const now = vi.spyOn(Date, 'now')
    // 300ms apart: outside the 250ms rank-debounce window, inside the 60s repeat window.
    for (let i = 0; i < 5; i++) {
      now.mockReturnValue(1_000 + i * 300)
      play('pass')
    }

    expect(mocks.volume).toHaveBeenCalledTimes(5)
    const volumes = mocks.volume.mock.calls.map((call) => call[0] as number)
    expect(volumes.slice(0, 4)).toEqual([1, 1, 1, 1])
    expect(volumes[4]).toBeLessThan(1)
    expect(volumes[4]).toBeCloseTo(10 ** (-6 / 20), 3)
  })

  it('is silent for an interface-tier id by default and audible inside withInterfaceSounds', async () => {
    const { initSoundOnFirstGesture, play, withInterfaceSounds } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.play.mockClear()

    play('hint')
    expect(mocks.play).not.toHaveBeenCalled()

    withInterfaceSounds(() => play('drill.hit'))
    expect(mocks.play).toHaveBeenCalledWith('drill.hit')

    mocks.play.mockClear()
    play('drill.hit')
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('plays an interface-tier id once setInterfaceEnabled(true) is on, without a scope', async () => {
    const { initSoundOnFirstGesture, play, setInterfaceEnabled } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.play.mockClear()

    setInterfaceEnabled(true)
    play('ui.tap')

    expect(mocks.play).toHaveBeenCalledWith('ui.tap')
  })

  it('setEnabled(false) silences both a reward-tier and an interface-tier id', async () => {
    const { initSoundOnFirstGesture, play, setEnabled, setInterfaceEnabled } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    setInterfaceEnabled(true)
    mocks.play.mockClear()

    setEnabled(false)
    play('pass')
    play('ui.tap')

    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('play() never throws for an id with no matching sprite entry', async () => {
    const { initSoundOnFirstGesture, play } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.play.mockImplementation(() => { throw new Error('unknown sprite key') })

    expect(() => play('pass')).not.toThrow()
  })
})
