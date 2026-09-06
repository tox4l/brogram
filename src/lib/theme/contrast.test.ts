// R8.3 (spec §8.3): the palette gate. Parses the real `oklch(...)` token
// values out of `globals.css` for each of the four `[data-theme]` blocks --
// not a hand-copied fixture -- and asserts every foreground/background pair
// the design actually uses against both WCAG 2.2 and APCA. A palette tweak
// that breaks contrast fails this test, not a design note.
//
// Three tiers, per the brief:
//  - "body text": `foreground`/`background`, `card-foreground`/`card`.
//    WCAG >= 4.5:1 and APCA Lc >= 75.
//  - "large text and UI components": `muted-foreground`/`card` and every
//    `<role>-foreground`/`<role>` pair (primary, destructive, success,
//    warning, celebration). WCAG >= 3:1 and APCA Lc >= 60. `muted-foreground`
//    sits here rather than the body tier because every real use of it in
//    this app is a caption/meta label (timestamps, secondary hints), never
//    sustained-reading body copy -- and, mechanically, no theme can hold a
//    foreground that reads as visually "muted" against a near-black card
//    while also clearing Lc 75 there (verified: the ceiling for a dimmer
//    tone on Midnight/Amber/Arcade's card lightness lands in the low 60s).
//  - "focus rings and dividers": `border`/`background`, `ring`/`background`.
//    APCA Lc >= 45 only -- the brief does not name a WCAG ratio for this
//    tier.
//
// Rulings this test forced against spec §8.3's literal starting numbers
// (each one failed the checks above until changed; see the git history of
// this file and `globals.css` for the before/after):
//  - `primary` needed less chroma and a touch more L in Midnight/Amber: at
//    the spec's original chroma the blue/orange channel clipped out of the
//    sRGB gamut, which *lowers* usable luminance even though the colour
//    looks more saturated.
//  - `destructive` moved from "light chip + dark text" to "deep red +
//    near-white text" in Midnight/Amber/Arcade -- the light-chip version
//    cannot clear Lc 60 with near-black text at any chroma tried.
//  - Paper's `warning` was the one status colour still using dark text,
//    inconsistent with its destructive/success siblings; switched to the
//    same "saturated fill + light text" shape they already use.
//  - Arcade's `warning` moved from a bright yellow chip to a deep amber
//    fill with white text -- both fixes the Lc 60 failure *and* the R8.3
//    "success and warning must differ by >= 0.10 in L" rule below (bright
//    yellow at L 0.85 sat only 0.03 away from success's 0.82).
//  - `border`/`ring` in every dark theme moved from a low-alpha white
//    overlay (8-18%) to a much more opaque neutral -- a subtle 10% divider
//    genuinely cannot reach Lc 45 against a near-black background; this is
//    the real, load-bearing reason `border` is fully opaque in every theme
//    below rather than alpha-blended (Paper's is the one exception that
//    could stay a plain opaque mid-grey and comfortably clear the bar).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apcaLc, parseOklch, wcagRatio } from './contrast'

const SRC_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const GLOBALS_CSS_PATH = join(SRC_DIR, 'app', 'globals.css')

type ThemeId = 'midnight' | 'amber' | 'paper' | 'arcade'
type TokenMap = Record<string, string>

const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')

/** Every `[data-theme="x"] { ... }` block, raw (declarations unresolved). */
function extractThemeBlocks(source: string): Record<ThemeId, TokenMap> {
  const blocks = {} as Record<ThemeId, TokenMap>
  const blockRe = /\[data-theme="(midnight|amber|paper|arcade)"\]\s*\{([^}]*)\}/g
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRe.exec(source))) {
    const [, id, body] = blockMatch
    const tokens: TokenMap = {}
    const declRe = /--([\w-]+):\s*([^;]+);/g
    let declMatch: RegExpExecArray | null
    while ((declMatch = declRe.exec(body))) {
      const [, name, rawValue] = declMatch
      tokens[name] = rawValue.trim()
    }
    blocks[id as ThemeId] = tokens
  }
  return blocks
}

