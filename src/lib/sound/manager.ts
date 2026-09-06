'use client'

/**
 * The two-tier sound manager (R7.3, R7.8). A module singleton, never a React
 * hook or context, so any call site — a plain event handler, a GSAP
 * `onComplete`, a non-component utility — can call `play()` without needing
 * to be inside a component tree. Howler and the sprite JSON are dynamic
 * imports, so neither sits on any route's initial chunk; the Howler *chunk*
 * is warmed at idle (I7 below) but the sprite fetch and the `Howl` itself
 * are still gated to the user's first real gesture, so no `AudioContext` is
 * created and no network request fires before then.
 *
 * Everything a call site must never have to think about lives here:
 *  - rank debounce: no two reward sounds overlap inside a 250ms window,
 *    including across a batch that was queued before load and flushed
 *    together (I4);
 *  - repetition attenuation: a hot id quiets down after 4 repeats in 60s;
 *  - the tier gate (interface sounds are opt-in, or scoped via `withInterfaceSounds`);
 *  - the master gate — `setEnabled(false)` both gates future `play()` calls
 *    and calls `Howler.mute(true)` so a cue already sounding stops immediately (I1);
 *  - a bounded, small pending queue and a bounded retry count, so a single
 *    transient load failure can never turn into "sound is silently dead for
 *    the rest of the session with an unboundedly growing queue" (I3).
 */

import { DEFAULT_WELLNESS, type WellnessPrefs } from '@/lib/contracts'
import type { SoundEventId } from './events'
import { INTERFACE_TIER, RANK, REWARD_TIER } from './tiers'

const SPRITE_URL = '/sounds/brogram.json'
const RANK_DEBOUNCE_MS = 250
const REPEAT_WINDOW_MS = 60_000
/** The 5th play of one id inside the window (4 prior + this one) gets attenuated. */
const REPEAT_THRESHOLD = 4
const ATTENUATION_DB = 6
const ATTENUATION_FACTOR = 10 ** (-ATTENUATION_DB / 20)
/** I3: at most this many attempts total (first gesture + retries on later gestures). */
const MAX_LOAD_ATTEMPTS = 3
/** I3: the pending queue never holds more than this many entries. */
const MAX_PENDING = 3
/** I4: a queued entry older than this by flush time is stale, not "now" — dropped. */
const STALE_PENDING_MS = 1000

const REWARD_SET = new Set<SoundEventId>(REWARD_TIER)
const INTERFACE_SET = new Set<SoundEventId>(INTERFACE_TIER)

interface HowlLike {
  play(sprite: string): number
  volume(vol: number, id?: number): void
  stop(id?: number): void
}

/** The bits of the `Howler` global singleton (not the `Howl` instance) this manager needs. */
interface HowlerGlobalLike {
  mute(muted: boolean): void
}

interface SpriteManifest {
  src: string[]
  sprite: Record<string, [number, number] | [number, number, boolean]>
}

interface QueuedPlay {
  id: SoundEventId
  volumeFactor: number
  at: number
}

interface RewardWindow {
  at: number
  rank: number
  id: SoundEventId
}

