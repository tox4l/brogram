/**
 * Client-only sound event catalogue. Deliberately NOT a contract (unlike
 * `src/lib/contracts.ts`): nothing server-side ever reads or writes a
 * `SoundEventId`, so this list can grow without the dual sign-off contracts
 * require after T0.1. See `scripts/synth-sounds.mjs` for how each id's clip
 * is generated and `src/lib/sound/tiers.ts` for tier/rank assignment.
 */
export type SoundEventId =
  | 'ui.tap'
  | 'run.go'
  | 'submit.send'
  | 'pass'
  | 'fail'
  | 'chain.tick'
  | 'clo.close'
  | 'first.win'
  | 'level.up'
  | 'xp.settle'
  | 'streak.light'
  | 'streak.milestone'
  | 'streak.lost'
  | 'best'
  | 'hint'
  | 'drill.hit'
  | 'drill.miss'
  | 'goal.done'
  | 'wellness.chime'

/** Every id, in the order `scripts/synth-sounds.mjs` generates its source clips. */
export const SOUND_EVENT_IDS: readonly SoundEventId[] = [
  'ui.tap',
  'run.go',
  'submit.send',
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
  'hint',
  'drill.hit',
  'drill.miss',
  'goal.done',
  'wellness.chime',
]