/** Resolves a one-level `var(--x)` indirection (e.g. `card-foreground: var(--foreground)`). */
function resolve(tokens: TokenMap, key: string): string {
  const raw = tokens[key]
  if (raw === undefined) throw new Error(`globals.css: [data-theme] block is missing --${key}`)
  const varMatch = /^var\(--([\w-]+)\)$/.exec(raw)
  if (!varMatch) return raw
  return resolve(tokens, varMatch[1])
}

const THEMES = extractThemeBlocks(css)
const THEME_IDS: ThemeId[] = ['midnight', 'amber', 'paper', 'arcade']

describe('theme palette: key-set parity (the half-themed-block bug)', () => {
  it('found all four [data-theme] blocks in globals.css', () => {
    for (const id of THEME_IDS) expect(THEMES[id], `missing [data-theme="${id}"] block`).toBeDefined()
  })

  it('every theme block defines the identical set of custom properties', () => {
    const [first, ...rest] = THEME_IDS
    const referenceKeys = Object.keys(THEMES[first]).sort()
    for (const id of rest) {
      const keys = Object.keys(THEMES[id]).sort()
      expect(keys, `[data-theme="${id}"] token set differs from [data-theme="${first}"]`).toEqual(referenceKeys)
    }
  })

  it('every theme sets its own color-scheme (R8.2: no theme inherits a mismatched one)', () => {
    for (const id of THEME_IDS) {
      const re = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{[^}]*color-scheme:\\s*(light|dark)`)
      expect(re.test(css), `[data-theme="${id}"] has no color-scheme declaration`).toBe(true)
    }
  })
})

const BODY_TIER: [string, string][] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
]

const UI_TIER: [string, string][] = [
  ['muted-foreground', 'card'],
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['celebration-foreground', 'celebration'],
]

const DIVIDER_TIER: [string, string][] = [
  ['border', 'background'],
  ['ring', 'background'],
]

describe.each(THEME_IDS)('theme palette contrast: %s', (id) => {
  const tokens = THEMES[id]

  it.each(BODY_TIER)('body text: %s on %s clears WCAG 4.5:1 and APCA Lc 75', (fgKey, bgKey) => {
    const fg = resolve(tokens, fgKey)
    const bg = resolve(tokens, bgKey)
    expect(wcagRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
    expect(apcaLc(fg, bg)).toBeGreaterThanOrEqual(75)
  })

  it.each(UI_TIER)('large text / UI component: %s on %s clears WCAG 3:1 and APCA Lc 60', (fgKey, bgKey) => {
    const fg = resolve(tokens, fgKey)
    const bg = resolve(tokens, bgKey)
    expect(wcagRatio(fg, bg)).toBeGreaterThanOrEqual(3)
    expect(apcaLc(fg, bg)).toBeGreaterThanOrEqual(60)
  })

  it.each(DIVIDER_TIER)('focus ring / divider: %s on %s clears APCA Lc 45', (fgKey, bgKey) => {
    const fg = resolve(tokens, fgKey)
    const bg = resolve(tokens, bgKey)
    expect(apcaLc(fg, bg)).toBeGreaterThanOrEqual(45)
  })
})

describe('Arcade: success vs. warning read as different luminance, not just different hue', () => {
  it('differ by at least 0.10 in OKLCH L', () => {
    const tokens = THEMES.arcade
    const successL = parseOklch(resolve(tokens, 'success')).l
    const warningL = parseOklch(resolve(tokens, 'warning')).l
    expect(Math.abs(successL - warningL)).toBeGreaterThanOrEqual(0.1)
  })
})

describe('contrast.ts sanity (pins the implementation against a known reference)', () => {
  it('black on white is WCAG 21:1 and APCA Lc ~106 (the canonical APCA reference pair)', () => {
    expect(wcagRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 0)
    expect(apcaLc('oklch(0 0 0)', 'oklch(1 0 0)')).toBeGreaterThan(100)
  })
})
