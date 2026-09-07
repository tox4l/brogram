// R8.3 (spec §8.3), extended by wave 4 §2.4/§10 family A: the palette gate.
// Parses the real `oklch(...)` token values out of `globals.css` for each of
// the five `[data-theme]` blocks -- not a hand-copied fixture -- and asserts
// every foreground/background pair the design actually uses against both
// WCAG 2.2 and APCA, plus the wave-4 gates on `--card`, `--muted-
// foreground`, `--rule`, the nine `--code-*` tokens, `--guide` and the
// success/warning separation. A palette tweak that breaks contrast fails
// this test, not a design note.
//
// Three tiers, per the brief, plus fix-round corrections from the Opus
// review of commit 31e2e30 (`v2-T0.6-review.md`):
//  - "body text": `foreground`/`background`, `card-foreground`/`card`,
//    `muted-foreground`/`background`, `muted-foreground`/`card`, `muted-
//    foreground`/`muted`. WCAG >= 4.5:1 and APCA Lc >= 75.
//
//    Review ruling (OVERRIDES this test's original reasoning): `muted-
//    foreground` was held to the lower "UI component" tier (Lc >= 60) on
//    the claim that no theme could clear Lc 75 against a near-black card
//    while still reading as visually muted. That claim was checked against
//    the wrong variable -- it swept the *background*, not `muted-
//    foreground`'s own `L`, and stopped at the shipped value (0.80,
//    ceiling ~66) instead of continuing the sweep. Lc 75 is reached at
//    L ≈ 0.855 against every dark theme's card (verified: 0.88 clears it on
//    both `card` and `muted` in all three dark themes, with margin). APCA's
//    own font-size lookup also runs the opposite direction the original
//    reasoning assumed: *smaller, lighter* text needs a *higher* Lc, not a
//    lower one, and `muted-foreground` labels this app's 12-13px captions
//    (`--text-micro`, `--text-small`) -- exactly the sizes Lc 75 is the
//    floor for, not text that gets a discount. `muted-foreground` is body
//    text and stays gated at the body tier.
//
//    Wave 4 ruling W4.5 (spec §2.4): dropping muted text to a bare WCAG
//    4.6-6.0:1 band would put it at APCA Lc ≈ 32, failing this app's own
//    body tier by 43 points, and an unscoped 7:1 ceiling would force a
//    contrast *reduction* on Arcade -- the palette seeded to every
//    `prefers-contrast: more` user. The gate is therefore a floor (Lc 75 /
//    4.5:1 on background, card and muted) plus a floor on the *gap* below
//    `--foreground` (>= 14 Lc), never a ceiling.
//  - "large text and UI components": every `<role>-foreground`/`<role>`
//    pair (primary, destructive, success, warning, celebration, accent).
//    WCAG >= 3:1 and APCA Lc >= 60.
//  - "focus rings and dividers": `border`/`background` and
//    `input`/`background` (I2: `--input`, not `--border`, draws almost
//    every visible field/empty-state outline in this app -- it is gated
//    the same as `border`, not exempted just because the brief's own list
//    named only one of the two). APCA Lc >= 45, no WCAG ratio -- Ruling 1
//    (see below) is why this tier is deliberately APCA-only.
//
//    `ring`/`background` is the one divider-tier pair that ALSO carries a
//    WCAG >= 3:1 floor (I3): a focus indicator is a UI component under
//    WCAG 2.2 SC 1.4.11, not a decorative divider, and Paper's ring shipped
//    at 2.95:1 -- under the legal minimum -- because the divider tier's
//    APCA-only shape (correct for `border`) was applied to it too.
//
// Ruling 1 (review, APPROVED as shipped, follow-up recorded for the spec
// owner): on a near-black background, a low-alpha divider structurally
// cannot reach Lc 45 -- verified independently by the review. `border` and
// `input` are opaque, conspicuously-light greys in every dark theme as a
// direct, unavoidable consequence, not a taste choice. Wave 4 §2.2 acts on
// the follow-up this ruling asked for: `--rule` is now the separate,
// deliberately more permissive decorative-hairline token (gated below on a
// narrow WCAG band, never the `--border`/`--ring` floor), and `--border`
// keeps this tier for interactive boundaries.
//
// Other rulings this test forced against spec §8.3's literal starting
// numbers (each one failed the checks above until changed), all carried
// forward unchanged by the wave-4 retune:
//  - `primary` needed less chroma and a touch more L in Midnight/Amber: at
//    the spec's original chroma the blue/orange channel clipped out of the
//    sRGB gamut, which *lowers* usable luminance even though the colour
//    looks more saturated. Wave 4's own W4.6 gate (every `oklch()` round-
//    trips into sRGB) makes this the same fix, generalised and enforced.
//  - `destructive` moved from "light chip + dark text" to "deep red +
//    near-white text" in Midnight/Amber/Arcade -- the light-chip version
//    cannot clear Lc 60 with near-black text at any chroma tried.
//  - Paper's (now Folio's) `warning` was the one status colour still using
//    dark text, inconsistent with its destructive/success siblings;
//    switched to the same "saturated fill + light text" shape they already
//    use.
//  - Arcade's `warning` moved from a bright yellow chip to a deep amber
//    fill with white text -- both fixes the Lc 60 failure *and* the
//    success/warning separation rule below (bright yellow at L 0.85 sat
//    only 0.03 away from success's 0.82).
//  - `accent` needed more `L` in Amber and Arcade (I2): both shipped below
//    Lc 60 against their own `accent-foreground` even though the pair was
//    never in the original enumerated list -- it renders on real screens
//    (`bg-accent` + `text-accent-foreground`) regardless of whether the
//    gate was checking it.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apcaLc, deltaL, isInGamut, parseOklch, wcagRatio } from './contrast'
import { THEMES as PICKER_THEMES } from './themes'

