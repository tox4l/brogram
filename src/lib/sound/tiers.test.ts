import { describe, expect, it } from 'vitest'
import { SOUND_EVENT_IDS, type SoundEventId } from './events'
import { INTERFACE_TIER, RANK, REWARD_TIER } from './tiers'

// Pinned verbatim from docs/superpowers/specs/2026-09-06-brogram-v2-bro.md,
// ruling R7.8's own table:
//
// | Tier      | Ids                                                                                                              | Default | Toggle |
// |-----------|------------------------------------------------------------------------------------------------------------------|---------|--------|
// | Reward    | pass, fail, chain.tick, clo.close, first.win, level.up, streak.light, streak.milestone, streak.lost, best, goal.done, hint | on      | header mute |
// | Interface | ui.tap, run.go, submit.send, xp.settle, drill.hit, drill.miss, wellness.chime                                    | off     | Account "Interface sounds" |
//
// restated identically at ruling 30. This test reads that table literally —
// it must fail the instant tier membership drifts from the spec again
// (fix-round C1: `hint` and `xp.settle` were swapped here once already).
const SPEC_REWARD_TIER: readonly SoundEventId[] = [
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

const SPEC_INTERFACE_TIER: readonly SoundEventId[] = [
  'ui.tap',
  'run.go',
  'submit.send',
  'xp.settle',
  'drill.hit',
  'drill.miss',
  'wellness.chime',
]

function asSortedSet(ids: readonly SoundEventId[]): SoundEventId[] {
  return [...ids].sort()
}

describe('REWARD_TIER (R7.8)', () => {
  it('matches the spec table exactly, in the spec\'s own order', () => {
    expect(REWARD_TIER).toEqual(SPEC_REWARD_TIER)
  })

  it('has exactly 12 ids', () => {
    expect(REWARD_TIER).toHaveLength(12)
  })
})

describe('INTERFACE_TIER (R7.8)', () => {
  it('matches the spec table exactly, in the spec\'s own order', () => {
    expect(INTERFACE_TIER).toEqual(SPEC_INTERFACE_TIER)
  })

  it('has exactly 7 ids', () => {
    expect(INTERFACE_TIER).toHaveLength(7)
  })
})

describe('tier membership as a whole', () => {
  it('partitions every SoundEventId exactly once — no gaps, no overlap', () => {
    expect(asSortedSet([...REWARD_TIER, ...INTERFACE_TIER])).toEqual(asSortedSet(SOUND_EVENT_IDS))
    const overlap = REWARD_TIER.filter((id) => (INTERFACE_TIER as readonly SoundEventId[]).includes(id))
    expect(overlap).toEqual([])
  })

  it('specifically: hint is reward-tier and xp.settle is interface-tier (fix-round C1)', () => {
    expect(REWARD_TIER).toContain('hint')
    expect(INTERFACE_TIER).not.toContain('hint')
    expect(INTERFACE_TIER).toContain('xp.settle')
    expect(REWARD_TIER).not.toContain('xp.settle')
  })
})

describe('RANK (R7.3)', () => {
  it('orders the spec\'s named chain exactly: first.win > level.up > clo.close > pass > chain.tick', () => {
    expect(RANK['first.win']).toBeGreaterThan(RANK['level.up'])
    expect(RANK['level.up']).toBeGreaterThan(RANK['clo.close'])
    expect(RANK['clo.close']).toBeGreaterThan(RANK.pass)
    expect(RANK.pass).toBeGreaterThan(RANK['chain.tick'])
  })

  it('never ranks hint below streak.lost (fix-round C1 knock-on)', () => {
    expect(RANK.hint).toBeGreaterThan(RANK['streak.lost'])
  })

  it('has one entry per SoundEventId', () => {
    expect(asSortedSet(Object.keys(RANK) as SoundEventId[])).toEqual(asSortedSet(SOUND_EVENT_IDS))
  })
})
