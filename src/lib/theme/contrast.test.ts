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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apcaLc, deltaL, isInGamut, parseOklch, wcagRatio } from './contrast'
import { THEMES as PICKER_THEMES } from './themes'
import { THEME_NAMES as WELLNESS_THEME_NAMES } from '@/lib/wellness/prefs'

const SRC_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const GLOBALS_CSS_PATH = join(SRC_DIR, 'app', 'globals.css')

// T4.0 fix round 3: derived from the registry, not hand-enumerated -- the
// re-check's sixth-palette probe found this exact literal union would ship
// a new theme both ungated (no [data-theme] block ever parsed for it) and
// unlisted (never iterated by describe.each) with zero tsc/test signal.
type ThemeId = (typeof PICKER_THEMES)[number]['id']
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

/** Every `[data-theme="x"] { ... }` block, raw (declarations unresolved).
 *  The id alternation is built from the registry, not hand-enumerated, so
 *  a sixth palette added to `THEMES` is parsed the moment it ships. */
function extractThemeBlocks(source: string): Record<ThemeId, TokenMap> {
  const blocks = {} as Record<ThemeId, TokenMap>
  const blockRe = new RegExp(`\\[data-theme="(${PICKER_THEMES.map((t) => t.id).join('|')})"\\]\\s*\\{([^}]*)\\}`, 'g')
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
// T4.0 fix round 3 (F4/M3 follow-up): derived, not hand-enumerated -- see
// the re-check's sixth-palette probe (v2-T4.0-recheck2.md, R1) for why a
// literal list here is the exact hole a new palette can ship through
// unlisted.
const THEME_IDS: ThemeId[] = PICKER_THEMES.map((t) => t.id)
// DARK_IDS is deliberately still hand-picked: which palettes are dark is a
// design fact `THEMES` does not encode (id/name/blurb/swatch, not
// `color-scheme`), not something the registry alone can derive.
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
  // T4.0 fix round (M4): the two new wave-4 surface/foreground pairs, same
  // shape as card-foreground/card, untested until now.
  ['dock-foreground', 'dock'],
  ['lesson-foreground', 'lesson-surface'],
  // T4.0 fix round 2 (I1/I2): `--warning`/`--destructive` are fill tokens
  // (correctly gated above, in UI_TIER, as fills) and are also used as
  // *text* at live call sites (a lesson verdict, a form error) where they
  // measure Lc 25-32 -- a WCAG 1.4.3 failure. The fill tokens stay
  // untouched; these are the dedicated text-role tokens `text-warning`/
  // `text-destructive` resolve to instead (globals.css's `@layer
  // utilities` override), gated at the same body tier as any other small
  // text on `--background` and `--card`.
  ['warning-text', 'background'],
  ['warning-text', 'card'],
  ['destructive-text', 'background'],
  ['destructive-text', 'card'],
]

const UI_TIER: [string, string][] = [
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['celebration-foreground', 'celebration'],
  ['accent-foreground', 'accent'],
  // T4.0 fix round (F/M4): streak and XP are structurally identical
  // saturated-fill/foreground pairs to the six above, new in wave 4 (§2.2)
  // and untested until now.
  ['streak-foreground', 'streak'],
  ['xp-foreground', 'xp'],
]

/** APCA-only, per Ruling 1: decorative dividers, not focus indicators.
 *  `input` is NOT here (T4.0 fix round, I3 follow-up): it draws a
 *  meaningful field boundary under WCAG 2.2 SC 1.4.11, the same reasoning
 *  I3 already applied to `ring`, so it gets the WCAG floor below instead of
 *  living in the APCA-only decorative tier with `border`. */
