'use client'

/**
 * The two-tier sound manager (R7.3, R7.8). A module singleton, never a React
 * hook or context, so any call site — a plain event handler, a GSAP
 * `onComplete`, a non-component utility — can call `play()` without needing
 * to be inside a component tree. Howler and the sprite JSON are dynamic
 * imports, loaded only after the user's first gesture, so neither sits on
 * any route's initial chunk or critical path.
 *
 * Everything a call site must never have to think about lives here:
 *  - rank debounce: no two reward sounds overlap inside a 250ms window;
 *  - repetition attenuation: a hot id quiets down after 4 repeats in 60s;
 *  - the tier gate (interface sounds are opt-in, or scoped via `withInterfaceSounds`);
 *  - the master gate (the header mute kills both tiers).
 */

import type { SoundEventId } from './events'
import { INTERFACE_TIER, RANK, REWARD_TIER } from './tiers'

const SPRITE_URL = '/sounds/brogram.json'
const RANK_DEBOUNCE_MS = 250
const REPEAT_WINDOW_MS = 60_000
/** The 5th play of one id inside the window (4 prior + this one) gets attenuated. */
const REPEAT_THRESHOLD = 4
const ATTENUATION_DB = 6
const ATTENUATION_FACTOR = 10 ** (-ATTENUATION_DB / 20)

const REWARD_SET = new Set<SoundEventId>(REWARD_TIER)
const INTERFACE_SET = new Set<SoundEventId>(INTERFACE_TIER)

interface HowlLike {
  play(sprite: string): number
  volume(vol: number, id?: number): void
  stop(id?: number): void
}

interface SpriteManifest {
  src: string[]
  sprite: Record<string, [number, number] | [number, number, boolean]>
}

interface QueuedPlay {
  id: SoundEventId
  volumeFactor: number
}

interface RewardWindow {
  at: number
  rank: number
  id: SoundEventId
}

const state = {
  howl: null as HowlLike | null,
  gestureBound: false,
  enabled: true,
  interfaceEnabled: false,
  interfaceScopeDepth: 0,
  volume: 1,
  pending: [] as QueuedPlay[],
  rewardWindow: null as RewardWindow | null,
  history: new Map<SoundEventId, number[]>(),
  activeIds: new Map<SoundEventId, number>(),
}

function isTierAllowed(id: SoundEventId): boolean {
  if (INTERFACE_SET.has(id)) return state.interfaceEnabled || state.interfaceScopeDepth > 0
  return true
}

/** R7.3. Mutates `state.rewardWindow` as a side effect of the decision. */
function passesRankDebounce(id: SoundEventId): boolean {
  if (!REWARD_SET.has(id)) return true
  const rank = RANK[id]
  const now = Date.now()
  const win = state.rewardWindow
  if (win && now - win.at < RANK_DEBOUNCE_MS) {
    if (rank <= win.rank) return false
    // A bigger reward arrived mid-window: cut off whatever was sounding for the one it beats.
    const activeId = state.activeIds.get(win.id)
    if (state.howl && activeId !== undefined) {
      try { state.howl.stop(activeId) } catch { /* best-effort cutoff */ }
    }
    state.rewardWindow = { at: now, rank, id }
    return true
  }
  state.rewardWindow = { at: now, rank, id }
  return true
}

/** R7.8. Returns the volume multiplier for this play, recording the occurrence. */
function attenuationFor(id: SoundEventId): number {
  const now = Date.now()
  const recent = (state.history.get(id) ?? []).filter((t) => now - t < REPEAT_WINDOW_MS)
  recent.push(now)
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

function flushPending(): void {
  const queued = state.pending.splice(0)
  for (const { id, volumeFactor } of queued) playNow(id, volumeFactor)
}

async function loadSprite(): Promise<void> {
  try {
    const [{ Howl }, manifest] = await Promise.all([
      import('howler'),
      fetch(SPRITE_URL).then((res) => {
        if (!res.ok) throw new Error(`sprite fetch failed: ${res.status}`)
        return res.json() as Promise<SpriteManifest>
      }),
    ])
    state.howl = new Howl({ src: manifest.src, sprite: manifest.sprite }) as unknown as HowlLike
    flushPending()
  } catch {
    // Sprite fetch or Howl construction failed (offline fork, missing build step).
    // `state.howl` stays null, so `play()` remains a permanent, safe no-op-and-queue.
  }
}

/** One pointerdown/keydown listener, removed after it fires (browser autoplay policy). */
export function initSoundOnFirstGesture(): void {
  if (typeof window === 'undefined' || state.gestureBound) return
  state.gestureBound = true
  const handler = () => {
    window.removeEventListener('pointerdown', handler)
    window.removeEventListener('keydown', handler)
    void loadSprite()
  }
  window.addEventListener('pointerdown', handler)
  window.addEventListener('keydown', handler)
}

/** No-op-and-queue before load or unlock; silent when gated; never throws. */
export function play(id: SoundEventId): void {
  try {
    if (!state.enabled) return
    if (!isTierAllowed(id)) return
    if (!passesRankDebounce(id)) return
    const volumeFactor = attenuationFor(id)
    if (!state.howl) {
      state.pending.push({ id, volumeFactor })
      return
    }
    playNow(id, volumeFactor)
  } catch {
    // play() must never throw, regardless of internal state.
  }
}

/** The header mute. Kills both REWARD_TIER and INTERFACE_TIER. Default on (T0.5 §5). */
export function setEnabled(on: boolean): void {
  state.enabled = on
}

/** The Account toggle for INTERFACE_TIER. Default off. */
export function setInterfaceEnabled(on: boolean): void {
  state.interfaceEnabled = on
}

export function setVolume(v: number): void {
  state.volume = Math.min(1, Math.max(0, v))
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
