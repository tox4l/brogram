// V9 (Wave 2 review §5): seed/validate.mjs's lesson-content emoji guard used
// to be a hand-rolled Unicode range set that missed plain symbol emoji. This
// pins the exported EMOJI_PATTERN against exactly the characters the review
// verified: the old range set's own ✅ (✅) example (correctly caught by
// both), the arrow range it has always banned, and characters the old ranges
// missed.
//
// NOTE for whoever wires this into the gate: at the time this file was
// written, vitest.config.mts's `test.include` only covers
// `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.{ts,mjs}` — it has no
// `seed/**` entry, so `npx vitest run` does not discover this file yet (a
// `seed` positional filter matches `src/components/shell/QuerySeed.test.tsx`
// by substring instead). Add `'seed/**/*.test.{ts,mjs}'` to `include` to wire
// it in; that file is outside this lane's owned paths, so it is reported here
// rather than changed.
import { describe, expect, it } from 'vitest'
import { EMOJI_PATTERN } from './validate.mjs'

describe('seed/validate.mjs EMOJI_PATTERN', () => {
  it('still catches everything the old range set caught', () => {
    expect(EMOJI_PATTERN.test('nice job ✅')).toBe(true) // ✅ U+2705, inside old 2600-27BF
    expect(EMOJI_PATTERN.test('go here →')).toBe(true) // → U+2192, the arrow range \p{Extended_Pictographic} alone would drop
    expect(EMOJI_PATTERN.test('\u{1F600}')).toBe(true) // 😀 U+1F600, plain \p{Extended_Pictographic} territory
  })

  it('catches symbol emoji the old hand-rolled range set missed', () => {
    expect(EMOJI_PATTERN.test('see note ℹ')).toBe(true) // ℹ U+2139 information source
    expect(EMOJI_PATTERN.test('brand™')).toBe(true) // ™ U+2122 trade mark sign
    expect(EMOJI_PATTERN.test('© 2026')).toBe(true) // © U+00A9 copyright sign
    expect(EMOJI_PATTERN.test('\u{1F170}')).toBe(true) // 🅰 U+1F170 negative squared latin capital letter A
  })

  it('catches a lone variation selector and a regional-indicator flag half', () => {
    expect(EMOJI_PATTERN.test('️')).toBe(true) // lone VS-16, the union's own addition over \p{Extended_Pictographic}
    expect(EMOJI_PATTERN.test('\u{1F1EA}\u{1F1F8}')).toBe(true) // 🇪🇸 regional indicators E+S
  })

  it('leaves ordinary prose and code untouched', () => {
    expect(EMOJI_PATTERN.test('a guard clause returns early')).toBe(false)
    expect(EMOJI_PATTERN.test('for t in times:\n    if t > limit:')).toBe(false)
  })
})