const DIVIDER_APCA_ONLY: [string, string][] = [
  ['border', 'background'],
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

  it('I3 follow-up (T4.0 fix round): field border (input/background) clears APCA Lc 45 AND WCAG 3:1 (SC 1.4.11 -- an input outline is a UI component, not a decorative divider)', () => {
    const fg = resolve(tokens, 'input')
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

  it('§2.2: rule sits closer to background than border does, in OKLCH lightness (T4.0 fix round, F5: the APCA-Lc version of this ordering is vacuous in every dark theme, where a hairline this close to background clips to Lc 0 on both sides -- ΔL is non-degenerate in all five palettes)', () => {
    const bg = resolve(tokens, 'background')
    expect(deltaL(resolve(tokens, 'rule'), bg)).toBeLessThan(deltaL(resolve(tokens, 'border'), bg))
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

  it('W4.6: every authored oklch() value round-trips into sRGB ([-0.001, 1.001] per channel), including one nested inside a compound value like --elevation-*', () => {
    // T4.0 fix round (M7): matching only `raw.startsWith('oklch(')` skipped
    // every oklch() embedded in a shadow/gradient shorthand (--elevation-md's
    // `inset 0 1px 0 0 oklch(...), 0 4px 10px oklch(...)`, Arcade's glow).
    // Matching every oklch(...) substring instead covers those too.
    for (const [key, raw] of Object.entries(tokens)) {
      const matches = raw.match(/oklch\([^)]*\)/g)
      if (!matches) continue
      for (const oklchValue of matches) {
        expect(isInGamut(oklchValue), `[data-theme="${id}"] --${key}: ${oklchValue} (in "${raw}") is out of gamut`).toBe(true)
      }
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

  // T4.0 fix round (F6): spec §2.4 fixes three more rungs of the same
  // surface ladder in the four darks -- popover a further 0.03 above card,
  // --lesson-surface at 0.055, --dock at 0.08 -- and none of them had an
  // assertion. All pass today; this is coverage for the retune that flattens
  // one onto its neighbour with nothing failing.
  it.each(DARK_IDS)('%s: ΔL(popover, card) is close to 0.03', (id) => {
    const tokens = THEMES[id]
    const d = deltaL(resolve(tokens, 'popover'), resolve(tokens, 'card'))
    expect(d).toBeCloseTo(0.03, 2)
  })

  it.each(DARK_IDS)('%s: ΔL(lesson-surface, background) is close to 0.055', (id) => {
    const tokens = THEMES[id]
    const d = deltaL(resolve(tokens, 'lesson-surface'), resolve(tokens, 'background'))
    expect(d).toBeCloseTo(0.055, 3)
  })

  it.each(DARK_IDS)('%s: ΔL(dock, background) is at least 0.08', (id) => {
    const tokens = THEMES[id]
    const d = deltaL(resolve(tokens, 'dock'), resolve(tokens, 'background'))
    expect(d).toBeGreaterThanOrEqual(0.08 - 1e-9)
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

// A11Y-01 (wave 2 review, section 7): 15 `focus-visible:ring-emerald-300`
// sites measured 1.39:1 on Paper/Folio -- invisible keyboard focus on the
// shell header, onboarding and Account -- plus three `text-emerald-200`
// links at 1.17:1 there and one `bg-emerald-300` state fill that made
// ring-vs-control 1.00:1. All were swapped for theme tokens (`ring-ring`,
// `text-primary`/`text-success`, `bg-primary`) in the files this fix lane
// owns; this is the "source-scan assertion" the review's fix prescribes,
// scoped to exactly those files rather than the whole tree.
//
// Deliberately NOT a tree-wide gate, and NOT folded into T4.1's own
// `palette-classes` allowlist (`src/lib/design/allowlist.ts`): that rule is
// path-prefix scoped, and every prefix this lane's files sit under
// (`src/components/shell`, `src/app/(app)/account`, `src/app/(app)/
// dashboard`, `src/app/(app)/courses`, `src/components/course`,
// `src/app/(app)/onboarding`, `src/app/(app)/reports`, `src/components/
// wellness`) still carries other, real palette-class debt in sibling files
// this lane does not own (e.g. `PrayerTimes.tsx`, `DockControl.tsx`,
// `NodeItem.tsx`) that Wave 4's own screen sweeps (T4.5/T4.6/T4.9) are
// still mid-flight on -- concurrently, in this same tree, while this lane
// ran. Deleting or narrowing those prefix entries here would either be a
// no-op (debt remains) or falsely claim a prefix clean when it is not, and
// `src/lib/design/allowlist.ts` was itself being actively rewritten by
// T4.1's own fix round during this lane's work. This assertion is the
// honestly-scoped alternative: it names exactly the files this lane fixed
// and holds them at zero, permanently, regardless of what the broader gate
// still allows elsewhere.
describe('A11Y-01: the tokens the fix lane routed every swept ring/link/fill to actually clear the floor, on both background and card, in all five palettes', () => {
  it.each(THEME_IDS)('%s: ring clears WCAG 3:1 (SC 1.4.11) on both background and card', (id) => {
    const tokens = THEMES[id]
    const ring = resolve(tokens, 'ring')
    expect(wcagRatio(ring, resolve(tokens, 'background'))).toBeGreaterThanOrEqual(3)
    expect(wcagRatio(ring, resolve(tokens, 'card'))).toBeGreaterThanOrEqual(3)
  })

  it.each(THEME_IDS)('%s: primary -- the token every swept link/border/fill now resolves to -- clears WCAG 4.5:1 as text on both background and card', (id) => {
    const tokens = THEMES[id]
    const primary = resolve(tokens, 'primary')
    expect(wcagRatio(primary, resolve(tokens, 'background'))).toBeGreaterThanOrEqual(4.5)
    expect(wcagRatio(primary, resolve(tokens, 'card'))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('A11Y-01: the shell header, Account, dashboard, courses, onboarding, reports and wellness-dock surfaces this fix lane swept carry no raw focus-ring, link-text or state-fill palette class', () => {
  const SCANNED_FILES: string[][] = [
    ['components', 'shell', 'AppShell.tsx'],
    ['components', 'shell', 'ShellHeaderControls.tsx'],
    ['app', '(app)', 'account', 'page.tsx'],
    // G6 (W2FIX-G fix round): the server half of the route -- still real
    // markup at b67d9b7 (this lane's own commit), and one of the review's 15
    // named A11Y-01 sites -- was missing from this list entirely.
    ['app', '(app)', 'courses', 'page.tsx'],
    // A concurrent lane (V7, wave 2 review) split this route's markup out of
    // `page.tsx` into `CoursesClient.tsx` (a server/client split so the seed
    // JSON's authoring note stays server-only) partway through this fix
    // lane's own work; `page.tsx` is now a thin wrapper with no classes of
    // its own, and the real focus-ring fix lives in the file below.
    ['app', '(app)', 'courses', 'CoursesClient.tsx'],
    ['app', '(app)', 'dashboard', 'page.tsx'],
    ['app', '(app)', 'onboarding', 'page.tsx'],
    ['app', '(app)', 'reports', 'page.tsx'],
    ['components', 'wellness', 'Dock.tsx'],
    ['components', 'course', 'CourseCard.tsx'],
    ['app', 'preview', 'sections', 'OnboardingSection.tsx'],
    ['app', 'preview', 'sections', 'ShellDashboardSection.tsx'],
  ]
  // Exactly the review's own prescribed shape: (ring|bg|text|border|fill|
  // stroke)-<hue>-<shade>. Deliberately excludes `from-`/`to-`/`via-`
  // gradient stops (e.g. dashboard's `from-emerald-200/[0.06]`) -- those are
  // real debt too, but outside the review's named regex and this lane's
  // named findings; they stay with Wave 4's broader 81-class sweep.
  const RAW_PALETTE_RE =
    /\b(ring|bg|text|border|fill|stroke)-(emerald|amber|red|green|blue|slate|zinc|gray|neutral|stone|sky|violet|rose|orange|yellow|lime|teal|cyan|indigo|purple|fuchsia|pink)-\d+\b/g

  // G6 (fix round): `CoursesClient.tsx` did not exist at this lane's own
  // commit -- a concurrent split landed it two commits later -- so a plain
  // `readFileSync` here threw `ENOENT` on that exact commit, and would throw
  // again the moment any Wave 4 screen sweep (several are mid-flight on
  // `Dock.tsx`/`CourseCard.tsx` right now) renames or deletes an entry.
  // Missing files are now skipped and counted instead of thrown on, so a
  // rename is a legible failed assertion (a stale path in this list) rather
  // than an exception that aborts the whole file's tests, and the count is
  // asserted at zero so a genuine rename can't silently drop coverage either.
  it('every scanned file that exists is clean, and none of them are missing', () => {
    const violations: string[] = []
    const missing: string[] = []
    for (const segments of SCANNED_FILES) {
      const path = join(SRC_DIR, ...segments)
      if (!existsSync(path)) { missing.push(segments.join('/')); continue }
      const content = readFileSync(path, 'utf8')
      const matches = content.match(RAW_PALETTE_RE)
      if (matches) violations.push(`${segments.join('/')}: ${matches.join(', ')}`)
    }
    expect(missing, 'scanned path no longer exists -- update SCANNED_FILES').toEqual([])
    expect(violations).toEqual([])
  })
})

describe('F4/M3 (T4.0 fix round 3): wellness/prefs.ts THEME_NAMES stays derived from the registry', () => {
  // The re-check's sixth-palette probe found this list unguarded: adding a
  // theme to `THEMES` without also editing this array produced zero
  // failure anywhere, and a stored `wellness.prefs.theme` for the new id
  // would silently fall back to the default. `THEME_NAMES` is now
  // `THEMES.map(t => t.id)` (see wellness/prefs.ts); this pins that fact
  // so a future edit back to a hand-enumerated list fails here first.
  it('THEME_NAMES equals the THEMES registry ids, in the same order', () => {
    expect(WELLNESS_THEME_NAMES).toEqual(PICKER_THEMES.map((t) => t.id))
  })
})

describe('N1 (T4.0 fix round 3): .display-caps declares an explicit font-weight', () => {
  // Fix round 2 self-hosted Archivo/Newsreader as *static* instances (no
  // `fvar`), which silently made this utility's `font-variation-settings:
  // 'wdth' 118, 'wght' 850` inert -- with no `font-weight` of its own, the
  // element inherited body's 400 and CSS Fonts 4's face-matching algorithm
  // resolved that to the 700 face, not the 850/`wdth 118` one this utility
  // exists to render (measured live: 22.4% narrower). A plain regex on the
  // utility's own declaration block is a cheap, permanent gate against that
  // regressing again, independent of which font backs `--font-display`.
  it('the @utility display-caps block in globals.css declares font-weight: 850', () => {
    const match = /@utility\s+display-caps\s*\{([^}]*)\}/.exec(css)
    expect(match, 'globals.css: no @utility display-caps block found').toBeTruthy()
    const body = match![1]
    expect(/font-weight:\s*850\s*;/.test(body), `@utility display-caps has no font-weight: 850 declaration:\n${body}`).toBe(true)
  })
})

describe('N2 (T4.0 fix round 3): text-warning / text-destructive stay bare -- no variant or opacity modifier resolves through the fill token', () => {
  // The `@layer utilities` override in this file redirects exactly the two
  // bare selectors (base class, no variant prefix, no opacity suffix) to
  // the new text-role tokens. Tailwind still holds the fill tokens in
  // `@theme inline`, so any *other* spelling of the same two utilities --
  // a state-variant prefix (a pseudo-class or dark-mode selector joined by
  // a colon) or an opacity suffix (a slash followed by digits) -- compiles
  // to its own selector generated straight from the fill token and is not
  // covered by the override, silently reintroducing the WCAG 1.4.3
  // failure I1/I2 fixed. This scans every `.ts`/`.tsx` file under `src/`
  // (not just the files this round touched) so a future screen sweep
  // (T4.4-T4.9) trips it the moment one such spelling is written.
  //
  // (Deliberately not spelling out a live example of either shape in this
  // comment: earlier drafts did, and the scan below matched its own
  // documentation.)
  const VARIANT_OR_OPACITY_RE = /(?:[\w-]+:)+text-(?:warning|destructive)\b(?!-)|text-(?:warning|destructive)\/\d{1,3}\b(?!-)/g

  function listSourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...listSourceFiles(full))
      else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) out.push(full)
    }
    return out
  }

  it('no file under src/** uses a variant-prefixed or opacity-modified text-warning/text-destructive class', () => {
    const violations: string[] = []
    for (const file of listSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8')
      const matches = content.match(VARIANT_OR_OPACITY_RE)
      if (matches) violations.push(`${file.slice(SRC_DIR.length + 1).replace(/\\/g, '/')}: ${matches.join(', ')}`)
    }
    expect(violations).toEqual([])
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
