import type { SoundEventId } from './events'

/**
 * R7.8: two tiers, two toggles.
 *
 * REWARD_TIER plays by default (`wellness.prefs.sound.enabled`, the header
 * mute) and carries the dopamine loop — pass/fail, streaks, levels, XP.
 * Killing the header mute silences it; nothing else does.
 *
 * INTERFACE_TIER is off by default (`wellness.prefs.sound.interface`, the
 * Account toggle) — it is the "every keystroke/click has a sound" layer,
 * which is fun in short bursts and grating as a permanent default. Arcade
 * turns the drill ticks (`drill.hit`/`drill.miss`) on for a run regardless
 * of the tier toggle via `withInterfaceSounds`: there the tick IS the game.
 */
export const REWARD_TIER: readonly SoundEventId[] = [
  'pass',
  'fail',
  'chain.tick',
  'clo.close',
  'first.win',
  'level.up',
  'xp.settle',
  'streak.light',
  'streak.milestone',
  'streak.lost',
  'best',
  'goal.done',
]

export const INTERFACE_TIER: readonly SoundEventId[] = [
  'ui.tap',
  'run.go',
  'submit.send',
  'hint',
  'drill.hit',
  'drill.miss',
  'wellness.chime',
]

/**
 * Rank debounce (R7.3): inside a 250ms window only the higher-ranked reward
 * sound plays — `first.win > level.up > clo.close > pass > chain.tick > rest`.
 * Interface-tier ids rank lowest; they never suppress, or get suppressed by,
 * a reward sound, since the debounce only ever compares within REWARD_TIER.
 */
export const RANK: Record<SoundEventId, number> = {
  'first.win': 100,
  'level.up': 90,
  'clo.close': 80,
  pass: 70,
  'chain.tick': 60,
  best: 55,
  'streak.milestone': 50,
  'streak.light': 45,
  'goal.done': 40,
  'xp.settle': 30,
  fail: 20,
  'streak.lost': 15,
  hint: 10,
  'drill.hit': 10,
  'drill.miss': 10,
  'ui.tap': 0,
  'run.go': 0,
  'submit.send': 0,
  'wellness.chime': 0,
}
