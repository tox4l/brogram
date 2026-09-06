import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  play: vi.fn(() => 1),
  volume: vi.fn(),
  stop: vi.fn(),
  mute: vi.fn(),
}))

vi.mock('howler', () => ({
  Howl: vi.fn(function Howl() {
    return { play: mocks.play, volume: mocks.volume, stop: mocks.stop }
  }),
  Howler: { mute: mocks.mute },
}))

const SPRITE = {
  src: ['/sounds/brogram.webm', '/sounds/brogram.mp3'],
  sprite: {
    'ui.tap': [0, 60],
    'run.go': [100, 90],
    'submit.send': [200, 160],
    pass: [400, 240],
    fail: [700, 200],
    'chain.tick': [950, 90],
    'first.win': [1100, 900],
    'level.up': [2100, 750],
    hint: [3000, 150],
    'drill.hit': [3200, 90],
    'drill.miss': [3350, 100],
    'xp.settle': [3500, 70],
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
  mocks.mute.mockClear()
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

  it('is silent for an interface-tier id by default and audible inside withInterfaceSounds (xp.settle, R7.8)', async () => {
    const { initSoundOnFirstGesture, play, withInterfaceSounds } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.play.mockClear()

    play('xp.settle')
    expect(mocks.play).not.toHaveBeenCalled()

    withInterfaceSounds(() => play('drill.hit'))
    expect(mocks.play).toHaveBeenCalledWith('drill.hit')

    mocks.play.mockClear()
    play('drill.hit')
    expect(mocks.play).not.toHaveBeenCalled()
  })

  it('plays hint by default — it is reward-tier, not interface-tier (fix-round C1)', async () => {
    const { initSoundOnFirstGesture, play } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.play.mockClear()

    play('hint')

    expect(mocks.play).toHaveBeenCalledWith('hint')
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
    // `mockImplementationOnce` rather than `mockImplementation`: this mock is
    // shared across the whole file, and a permanent override here would
    // silently break every assertion on `mocks.volume`/`mocks.play` in every
    // test that runs after this one.
    mocks.play.mockImplementationOnce(() => { throw new Error('unknown sprite key') })

    expect(() => play('pass')).not.toThrow()
  })

  // --- I1: setEnabled calls Howler.mute, so an already-sounding cue actually stops ---

  it('setEnabled(false) calls Howler.mute(true); setEnabled(true) calls Howler.mute(false) (I1)', async () => {
    const { initSoundOnFirstGesture, setEnabled } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.mute.mockClear()

    setEnabled(false)
    expect(mocks.mute).toHaveBeenLastCalledWith(true)

    setEnabled(true)
    expect(mocks.mute).toHaveBeenLastCalledWith(false)
  })

  it('a mute set before the sprite loads still holds once it does (I1)', async () => {
    const { initSoundOnFirstGesture, setEnabled } = await loadModule()
    setEnabled(false)
    initSoundOnFirstGesture()
    await fireGestureAndLoad()

    expect(mocks.mute).toHaveBeenCalledWith(true)
  })

  // --- I2: default volume is 0.6 (DEFAULT_WELLNESS.sound.volume), not 1 ---

  it('defaults to volume 0.6 with no setVolume call (I2)', async () => {
    const { initSoundOnFirstGesture, play } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.volume.mockClear()

    play('pass')

    expect(mocks.volume).toHaveBeenCalledWith(0.6, expect.any(Number))
  })

  // --- I3: bounded retry with backoff, and a capped pending queue ---

  it('retries the sprite load on each subsequent gesture, up to 3 attempts total, then stops', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const { initSoundOnFirstGesture } = await loadModule()

    initSoundOnFirstGesture()
    await fireGestureAndLoad() // attempt 1, fails, re-arms
    await fireGestureAndLoad() // attempt 2, fails, re-arms
    await fireGestureAndLoad() // attempt 3, fails, permanently gives up
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // A 4th gesture must not trigger a 4th attempt — nothing is listening anymore.
    await fireGestureAndLoad()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('recovers once a later attempt succeeds, after earlier attempts failed (I3)', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => SPRITE })
    vi.stubGlobal('fetch', fetchMock)
    const { initSoundOnFirstGesture, play } = await loadModule()

    initSoundOnFirstGesture()
    await fireGestureAndLoad() // attempt 1, fails
    play('pass') // queues — still not loaded
    await fireGestureAndLoad() // attempt 2, fails
    await fireGestureAndLoad() // attempt 3, succeeds and flushes

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(mocks.play).toHaveBeenCalledWith('pass')
  })

  it('caps the pending queue at 3, keeping the highest-ranked entries and dropping the rest silently (I3)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { initSoundOnFirstGesture, play, setInterfaceEnabled } = await loadModule()
    setInterfaceEnabled(true)
    initSoundOnFirstGesture()
    await fireGestureAndLoad() // attempt 1 fails; still no state.howl, so every play() below queues

    // Interface-tier ids, so each flushes independently rather than being
    // collapsed to one reward winner — this isolates the queue-cap logic.
    play('submit.send') // rank 0
    play('ui.tap') // rank 0
    play('run.go') // rank 0
    play('drill.hit') // rank 10 — must evict a rank-0 entry to fit
    play('drill.miss') // rank 10 — must evict the remaining rank-0 entry it can beat

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SPRITE }))
    await fireGestureAndLoad() // attempt 2 succeeds and flushes whatever survived the cap

    expect(mocks.play).toHaveBeenCalledTimes(3)
    const played = mocks.play.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(played).toEqual(['drill.hit', 'drill.miss', 'run.go'])
    expect(played).not.toContain('submit.send')
    expect(played).not.toContain('ui.tap')
  })

  // --- I4: flushing a batch of queued rewards still respects the rank debounce ---

  it('flushing two queued reward cues plays only the higher-ranked one, not both (I4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { initSoundOnFirstGesture, play } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad() // fails; queues from here on

    play('pass') // rank 70
    play('first.win') // rank 100 — the two must not both start once flushed

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SPRITE }))
    await fireGestureAndLoad() // succeeds and flushes

    expect(mocks.play).toHaveBeenCalledTimes(1)
    expect(mocks.play).toHaveBeenCalledWith('first.win')
  })

  it('drops a queued entry older than 1s by flush time rather than playing it late (I4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { initSoundOnFirstGesture, play } = await loadModule()
    initSoundOnFirstGesture()
    await fireGestureAndLoad() // fails; queues from here on

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(0)
    play('pass')
    now.mockReturnValue(5_000) // 5s later, well past the 1s staleness cutoff
    now.mockRestore()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SPRITE }))
    await fireGestureAndLoad()

    expect(mocks.play).not.toHaveBeenCalled()
  })

  // --- I5: a per-call volume scale, applied without mutating the global volume ---

  it('play(id, { volumeScale }) scales this call only, without mutating the global volume (I5)', async () => {
    const { initSoundOnFirstGesture, play, setVolume } = await loadModule()
    setVolume(1)
    initSoundOnFirstGesture()
    await fireGestureAndLoad()
    mocks.volume.mockClear()

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    play('pass', { volumeScale: 0.7 }) // spec §7.6: walkthrough-finished pass, at 70%
    expect(mocks.volume).toHaveBeenLastCalledWith(0.7, expect.any(Number))

    // Same id, well outside the 250ms rank-debounce window and still inside
    // the 60s repeat window at only its 2nd occurrence (no attenuation yet):
    // unscaled, so it must reflect the untouched global volume (1), not the
    // previous call's 0.7 scale factor lingering as mutated state.
    now.mockReturnValue(2_000)
    play('pass')
    expect(mocks.volume).toHaveBeenLastCalledWith(1, expect.any(Number))
  })

  // --- I7: the Howler chunk is warmed at idle, before any gesture ---

  it('warms the howler import at idle via requestIdleCallback when it is available (I7)', async () => {
    const ric = vi.fn((callback: () => void) => { callback(); return 0 })
    const win = window as unknown as { requestIdleCallback?: typeof ric }
    win.requestIdleCallback = ric
    try {
      await loadModule()
      expect(ric).toHaveBeenCalledTimes(1)
    } finally {
      delete win.requestIdleCallback
    }
  })

  it('falls back to setTimeout for the idle warm-up when requestIdleCallback is unavailable (I7)', async () => {
    const win = window as unknown as { requestIdleCallback?: (callback: () => void) => number }
    const original = win.requestIdleCallback
    delete win.requestIdleCallback
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    try {
      await loadModule()
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1)
    } finally {
      setTimeoutSpy.mockRestore()
      if (original) win.requestIdleCallback = original
    }
  })
})
