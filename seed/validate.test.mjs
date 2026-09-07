// V9 (Wave 2 review §5): seed/validate.mjs's lesson-content emoji guard used
// to be a hand-rolled Unicode range set that missed plain symbol emoji. This
// pins the exported EMOJI_PATTERN against exactly the characters the review
// verified: the old range set's own ✅ (✅) example (correctly caught by
// both), the arrow range it has always banned, and characters the old ranges
// missed. It does not claim full parity with the old ranges — see the
// "deliberate narrowing" comment next to EMOJI_PATTERN's definition and the
// second test below (F7, review round 2): the union drops the five
// skin-tone modifiers, most of U+2B00-2BFF, and the non-pictographic
// dingbats in U+2700-27BF.
//
// Wired into the gate via vitest.config.mts's `seed/**/*.test.{ts,mjs}`
// include entry (F2, review round 2).
import { describe, expect, it } from 'vitest'
import { EMOJI_PATTERN } from './validate.mjs'

describe('seed/validate.mjs EMOJI_PATTERN', () => {
  it('catches the arrow range `\\p{Extended_Pictographic}` alone would drop, plus the pictographics the old ranges missed', () => {
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