const state = {
  howl: null as HowlLike | null,
  howlerGlobal: null as HowlerGlobalLike | null,
  gestureBound: false,
  loadAttempts: 0,
  loadFailed: false,
  enabled: true,
  interfaceEnabled: false,
  interfaceScopeDepth: 0,
  volume: DEFAULT_WELLNESS.sound.volume,
  pending: [] as QueuedPlay[],
  rewardWindow: null as RewardWindow | null,
  history: new Map<SoundEventId, number[]>(),
  activeIds: new Map<SoundEventId, number>(),
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function isTierAllowed(id: SoundEventId): boolean {
  if (INTERFACE_SET.has(id)) return state.interfaceEnabled || state.interfaceScopeDepth > 0
  return true
}

/** R7.3. Mutates `state.rewardWindow` as a side effect of the decision. */
function passesRankDebounce(id: SoundEventId, at: number): boolean {
  if (!REWARD_SET.has(id)) return true
  const rank = RANK[id]
  const win = state.rewardWindow
  if (win && at - win.at < RANK_DEBOUNCE_MS) {
    if (rank <= win.rank) return false
    // A bigger reward arrived mid-window: cut off whatever was sounding for the one it beats.
    const activeId = state.activeIds.get(win.id)
    if (state.howl && activeId !== undefined) {
      try { state.howl.stop(activeId) } catch { /* best-effort cutoff */ }
    }
    state.rewardWindow = { at, rank, id }
    return true
  }
  state.rewardWindow = { at, rank, id }
  return true
}

/** R7.8. Returns the volume multiplier for this play, recording the occurrence. */
function attenuationFor(id: SoundEventId, at: number): number {
  const recent = (state.history.get(id) ?? []).filter((t) => at - t < REPEAT_WINDOW_MS)
  recent.push(at)
  state.history.set(id, recent)
  return recent.length > REPEAT_THRESHOLD ? ATTENUATION_FACTOR : 1
}

function playNow(id: SoundEventId, volumeFactor: number): void {
  const howl = state.howl
  if (!howl) return
  try {
    const soundId = howl.play(id)
    howl.volume(state.volume * volumeFactor, soundId)
    if (REWARD_SET.has(id)) state.activeIds.set(id, soundId)
  } catch {
    // A bad sprite key or a Howler internal error must never crash a call site.
  }
}

/** I3: cap the pending queue at MAX_PENDING, keeping the highest-ranked entries — a
 *  burst that arrives before load has finished must not grow without bound, and what
 *  it does keep should be the moments that matter most, not just the earliest ones. */
function enqueue(entry: QueuedPlay): void {
  if (state.pending.length < MAX_PENDING) {
    state.pending.push(entry)
    return
  }
  let weakestIndex = 0
  let weakestRank = RANK[state.pending[0].id]
  for (let i = 1; i < state.pending.length; i++) {
    const rank = RANK[state.pending[i].id]
    if (rank < weakestRank) {
      weakestRank = rank
      weakestIndex = i
    }
  }
  if (RANK[entry.id] > weakestRank) state.pending[weakestIndex] = entry
  // Otherwise: silently dropped. The queue already holds entries at least as important.
}

/**
 * I4: flush through the same debounce/priority decision live calls use,
 * rather than around it. The debounce decision at queue time was made
 * against whatever `Date.now()` was when each entry was *pushed*, which can
 * be seconds apart from when the sprite actually finishes loading — flushing
 * every entry with a bare loop would let two rewards that each independently
 * passed the check start at the exact same instant, which is precisely the
 * overlap R7.3 makes this manager responsible for preventing. So: drop
 * anything stale, then treat everything left as arriving "now" and run it
 * through one shared decision — only the single highest-ranked reward
 * survives; interface-tier entries never participate in the debounce and
 * flush as-is.
 */
function flushPending(): void {
  const queued = state.pending.splice(0)
  const now = Date.now()
  const fresh = queued.filter((entry) => now - entry.at < STALE_PENDING_MS)
  const rewards: QueuedPlay[] = []
  for (const entry of fresh) {
    if (REWARD_SET.has(entry.id)) rewards.push(entry)
    else playNow(entry.id, entry.volumeFactor)
  }
  if (rewards.length === 0) return
  const winner = rewards.reduce((best, entry) => (RANK[entry.id] > RANK[best.id] ? entry : best))
  state.rewardWindow = { at: now, rank: RANK[winner.id], id: winner.id }
  playNow(winner.id, winner.volumeFactor)
}

/** Re-armable in isolation from `initSoundOnFirstGesture`'s own idempotency guard,
 *  so a failed load can retry on the learner's *next* gesture (I3) without needing
 *  the app shell to call `initSoundOnFirstGesture()` a second time. */
function bindGestureListener(): void {
  const handler = () => {
    window.removeEventListener('pointerdown', handler)
    window.removeEventListener('keydown', handler)
    void loadSprite()
  }
  window.addEventListener('pointerdown', handler)
  window.addEventListener('keydown', handler)
}

async function loadSprite(): Promise<void> {
  state.loadAttempts += 1
  try {
    const [{ Howl, Howler }, manifest] = await Promise.all([
      import('howler'),
      fetch(SPRITE_URL).then((res) => {
        if (!res.ok) throw new Error(`sprite fetch failed: ${res.status}`)
        return res.json() as Promise<SpriteManifest>
      }),
    ])
    state.howl = new Howl({ src: manifest.src, sprite: manifest.sprite }) as unknown as HowlLike
    state.howlerGlobal = Howler as unknown as HowlerGlobalLike
    try { state.howlerGlobal.mute(!state.enabled) } catch { /* best-effort */ }
    flushPending()
  } catch {
    // I3: a transient failure (flaky first request, offline fork) is not
    // permanent. Retry on the next gesture, up to MAX_LOAD_ATTEMPTS total;
    // only after that does `play()` become a true, silent, permanent no-op.
    if (state.loadAttempts < MAX_LOAD_ATTEMPTS && typeof window !== 'undefined') {
      bindGestureListener()
    } else {
      state.loadFailed = true
    }
  }
}

function warmHowlerImport(): void {
  void import('howler').catch(() => {
    // Best-effort warm-up only; the real gesture-triggered load retries regardless.
  })
}

/**
 * I7: pre-fetch the Howler chunk during idle time, well before any gesture.
 * Howler 2.2.4 creates the `AudioContext` and arms its own `autoUnlock`
 * listeners in the same synchronous call — inside `Howl.prototype.init`,
 * which calls `setupAudioContext()` then `Howler._unlockAudio()` back to
 * back (`node_modules/howler/dist/howler.js`). If the `howler` chunk is
 * still downloading when the first gesture fires, that construction happens
 * only after an unbounded network round-trip, well outside the gesture's
 * activation window — exactly the case Safari's stricter autoplay policy
 * does not forgive. Warming the import ahead of time means `import('howler')`
 * resolves from the module cache almost instantly on the real gesture, so
 * `new Howl(...)` runs inside that gesture's call stack instead of after it.
 * This warms only the *code* — it never constructs a `Howl` and never
 * touches `AudioContext` — so nothing audio-related runs before the
 * learner's first interaction; the sprite `fetch` and the `Howl` itself stay
 * gesture-gated in `loadSprite`.
 */
function scheduleIdleWarm(): void {
  if (typeof window === 'undefined') return
  const ric = (window as Window & { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback
  if (typeof ric === 'function') ric(warmHowlerImport)
  else setTimeout(warmHowlerImport, 1)
}

scheduleIdleWarm()

/** One pointerdown/keydown listener, removed after it fires (browser autoplay policy).
 *  Idempotent from the outside — a second call is a no-op — but `loadSprite` can still
 *  re-arm its own internal listener on a failed attempt (I3). */
export function initSoundOnFirstGesture(): void {
  if (typeof window === 'undefined' || state.gestureBound || state.loadFailed) return
  state.gestureBound = true
  bindGestureListener()
}

/**
 * No-op-and-queue before load or unlock; silent when gated; never throws.
 * `opts.volumeScale` applies a one-off multiplier on top of the current
 * global volume without mutating it (I5) — e.g. a walkthrough-finished
 * `pass` at 70% (spec §7.6), or a buddy-reply `ui.tap` at a low volume.
 */
export function play(id: SoundEventId, opts?: { volumeScale?: number }): void {
  try {
    if (!state.enabled) return
    if (!isTierAllowed(id)) return
    if (state.loadFailed) return
    const now = Date.now()
    if (!passesRankDebounce(id, now)) return
    const scale = clamp01(opts?.volumeScale ?? 1)
    const volumeFactor = attenuationFor(id, now) * scale
    if (!state.howl) {
      enqueue({ id, volumeFactor, at: now })
      return
    }
    playNow(id, volumeFactor)
  } catch {
    // play() must never throw, regardless of internal state.
  }
}

/** The header mute. Gates future `play()` calls on both tiers and calls
 *  `Howler.mute(!on)` so a cue already sounding stops immediately (I1).
 *  Default on (T0.5 §5). */
export function setEnabled(on: boolean): void {
  state.enabled = on
  if (state.howlerGlobal) {
    try { state.howlerGlobal.mute(!on) } catch { /* best-effort */ }
  }
}

/** The Account toggle for INTERFACE_TIER. Default off. */
export function setInterfaceEnabled(on: boolean): void {
  state.interfaceEnabled = on
}

export function setVolume(v: number): void {
  state.volume = clamp01(v)
}

/**
 * I8: the one hydration path for "wellness prefs finished loading" — every
 * caller (today: `SoundToggle`; later: Account, any session bootstrap) goes
 * through this rather than calling `setEnabled`/`setInterfaceEnabled`/
 * `setVolume` separately, so a future caller cannot hydrate two of the three
 * keys and silently leave `sound.interface` dead the way the fix-round
 * review found here.
 */
export function hydrateSoundFromPrefs(prefs: WellnessPrefs): void {
  setEnabled(prefs.sound.enabled)
  setInterfaceEnabled(prefs.sound.interface)
  setVolume(prefs.sound.volume)
}

/** Arcade turns the drill ticks on for a run regardless of the tier toggle: there the tick IS the game. */
export function withInterfaceSounds<T>(run: () => T): T {
  state.interfaceScopeDepth += 1
  try {
    return run()
  } finally {
    state.interfaceScopeDepth -= 1
  }
}