const SRC_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const GLOBALS_CSS_PATH = join(SRC_DIR, 'app', 'globals.css')

type ThemeId = 'midnight' | 'amber' | 'eclipse' | 'arcade' | 'paper'
type TokenMap = Record<string, string>

const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')

function extractDeclarations(body: string): TokenMap {
  const tokens: TokenMap = {}
  const declRe = /--([\w-]+):\s*([^;]+);/g
  let declMatch: RegExpExecArray | null
  while ((declMatch = declRe.exec(body))) {
    const [, name, rawValue] = declMatch
    tokens[name] = rawValue.trim()
  }
  return tokens
}

/** Every `[data-theme="x"] { ... }` block, raw (declarations unresolved). */
function extractThemeBlocks(source: string): Record<ThemeId, TokenMap> {
  const blocks = {} as Record<ThemeId, TokenMap>
  const blockRe = /\[data-theme="(midnight|amber|eclipse|arcade|paper)"\]\s*\{([^}]*)\}/g
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRe.exec(source))) {
    const [, id, body] = blockMatch
    blocks[id as ThemeId] = extractDeclarations(body)
  }
  return blocks
}

/** The one `:root { ... }` block (I6's fallback palette lives here too). */
function extractRootBlock(source: string): TokenMap {
  const match = /(?:^|\n):root\s*\{([^}]*)\}/.exec(source)
  if (!match) throw new Error('globals.css: no :root block found')
  return extractDeclarations(match[1])
}

/**
 * Resolves a `var(--x)` indirection within the same block (e.g.
 * `card-foreground: var(--foreground)`). A reference to a token this block
 * does not define itself -- `--font-display-face: var(--font-sans)`,
 * where `--font-sans` lives only in `@theme inline` -- is returned as the
 * literal `var(...)` string rather than followed: no colour pair this file
 * tests ever routes through one, and the I6 mirror check only needs both
 * sides to produce the same (possibly unresolved) string.
 */
function resolve(tokens: TokenMap, key: string): string {
  const raw = tokens[key]
  if (raw === undefined) throw new Error(`globals.css: block is missing --${key}`)
  const varMatch = /^var\(--([\w-]+)\)$/.exec(raw)
  if (!varMatch) return raw
  if (tokens[varMatch[1]] === undefined) return raw
  return resolve(tokens, varMatch[1])
}

