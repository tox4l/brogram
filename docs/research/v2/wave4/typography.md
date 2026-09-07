<!-- Wave 4 research lane, compiled 2026-09-07. Copied verbatim from the lane agent's report. -->

> **Lane:** typography. **Date:** 2026-09-07. **Status:** research input, not a decision.
> **Scope.** Display and text faces for five palettes, monospace, tabular figures, the type scale, weight per state, and `next/font` self-hosting mechanics.
> **Decisions taken from it** live in `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md`;
> where this file and that spec disagree, **the spec wins** and says why.
>
> **Primary sources**
> - connary.com/fonts/integral — Integral CF pricing and the page-view-tiered annual web licence
> - fontshare.com/licenses/itf-ffl — why every Fontshare face is ruled out (no self-hosting, no redistribution)
> - google/fonts METADATA.pb for Archivo, Anybody, Instrument Serif, Newsreader, Fraunces — real axis ranges under OFL 1.1
> - github.com/vercel/geist-font LICENSE.txt and issue #157 — Geist is OFL 1.1; the slashed-zero set is inverted
> - developer.mozilla.org — font-variant-numeric (silently no-ops without the feature), @font-face size-adjust
> - node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md and 03-api-reference/02-components/font.md — axes are excluded by default; output lands in .next/static/media, never public/

---
# Wave 4 — Typography and licensing

Lane scope: display and text faces for five palettes, monospace, tabular figures, type scale, weights per state, and self-hosting mechanics. Fact and taste are separated per section.

## 0. Ground truth from the repo

- `src/app/layout.tsx` loads `Geist` and `Geist_Mono` from `next/font/google`, `display: "swap"`, explicit `fallback` arrays; `src/app/globals.css:94-96` maps them to `--font-sans`, `--font-mono`, `--font-heading` in `@theme inline`.
- **`next/font` output does not touch `public/`.** Subsets land in `.next/static/media/*.woff2` — verified: 11 files, **164 KB total** for both Geist families. `.gitignore:13` ignores `.next/`; tracked `public/` is **1.4 MB** of 3 MB. Fonts consume none of that budget; the real constraint is first-paint network weight. Keep `next/font/local` sources in `src/app/fonts/`, also outside `public/`.
- Plan §2 rule 7 is *"Geist, never Inter."* Any added face is an amendment under §2 rule 4 (frozen contracts, two-reviewer PR). Flagged, not decided here.
- Spec §10.5 item 34: verdicts pair colour with a glyph **and** a word. Weight and colour are never the sole carrier of state.

## 1. (a) Dark cinematic display — Integral CF and free equivalents

