import type { SoundEventId } from './events'

/**
 * R7.8: two tiers, two toggles. Membership is pinned to spec §7.7's literal
 * table (`docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` — the
 * `| Tier | Ids | Default | Toggle |` table and its restatement at ruling
 * 30) and asserted verbatim in `tiers.test.ts`. Do not derive this list from
 * "how often the sound fires" intuition — that is exactly the mistake R7.8
 * exists to correct (fix-round C1: `hint` and `xp.settle` were swapped here).
 *
 * REWARD_TIER plays by default (`wellness.prefs.sound.enabled`, the header
 * mute) and carries the dopamine loop — pass/fail, streaks, levels, and the
 * Coach hint, which is low-frequency (60s cooldown, max 5/exercise) despite
 * reading like it "should" be an interface sound.
 *
 * INTERFACE_TIER is off by default (`wellness.prefs.sound.interface`, the
 * Account toggle) — it is the "every keystroke/click has a sound" layer,
 * which is fun in short bursts and grating as a permanent default, and it is
 * exactly the high-frequency ids (`ui.tap`, `run.go`, `submit.send`,
 * `xp.settle` on every XP change, `drill.hit`/`drill.miss`) that belong here.
 * Arcade turns the drill ticks on for a run regardless of the tier toggle via
 * `withInterfaceSounds`: there the tick IS the game.
 */
export const REWARD_TIER: readonly SoundEventId[] = [
  'pass',
  'fail',
  'chain.tick',
  'clo.close',
  'first.win',
  'level.up',
  'streak.light',
  'streak.milestone',
  'streak.lost',
  'best',
  'goal.done',
  'hint',
]

export const INTERFACE_TIER: readonly SoundEventId[] = [
  'ui.tap',
  'run.go',
  'submit.send',
  'xp.settle',
  'drill.hit',
  'drill.miss',
  'wellness.chime',
]

/**
 * Rank debounce (R7.3): inside a 250ms window only the higher-ranked reward
 * sound plays — `first.win > level.up > clo.close > pass > chain.tick > rest`
 * (spec's own ordering, verbatim). `hint` sits at 25, comfortably above
 * `streak.lost` (15): a hint reveal must never be swallowed by a streak-lost
 * cue landing in the same 250ms window (fix-round C1's knock-on finding —
 * with `hint` at its old rank of 10 it would have been suppressed by both
 * `streak.lost` and `fail`). Interface-tier ids never participate in the
 * debounce at all (`passesRankDebounce` in `manager.ts` short-circuits for
 * any id outside `REWARD_TIER`), so their `RANK` entries below are unused by
 * that decision and only documented here for completeness.
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
  hint: 25,
  fail: 20,
  'streak.lost': 15,
  'drill.hit': 10,
  'drill.miss': 10,
  'xp.settle': 0,
  'ui.tap': 0,
  'run.go': 0,
  'submit.send': 0,
  'wellness.chime': 0,
}