const THEMES = extractThemeBlocks(css)
const ROOT = extractRootBlock(css)
const THEME_IDS: ThemeId[] = ['midnight', 'amber', 'eclipse', 'arcade', 'paper']
const DARK_IDS: ThemeId[] = ['midnight', 'amber', 'eclipse', 'arcade']

describe('theme palette: key-set parity (the half-themed-block bug)', () => {
  it('found all five [data-theme] blocks in globals.css', () => {
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

  it('no [data-theme] block defines a --text-* token (the scale lives only in @theme inline, W4.9)', () => {
    for (const id of THEME_IDS) {
      const keys = Object.keys(THEMES[id])
      const textKeys = keys.filter((k) => k.startsWith('text-'))
      expect(textKeys, `[data-theme="${id}"] defines --text-* token(s): ${textKeys.join(', ')}`).toEqual([])
    }
  })
})

describe('I6: :root carries a literal fallback palette that mirrors Midnight', () => {
  it('every colour/elevation/radius/font-face token in [data-theme="midnight"] is also in :root, unchanged', () => {
    const midnight = THEMES.midnight
    for (const key of Object.keys(midnight)) {
      expect(ROOT[key], `:root is missing --${key} (present in [data-theme="midnight"])`).toBeDefined()
      expect(resolve(ROOT, key), `:root's --${key} has drifted from [data-theme="midnight"]'s`).toBe(resolve(midnight, key))
    }
  })

  it(':root sets color-scheme: dark, matching Midnight', () => {
    expect(/:root\s*\{[^}]*color-scheme:\s*dark/.test(css)).toBe(true)
  })
})

const BODY_TIER: [string, string][] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
]

const UI_TIER: [string, string][] = [
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['celebration-foreground', 'celebration'],
  ['accent-foreground', 'accent'],
]

/** APCA-only, per Ruling 1: decorative dividers, not focus indicators. */
const DIVIDER_APCA_ONLY: [string, string][] = [
  ['border', 'background'],
  ['input', 'background'],
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

  it.each(DIVIDER_APCA_ONLY)('divider: %s on %s clears APCA Lc 45', (fgKey, bgKey) => {
    const fg = resolve(tokens, fgKey)
    const bg = resolve(tokens, bgKey)
    expect(apcaLc(fg, bg)).toBeGreaterThanOrEqual(45)
  })

  it('I3: focus ring (ring/background) clears APCA Lc 45 AND WCAG 3:1 (SC 1.4.11 -- not APCA-only)', () => {
    const fg = resolve(tokens, 'ring')
    const bg = resolve(tokens, 'background')
    expect(apcaLc(fg, bg)).toBeGreaterThanOrEqual(45)
    expect(wcagRatio(fg, bg)).toBeGreaterThanOrEqual(3)
  })

  it('W4.5: muted-foreground sits at least 14 Lc below foreground on background', () => {
    const bg = resolve(tokens, 'background')
    const fgLc = apcaLc(resolve(tokens, 'foreground'), bg)
    const mutedLc = apcaLc(resolve(tokens, 'muted-foreground'), bg)
    expect(fgLc - mutedLc).toBeGreaterThanOrEqual(14)
  })

  it('§2.2: wcagRatio(rule, background) is between 1.25 and 1.90', () => {
    const ratio = wcagRatio(resolve(tokens, 'rule'), resolve(tokens, 'background'))
    expect(ratio).toBeGreaterThanOrEqual(1.25)
    expect(ratio).toBeLessThanOrEqual(1.9)
  })

  it('§2.2: apcaLc(rule, background) < apcaLc(border, background) (--rule is the more permissive tier)', () => {
    const bg = resolve(tokens, 'background')
    expect(apcaLc(resolve(tokens, 'rule'), bg)).toBeLessThan(apcaLc(resolve(tokens, 'border'), bg))
  })

  it('§7.2: --guide clears WCAG 3:1 on --lesson-code-surface (a 1.4.11 graphic, not decoration)', () => {
    const ratio = wcagRatio(resolve(tokens, 'guide'), resolve(tokens, 'lesson-code-surface'))
    expect(ratio).toBeGreaterThanOrEqual(3)
  })

  const CODE_TOKENS = [
    'code-keyword',
    'code-string',
    'code-number',
    'code-comment',
    'code-function',
    'code-type',
    'code-variable',
    'code-operator',
    'code-punct',
  ]

  it.each(CODE_TOKENS)('§2.6: --%s clears its APCA floor on --lesson-code-surface (comment: Lc 60, else Lc 75)', (key) => {
    const surface = resolve(tokens, 'lesson-code-surface')
    const floor = key === 'code-comment' ? 60 : 75
    expect(apcaLc(resolve(tokens, key), surface)).toBeGreaterThanOrEqual(floor)
  })

  it('success and warning read as different luminance, not just different hue: ΔL >= 0.10', () => {
    const successL = parseOklch(resolve(tokens, 'success')).l
    const warningL = parseOklch(resolve(tokens, 'warning')).l
    expect(Math.abs(successL - warningL)).toBeGreaterThanOrEqual(0.1)
  })

  it('W4.6: every authored oklch() value round-trips into sRGB ([-0.001, 1.001] per channel)', () => {
    for (const [key, raw] of Object.entries(tokens)) {
      if (!raw.startsWith('oklch(')) continue
      expect(isInGamut(raw), `[data-theme="${id}"] --${key}: ${raw} is out of gamut`).toBe(true)
    }
  })
})