**Integral CF** (Connary Fagen, 2017; wide, heavy, flat-sided geometric caps). Publisher pricing: single style **$29.99**, *Integral Essentials* (4 styles) **$69.99**, *Integral Family* (12 styles) **$221.99** ([connary.com](https://connary.com/fonts/integral/)); licences split Desktop / Web (yearly, tiered by monthly pageviews 10k–2M+) / App (yearly). MyFonts/Fonts.com list desktop and web at **$35** per style ([fonts.com](https://www.fonts.com/en/font/connary-fagen/integral-cf)). **The web licence is an annual subscription and the files may not be redistributed** — incompatible with committing binaries to an MIT public repo. Buying it means gitignoring the licensed `.woff2`, injecting it at build, and still shipping a free fallback.

Free equivalents, ranked (all **SIL OFL 1.1**, redistributable inside an MIT repo):

1. **Archivo** (Omnibus-Type) — variable, `wdth` **62–125**, `wght` **100–900** ([METADATA.pb](https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/METADATA.pb)). At `wdth 118 / wght 850`, uppercase: same grotesque skeleton, flat sidewalls and closed apertures as Integral CF Heavy. Closest match. **Recommended.**
2. **Anybody** (Tyler Finck) — variable, `wdth` **50–150**, `wght` **100–900**, sans-serif + display ([METADATA.pb](https://raw.githubusercontent.com/google/fonts/main/ofl/anybody/METADATA.pb)). Wider extremes, more overtly "poster"; use only if Archivo at 125 reads tame.
3. **Archivo Black** — the static 900 cut, as an axis-handling fallback.

**Ruled out: everything on Fontshare** (Clash Display, Tanker, Satoshi). The ITF Free Font License permits commercial use but **restricts redistributing or self-hosting the raw files**, expecting delivery via Fontshare's CDN ([fontshare.com/licenses/itf-ffl](https://www.fontshare.com/licenses/itf-ffl)). That breaks both MIT redistribution and `next/font` self-hosting.

## 2. (b) White palette — editorial serif

- **Newsreader** (Production Type; OFL) — variable `opsz` **6–72**, `wght` **200–800**, true italic ([METADATA.pb](https://raw.githubusercontent.com/google/fonts/main/ofl/newsreader/METADATA.pb)). The optical-size axis is the reason to pick it: one file gives a different letterform at 14 px than at 56 px. **Recommended for both display and running text in the white palette.**
- **Instrument Serif** (Fuenzalida, Egstad; OFL) — **Regular + Italic only, weight 400, no axes** ([METADATA.pb](https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/METADATA.pb)). High-contrast and unmistakably editorial, but no bold, so display-only at ≥32 px.
- **Fraunces** (Undercase Type; OFL) — `opsz` 9–144, `wght` 100–900, plus `SOFT`/`WONK` ([METADATA.pb](https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/METADATA.pb)). More characterful; `WONK` is a liability at body sizes. Second choice.

*Taste:* Newsreader at `opsz 56` for the hero, Instrument Serif only if one line needs more drama.

## 3. (c) Workhorse text face

**Keep Geist Sans.** SIL OFL 1.1 (Vercel + basement.studio, [LICENSE.TXT](https://github.com/vercel/geist-font/blob/main/LICENSE.txt)), not Inter, already satisfies §2 rule 7, already loaded and metric-tuned. Its neo-grotesque neutrality is what lets a wide-heavy Archivo *or* a Newsreader italic sit above it without argument. Swapping it buys nothing and risks 840 green tests. **Caveat to verify:** a secondary source claims the Google Fonts build of Geist ships an incomplete OpenType table versus the npm/ZIP release ([lexingtonthemes.com](https://lexingtonthemes.com/blog/geist-opentype-features)). If `tnum` is absent, swap `next/font/google` → `next/font/local` against the OFL files in `vercel/geist-font`.

## 4. (d) Monospace

**Keep Geist Mono.** Drawn for code editors and terminals, OFL, metrically paired with Geist Sans, and it carries a slashed-zero stylistic set — `ss09`, whose polarity is inverted ([vercel/geist-font#157](https://github.com/vercel/geist-font/issues/157)), so verify the rendered glyph rather than trusting the name.

The one credible challenger is **JetBrains Mono** (OFL-1.1, 8 weights 100–800, variable, optional ligatures, [github.com/JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono)), whose tall x-height is a real argument for lowercase-dense source. But switching adds a second mono family and breaks the Geist pairing. **Stay on Geist Mono, and disable `liga`/`calt` in the editor** so `!=`, `=>`, `->` never render as glyphs a beginner cannot type back.

## 5. (e) Tabular figures

`font-variant-numeric: tabular-nums` maps to `tnum`, `slashed-zero` to `zero`; both Baseline since Jan 2020, and both **silently no-op if the font lacks the feature** ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)) — so this needs a test, not a hope.

Monospace digits are fixed-advance by construction, so anything already in `--font-mono` (drill timers, reaction ms) needs nothing. The exposure is sans numerals: XP odometer, streak, score, chain counter, `mm:ss`. Without `tabular-nums` the odometer jitters horizontally on every tween of §7.8's integer-snap GSAP counter.

## 6. Type scale (Tailwind 4 `@theme` tokens)

Tailwind 4 reads `--text-*` plus paired `--text-*--line-height` / `--letter-spacing` sub-tokens. Add to the existing `@theme inline` block in `src/app/globals.css`:

```css
@theme inline {
  --font-display: var(--font-display-face), var(--font-sans);
  --font-serif:   var(--font-newsreader), Georgia, serif;

  --text-2xs:  0.75rem;  /* 12 */ --text-2xs--line-height: 1.4;  --text-2xs--letter-spacing: 0.06em;
  --text-xs:   0.875rem; /* 14 */ --text-xs--line-height: 1.5;
  --text-sm:   1rem;     /* 16 */ --text-sm--line-height: 1.6;
  --text-base: 1.125rem; /* 18 */ --text-base--line-height: 1.65;
  --text-lg:   1.5rem;   /* 24 */ --text-lg--line-height: 1.3;   --text-lg--letter-spacing: -0.01em;
  --text-xl:   2rem;     /* 32 */ --text-xl--line-height: 1.2;   --text-xl--letter-spacing: -0.015em;
  --text-2xl:  2.5rem;   /* 40 */ --text-2xl--line-height: 1.1;  --text-2xl--letter-spacing: -0.02em;
  --text-3xl:  3.5rem;   /* 56 */ --text-3xl--line-height: 1.05; --text-3xl--letter-spacing: -0.025em;
  --text-4xl:  4.5rem;   /* 72 */ --text-4xl--line-height: 1.0;  --text-4xl--letter-spacing: -0.03em;
}
```

Steps 12/14/16/18/24/32 are the `ui-ux-pro-max` scale verbatim; 40/56/72 extend it for display only. `--font-display-face` is redefined per `[data-theme]` alongside the colour tokens — **palette swaps the face, never the scale**, which is exactly "palettes only, the layout stays."

**Uppercase display inverts the tracking sign.** Negative tracking is for mixed-case at ≥24 px; all-caps Archivo at 56–72 px needs **+0.02em to +0.04em** or the counters close up. Apply via a `.display-caps` utility, never by editing scale tokens.

## 7. Weight per state

| Role | Family | Weight | Size | Tracking | Notes |
|---|---|---|---|---|---|
| Hero / celebration | `--font-display` | 800–900 (`wdth 118`) | 56–72 | +0.03em, uppercase | one per screen |
| h1 | `--font-display` | 700 | 32–40 | −0.015em | |
| h2 / h3 | `--font-sans` | 600 / 600 | 24 / 18 | −0.01em / 0 | |
| Body | `--font-sans` | 400 | 16–18 | 0 | measure 65–75ch |
| Muted / help | `--font-sans` | 400 | 14 | 0 | colour carries the demotion, not weight |
| Label / eyebrow | `--font-sans` | 500 | 12 | +0.06em, uppercase | |
| Code | `--font-mono` | 400 (500 for the guide's active line) | 14–16 | 0 | `liga: 0`, `calt: 0` |
| Verdict | `--font-sans` | 600 | 16 | 0 | **glyph + word + colour**, never weight alone (R34) |
| Numerals | inherits | 500 | — | 0 | `tabular-nums` mandatory |

Line height: 1.5–1.65 body, 1.4 at 12–14, 1.0–1.3 display. Measure: `max-width: 68ch` on prose; **never on code** (code wraps by its own rules).

## 8. Self-hosting without layout shift

`next/font` has built-in self-hosting and removes external network requests (local docs, `01-getting-started/13-fonts.md`). Mechanics that matter, from the local API reference (`02-components/font.md`):

- `subsets: ['latin']` — English only, so never `latin-ext`. Subsets with `preload: true` (default) get a `<link rel=preload>` injected.
- `axes: [...]` — **extra variable axes are excluded by default to keep file size down**. Archivo needs `axes: ['wdth']` explicitly; Newsreader needs `axes: ['opsz']`.
- `display: 'swap'` (current, correct). `'optional'` scores better on CLS but can drop the display face entirely on a slow first visit — unacceptable when the face *is* the palette.
- `adjustFontFallback` defaults to `true` (google) / `'Arial'` (local) and auto-generates the metric-matched fallback. Leave it on; set `adjustFontFallback: 'Times New Roman'` for the serif.
- `size-adjust` scales glyph advances, baseline tables and all metrics, with `ascent-override`/`descent-override`/`line-gap-override` applied after; Baseline since Sept 2023 ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust)). Reach for it via `declarations` on `next/font/local` only if the automatic fallback misses.

**Budget forecast:** 164 KB today; Archivo `[wdth,wght]` latin (~55 KB) plus Newsreader `[opsz,wght]` latin (~50 KB) lands near **270 KB of woff2, all in `.next/static/media/`, zero bytes against the 3 MB tracked-`public/` budget.** Preload only the active theme's faces; `preload: false` on the other display face, loaded on theme switch.

---

## Recommendations

1. **Do not ship Integral CF.** Annual pageview-tiered web licence, no redistribution; an MIT repo cannot commit the files. *Test:* no non-OFL font binary in `git ls-files`.
2. **Adopt Archivo (OFL) as the cinematic display face** — `next/font/google`, `axes: ['wdth']`, rendered at `font-variation-settings: 'wdth' 118, 'wght' 850`, uppercase. *Test:* snapshot asserts `wdth` in the emitted `@font-face`.
3. **Adopt Newsreader (OFL) as the white palette's serif** — `axes: ['opsz']`, `opsz` 56 display / 16 text. *Test:* `opsz` present, and no second serif family in the bundle.
4. **Reject every Fontshare face** (ITF FFL forbids self-hosting and redistribution). *Test:* lint fails on any `fontshare` string under `src/`.
5. **Keep Geist Sans and Geist Mono.** No workhorse or mono swap; preserves §2 rule 7 and the 840 tests.
6. **Amend plan §2 rule 7** to *"Geist for UI text and code; Archivo and Newsreader for display only; never Inter."* Two-reviewer PR per §2 rule 4. *Test:* rule text updated before any display face merges.
7. **Add `--font-display` and `--font-serif` to `@theme inline`; redefine `--font-display-face` per `[data-theme]`.** *Test:* every theme block defines `--font-display-face` and none redefines a `--text-*` token.
8. **`font-variant-numeric: tabular-nums` on every sans numeral** — odometer, streak, score, chain, `mm:ss`. *Test:* computed style on the odometer node, plus a width test of `111` vs `000` that fails loudly if the Google Fonts Geist build lacks `tnum`, forcing the `next/font/local` swap.
9. **Disable `liga` and `calt` in the CodeMirror theme** (`src/components/exercise/Editor.tsx:22`). *Test:* `font-feature-settings: 'liga' 0, 'calt' 0` present in the `.cm-scroller` rule.
10. **Uppercase display takes +0.02em to +0.04em; mixed-case ≥24 px takes −0.01em to −0.03em.** *Test:* `.display-caps` is the only place uppercase display is set.
11. **Keep `display: 'swap'`, `subsets: ['latin']` only, `adjustFontFallback` on, `preload: false` on the inactive display face.** *Test:* CLS ≤ 0.1 in Playwright; `.next/static/media/*.woff2` total ≤ 320 KB in CI.
12. **Verdicts never rely on weight or colour alone** — glyph + word + colour. *Test:* the verdict a11y test asserts a text node and a glyph node on both pass and fail.

## Sources

- https://connary.com/fonts/integral/
- https://www.fonts.com/en/font/connary-fagen/integral-cf
- https://www.typewolf.com/integral-cf
- https://www.fontshare.com/licenses/itf-ffl
- https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/anybody/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/newsreader/METADATA.pb
- https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/METADATA.pb
- https://github.com/vercel/geist-font/blob/main/LICENSE.txt
- https://github.com/vercel/geist-font/issues/157
- https://github.com/JetBrains/JetBrainsMono
- https://lexingtonthemes.com/blog/geist-opentype-features
- https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric
- https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust
- https://web.dev/articles/font-best-practices
- `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md`