describe('W4.3/W4.4: --card sits at an OKLCH ΔL from --background, not a WCAG ratio', () => {
  it.each(DARK_IDS)('%s: ΔL(card, background) is between 0.06 and 0.09', (id) => {
    const tokens = THEMES[id]
    const d = deltaL(resolve(tokens, 'card'), resolve(tokens, 'background'))
    expect(d).toBeGreaterThanOrEqual(0.06)
    expect(d).toBeLessThanOrEqual(0.09)
  })

  it('paper (Folio): ΔL(card, background) is at least 0.02 -- a light ground carries depth with shadow, not ratio', () => {
    const tokens = THEMES.paper
    const d = deltaL(resolve(tokens, 'card'), resolve(tokens, 'background'))
    expect(d).toBeGreaterThanOrEqual(0.02)
  })
})

describe('I5: ThemeQuickSwitch swatches stay pinned to the real tokens', () => {
  it.each(THEME_IDS)('%s swatch is [background, primary, accent] parsed live from globals.css', (id) => {
    const tokens = THEMES[id]
    const picked = PICKER_THEMES.find((entry) => entry.id === id)
    expect(picked, `themes.ts has no THEMES entry for "${id}"`).toBeDefined()
    expect(picked!.swatch).toEqual([
      resolve(tokens, 'background'),
      resolve(tokens, 'primary'),
      resolve(tokens, 'accent'),
    ])
  })
})

describe('contrast.ts sanity (pins the implementation against a known reference)', () => {
  it('black on white is WCAG 21:1 and APCA Lc ~106 (the canonical APCA reference pair)', () => {
    expect(wcagRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 0)
    expect(apcaLc('oklch(0 0 0)', 'oklch(1 0 0)')).toBeGreaterThan(100)
  })

  it('deltaL is a symmetric, unsigned OKLCH lightness distance', () => {
    expect(deltaL('oklch(0.3 0.1 260)', 'oklch(0.5 0.1 260)')).toBeCloseTo(0.2, 5)
    expect(deltaL('oklch(0.5 0.1 260)', 'oklch(0.3 0.1 260)')).toBeCloseTo(0.2, 5)
  })

  it('isInGamut rejects a value whose chroma exceeds the sRGB gamut at that L/H', () => {
    // The exact regression this gate exists for (§2.4 W4.6): the pre-wave-4
    // Midnight primary, oklch(0.78 0.16 264), clips a channel out of range.
    expect(isInGamut('oklch(0.78 0.16 264)')).toBe(false)
    expect(isInGamut('oklch(0.78 0.11 264)')).toBe(true)
  })
})
