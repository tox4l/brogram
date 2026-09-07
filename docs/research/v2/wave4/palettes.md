<!-- Wave 4 research lane, compiled 2026-09-07. Copied verbatim from the lane agent's report. -->

> **Lane:** palettes. **Date:** 2026-09-07. **Status:** research input, not a decision.
> **Scope.** Five OKLCH palettes with every token value, run through a byte-for-byte port of `src/lib/theme/contrast.ts` and the tier set in `src/lib/theme/contrast.test.ts`.
> **Decisions taken from it** live in `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md`;
> where this file and that spec disagree, **the spec wins** and says why.
>
> **Primary sources**
> - w3.org/TR/css-color-4/#the-oklch-notation — browsers gamut-map by chroma reduction; contrast.ts clips per channel, so out-of-gamut authored values certify a colour nobody sees
> - git.apcacontrast.com/documentation/APCAeasyIntro.html — the Lc 75 / 60 / 45 / 30 / 15 tiers
> - fonts.google.com specimens plus github.com/productiontype/Newsreader and github.com/Omnibus-Type/Archivo — the two OFL display faces
> - Local computation: scratchpad/wave4/contrast.mjs, verified against the repo reference pair (black on white = WCAG 21.00, Lc 106.0)

---
# Wave 4 — Lane: five palettes

Every number below was run through a byte-for-byte port of `src/lib/theme/contrast.ts`
(`scratchpad/wave4/contrast.mjs`, verified against the repo's own reference pair: black on
white = WCAG 21.00, APCA Lc 106.0) and through the exact tier set in
`src/lib/theme/contrast.test.ts`, extended with the new tokens. Result: **all five themes
PASS body (WCAG 4.5 / Lc 75), UI (WCAG 3 / Lc 60), divider (Lc 45), ring (Lc 45 + WCAG 3),
and the success/warning ΔL ≥ 0.10 rule — with zero out-of-sRGB-gamut values.**

## Fact vs. taste

**Fact.** Integral CF is Connary Fagen's, sold per style at $29.99 / family $221.99 desktop,
web as a pageview-tiered yearly subscription — it cannot ship in an MIT repo
([connary.com](https://connary.com/fonts/integral/)). Archivo is a variable grotesque with
`wght` and `wdth` (ExtraCondensed→Expanded) axes under OFL 1.1
([google/fonts](https://github.com/google/fonts/blob/main/ofl/archivo/DESCRIPTION.en_us.html),
[Omnibus-Type](https://github.com/Omnibus-Type/Archivo)). Instrument Serif (Rodrigo
Fuenzalida, 2022) is a high-contrast display serif, one weight + italic, OFL
([Google Fonts](https://fonts.google.com/specimen/Instrument+Serif)). Newsreader is
Production Type's OFL variable serif with `opsz` 6–72 and `wght` 200–800, built for
continuous on-screen reading ([productiontype/Newsreader](https://github.com/productiontype/Newsreader)).
Geist Sans/Mono are OFL 1.1 ([vercel/geist-font](https://github.com/vercel/geist-font/blob/main/LICENSE.txt))
— note the readme lists **Inter** among its influences; it is not Inter, but the lineage is
real ([readme](https://github.com/vercel/geist-font/blob/main/readme.md)). APCA tiers:
Lc 75 = minimum for body columns, Lc 60 = non-column content text, Lc 45 = headlines /
fine pictograms, Lc 30 = placeholder and disabled, Lc 15 = discernible non-text
([APCA easy intro](https://git.apcacontrast.com/documentation/APCAeasyIntro.html)).

**Fact, and a live bug.** Nine shipped tokens exceed the sRGB gamut — e.g. Midnight
`--primary: oklch(0.78 0.16 264)` where the chroma ceiling at L 0.78 / h 264 is **0.111**.
`contrast.ts` clips per channel; CSS Color 4 §14.2 says browsers gamut-*map* by chroma
reduction, "producing a similar-looking but lower chroma colour"
([CSS Color 4](https://www.w3.org/TR/css-color-4/#the-oklch-notation)). The authored
numbers therefore do not describe what renders, and the gate certifies a colour nobody
sees. All values below sit on or under the ceiling.

**Taste.** Which four survive, the violet, and the serif.

## The set of five

Keep all four IDs — `ThemeName` (`src/lib/contracts.ts:578`) is persisted in
`WellnessPrefs.theme` and in `localStorage['brogram:theme']`, so a rename is a migration.
Evolve `paper` from cream-notebook into the white editorial theme (it already owns the
`prefers-color-scheme: light` seed in `seedInitialTheme`), relabel it **Folio**, and add
one ID: `eclipse`. `arcade` must stay untouched in role — it is the `prefers-contrast: more`
seed. The tempting cut is Amber, and it is the wrong cut: it is the only warm dark and the
only theme with its own radius (0.875rem). Eclipse and Arcade are both near-black but not
redundant — Arcade is maximum legibility with two neons; Eclipse is restraint with one.

**Midnight** — Cool graphite, a single indigo running through button, ring and XP bar.
It is the room you already work in at 2am, just tidier.

**Amber** — Warm dark, lamp on a desk, everything a half-step toward orange.
Nothing in it is cold, so nothing in it feels like homework.

**Eclipse** — Almost black, almost colourless, until one violet lights the thing you must
look at. It behaves like a cinema: the screen is dark so the picture can be bright.

**Arcade** — Pure black, cyan and magenta at full volume, every edge glowing.
It is loud on purpose and it is the easiest of the five to read.

**Folio** — Warm white ground, a whiter sheet floating on it, ink-black text, one indigo
mark. It reads like a well-set magazine, and the code sits in it like a printed listing.

## Tokens (all verified in-gamut and in-tier)

```css
/* Midnight — color-scheme: dark; --radius: 0.625rem */
--background:oklch(0.16 0.014 260); --foreground:oklch(0.96 0.005 260);
--card:oklch(0.20 0.016 260); --card-foreground:var(--foreground);
--popover:oklch(0.23 0.016 260); --popover-foreground:var(--foreground);
--primary:oklch(0.78 0.11 264);   --primary-foreground:oklch(0.15 0.02 264);
--secondary:oklch(0.27 0.014 260); --secondary-foreground:var(--foreground);
--muted:oklch(0.27 0.014 260);    --muted-foreground:oklch(0.88 0.02 260);
--accent:oklch(0.74 0.12 200);    --accent-foreground:oklch(0.15 0.02 200);
--destructive:oklch(0.55 0.22 25); --destructive-foreground:oklch(0.98 0.005 260);
--success:oklch(0.82 0.20 150);   --success-foreground:oklch(0.15 0.02 150);
--warning:oklch(0.58 0.11 85);    --warning-foreground:oklch(0.99 0.004 85);
--celebration:oklch(0.84 0.17 95); --celebration-foreground:oklch(0.16 0.02 95);
--streak:oklch(0.80 0.11 40);     --streak-foreground:oklch(0.16 0.02 40);
--xp:oklch(0.80 0.10 264);        --xp-foreground:oklch(0.15 0.02 264);
--border:oklch(0.72 0.02 260); --input:oklch(0.72 0.02 260/0.95); --ring:oklch(0.78 0.11 264/0.9);
--glow:oklch(0.78 0.11 264/0.35);
--lesson-surface:oklch(0.185 0.015 260); --lesson-foreground:oklch(0.95 0.006 260);
--lesson-code-surface:oklch(0.145 0.014 260); --guide:oklch(0.74 0.12 200);
--dock:oklch(0.215 0.016 260); --dock-foreground:oklch(0.95 0.006 260); --dock-border:oklch(0.70 0.02 260);
--code-keyword:oklch(0.86 0.08 300); --code-string:oklch(0.88 0.14 150); --code-number:oklch(0.88 0.10 75);
--code-comment:oklch(0.77 0.015 260); --code-function:oklch(0.88 0.06 250); --code-type:oklch(0.88 0.10 200);
--code-variable:oklch(0.94 0.008 260); --code-operator:oklch(0.88 0.06 30); --code-punct:oklch(0.85 0.01 260);
```

```css
/* Amber — dark; --radius: 0.875rem */
--background:oklch(0.17 0.02 55); --foreground:oklch(0.95 0.01 70);
--card:oklch(0.21 0.024 55); --popover:oklch(0.24 0.024 55);
--primary:oklch(0.78 0.148 55);  --primary-foreground:oklch(0.16 0.02 55);
--secondary:oklch(0.28 0.02 55); --muted:oklch(0.28 0.02 55); --muted-foreground:oklch(0.88 0.02 60);
--accent:oklch(0.80 0.115 35);   --accent-foreground:oklch(0.16 0.02 35);
--destructive:oklch(0.55 0.22 25); --destructive-foreground:oklch(0.98 0.005 70);
--success:oklch(0.82 0.19 145);  --success-foreground:oklch(0.16 0.02 145);
--warning:oklch(0.58 0.11 85);   --warning-foreground:oklch(0.99 0.004 85);
--celebration:oklch(0.86 0.13 80); --celebration-foreground:oklch(0.16 0.02 80);
--streak:oklch(0.80 0.11 40);    --streak-foreground:oklch(0.16 0.02 40);
--xp:oklch(0.80 0.13 60);        --xp-foreground:oklch(0.16 0.02 60);
--border:oklch(0.72 0.02 60); --input:oklch(0.72 0.02 60/0.95); --ring:oklch(0.78 0.148 55/0.9);
--glow:oklch(0.78 0.148 55/0.32);
--lesson-surface:oklch(0.195 0.022 55); --lesson-foreground:oklch(0.95 0.01 70);
--lesson-code-surface:oklch(0.155 0.02 55); --guide:oklch(0.80 0.115 35);
--dock:oklch(0.225 0.024 55); --dock-foreground:oklch(0.95 0.01 70); --dock-border:oklch(0.70 0.02 60);
--code-keyword:oklch(0.86 0.07 35); --code-string:oklch(0.88 0.13 145); --code-number:oklch(0.90 0.10 90);
--code-comment:oklch(0.77 0.015 60); --code-function:oklch(0.88 0.09 70); --code-type:oklch(0.88 0.09 200);
--code-variable:oklch(0.94 0.01 60); --code-operator:oklch(0.88 0.06 20); --code-punct:oklch(0.85 0.012 60);
```

```css
/* Eclipse — NEW. dark; --radius: 0.375rem */
--background:oklch(0.09 0.008 285); --foreground:oklch(0.97 0.004 285);
--card:oklch(0.13 0.010 285); --popover:oklch(0.16 0.012 285);
--primary:oklch(0.80 0.126 305); --primary-foreground:oklch(0.11 0.02 305);
--secondary:oklch(0.20 0.010 285); --muted:oklch(0.20 0.010 285); --muted-foreground:oklch(0.87 0.008 285);
--accent:oklch(0.84 0.06 300);   --accent-foreground:oklch(0.13 0.02 300);
--destructive:oklch(0.55 0.22 25); --destructive-foreground:oklch(0.98 0.004 285);
--success:oklch(0.82 0.19 152);  --success-foreground:oklch(0.13 0.02 152);
--warning:oklch(0.58 0.11 85);   --warning-foreground:oklch(0.99 0.004 85);
--celebration:oklch(0.84 0.09 305); --celebration-foreground:oklch(0.12 0.02 305);
--streak:oklch(0.80 0.11 40);    --streak-foreground:oklch(0.13 0.02 40);
--xp:oklch(0.80 0.126 305);      --xp-foreground:oklch(0.11 0.02 305);
--border:oklch(0.74 0.012 285); --input:oklch(0.74 0.012 285/0.95); --ring:oklch(0.80 0.126 305/0.9);
--glow:oklch(0.80 0.126 305/0.30);
--lesson-surface:oklch(0.115 0.009 285); --lesson-foreground:oklch(0.96 0.004 285);
--lesson-code-surface:oklch(0.105 0.008 285); --guide:oklch(0.80 0.126 305);
--dock:oklch(0.145 0.011 285); --dock-foreground:oklch(0.96 0.004 285); --dock-border:oklch(0.74 0.012 285);
--shader-a:oklch(0.09 0.008 285); --shader-b:oklch(0.16 0.045 305); /* WebGL gradient ends */
--code-keyword:oklch(0.87 0.075 305); --code-string:oklch(0.88 0.12 152); --code-number:oklch(0.90 0.09 90);
--code-comment:oklch(0.765 0.008 285); --code-function:oklch(0.88 0.055 265); --code-type:oklch(0.88 0.08 200);
--code-variable:oklch(0.95 0.005 285); --code-operator:oklch(0.86 0.05 20); --code-punct:oklch(0.85 0.008 285);
```

```css
/* Arcade — dark; --radius: 0.25rem */
--background:oklch(0.12 0 0); --foreground:oklch(0.99 0 0);
--card:oklch(0.16 0 0); --popover:oklch(0.19 0 0);
--primary:oklch(0.85 0.13 195); --primary-foreground:oklch(0.12 0 0);
--secondary:oklch(0.24 0 0); --muted:oklch(0.24 0 0); --muted-foreground:oklch(0.88 0 0);
--accent:oklch(0.84 0.10 350); --accent-foreground:oklch(0.12 0 0);
--destructive:oklch(0.55 0.22 25); --destructive-foreground:oklch(0.98 0 0);
--success:oklch(0.85 0.20 145); --success-foreground:oklch(0.12 0 0);
--warning:oklch(0.52 0.11 75);  --warning-foreground:oklch(0.99 0 0);
--celebration:oklch(0.88 0.15 95); --celebration-foreground:oklch(0.12 0 0);
--streak:oklch(0.80 0.11 40);   --streak-foreground:oklch(0.12 0 0);
--xp:oklch(0.85 0.13 195);      --xp-foreground:oklch(0.12 0 0);
--border:oklch(0.72 0 0); --input:oklch(0.72 0 0/0.95); --ring:oklch(0.85 0.13 195/0.75);
--glow:oklch(0.85 0.13 195/0.5);
--lesson-surface:oklch(0.15 0 0); --lesson-foreground:oklch(0.99 0 0);
--lesson-code-surface:oklch(0.13 0 0); --guide:oklch(0.85 0.13 195);
--dock:oklch(0.17 0 0); --dock-foreground:oklch(0.99 0 0); --dock-border:oklch(0.72 0 0);
--code-keyword:oklch(0.86 0.085 350); --code-string:oklch(0.90 0.15 145); --code-number:oklch(0.92 0.10 95);
--code-comment:oklch(0.78 0 0); --code-function:oklch(0.88 0.10 195); --code-type:oklch(0.90 0.045 250);
--code-variable:oklch(0.99 0 0); --code-operator:oklch(0.88 0.06 25); --code-punct:oklch(0.86 0 0);
```

```css
/* Folio — the `paper` slot, evolved. light; --radius: 0.25rem */
--background:oklch(0.985 0.004 85); --foreground:oklch(0.21 0.012 60);
--card:oklch(1 0 0); --popover:oklch(1 0 0);
--primary:oklch(0.40 0.12 275);  --primary-foreground:oklch(0.99 0.003 85);
--secondary:oklch(0.955 0.006 85); --muted:oklch(0.955 0.006 85); --muted-foreground:oklch(0.42 0.015 65);
--accent:oklch(0.92 0.03 275);   --accent-foreground:oklch(0.26 0.05 275);
--destructive:oklch(0.50 0.20 27); --destructive-foreground:oklch(0.99 0.003 85);
--success:oklch(0.46 0.11 155);  --success-foreground:oklch(0.99 0.003 85);
--warning:oklch(0.58 0.11 75);   --warning-foreground:oklch(0.99 0.003 85);
--celebration:oklch(0.48 0.11 60); --celebration-foreground:oklch(0.99 0.003 85);
--streak:oklch(0.50 0.14 40);    --streak-foreground:oklch(0.99 0.003 85);
--xp:oklch(0.40 0.12 275);       --xp-foreground:oklch(0.99 0.003 85);
--border:oklch(0.60 0.012 70); --input:oklch(0.66 0.012 70); --ring:oklch(0.40 0.12 275/0.8);
--glow:oklch(0.40 0.12 275/0.18);
--lesson-surface:oklch(1 0 0); --lesson-foreground:oklch(0.21 0.012 60);
--lesson-code-surface:oklch(0.965 0.006 85); --guide:oklch(0.40 0.12 275);
--dock:oklch(1 0 0); --dock-foreground:oklch(0.21 0.012 60); --dock-border:oklch(0.60 0.012 70);
--code-keyword:oklch(0.36 0.12 285); --code-string:oklch(0.38 0.09 155); --code-number:oklch(0.40 0.10 45);
--code-comment:oklch(0.48 0.012 70); --code-function:oklch(0.36 0.10 250); --code-type:oklch(0.38 0.06 200);
--code-variable:oklch(0.24 0.012 60); --code-operator:oklch(0.40 0.11 25); --code-punct:oklch(0.40 0.012 70);
```

Measured (Lc / WCAG): fg-on-bg 98.8/17.3, 96/16.5, 101/19.0, 106/19.7, 102/17.0;
ring-on-bg 53.7/7.9, 52/7.6, 55/8.6, 51/7.7, 75/5.3 (Midnight, Amber, Eclipse, Arcade, Folio).

## Type per theme

| Theme | Display | UI text | Prose | Mono |
|---|---|---|---|---|
| Midnight, Amber, Arcade | Geist Sans 600/700 | Geist Sans | Geist Sans | Geist Mono |
| Eclipse | **Archivo** var. `wdth 112, wght 800`, uppercase, `letter-spacing .02em` | Geist Sans | Geist Sans | Geist Mono |
| Folio | **Instrument Serif** Regular + Italic | Geist Sans | **Newsreader** var. `opsz 18–28, wght 400` | Geist Mono |

Archivo at `wdth 112 / wght 800` is the licence-clean stand-in for Integral CF's wide,
tightly-tracked capitals. If Integral CF is bought, it drops in as a private
`--font-display` override without touching the palettes.

## Recommendations

1. Keep IDs `midnight | amber | paper | arcade`; add `'eclipse'` to `ThemeName`
   (`src/lib/contracts.ts:578`). No stored preference migrates. Testable: existing
   `contracts.test.ts` fixtures still parse.
2. Relabel the `paper` entry in `themes.ts` to name `"Folio"` and repoint its palette to
   the Folio block. Testable: the `swatch` pin in `contrast.test.ts` ("swatches stay pinned")
   still passes with `['oklch(0.985 0.004 85)','oklch(0.40 0.12 275)','oklch(0.92 0.03 275)']`.
3. Adopt the values above verbatim. Testable: `contrast.test.ts` passes unchanged for all
   five blocks, including key-set parity and the `:root` mirror of Midnight.
4. Add a gamut assertion to `contrast.test.ts`: every `oklch()` in every block must round-trip
   to linear sRGB with all three channels in `[-0.001, 1.001]`. Testable — it fails today on
   nine shipped tokens, passes on the set above. Rationale: browsers gamut-map, `contrast.ts`
   clips, so out-of-gamut values make the gate certify an unrendered colour.
5. Add the new tokens to all five blocks: `--streak(-foreground)`, `--xp(-foreground)`,
   `--lesson-surface`, `--lesson-foreground`, `--lesson-code-surface`, `--guide`,
   `--dock(-foreground)`, `--dock-border`, `--shader-a`, `--shader-b`, plus `--code-*` (9).
   Register each in `@theme inline` as `--color-*`, same shape as `--color-celebration`.
6. Extend the test tiers: `lesson-foreground/lesson-surface` and `dock-foreground/dock` to
   BODY; `streak-foreground/streak` and `xp-foreground/xp` to UI; `dock-border/dock` to
   DIVIDER; `guide/lesson-code-surface` at WCAG ≥ 3:1 as non-text (SC 1.4.11).
7. Gate the `--code-*` palette at Lc 75 against `--lesson-code-surface`, except
   `--code-comment` at Lc 60 (APCA's "content text that is not body" tier). All values above
   clear it; comments land Lc 60.8–75.5, deliberately the quietest thing on screen.
8. Promote the ΔL ≥ 0.10 success/warning rule from Arcade-only to all five. It forced
   Midnight's `--warning` to a deep amber with light text (0.58 0.11 85) — the same fix the
   review already made for Arcade, applied consistently instead of once.
9. Ship the `--code-*` tokens as a single `HighlightStyle.define()` in
   `src/components/exercise/Editor.tsx` mapping `@lezer/highlight` tags
   (`keyword`/`controlKeyword`/`definitionKeyword` → `--code-keyword`; `string`/`character`
   → `--code-string`; `number`/`bool`/`atom` → `--code-number`; `comment`/`lineComment`/
   `blockComment` → `--code-comment`; `function(variableName)`/`function(propertyName)` →
   `--code-function`; `typeName`/`className` → `--code-type`; `variableName`/`propertyName`
   → `--code-variable`; `operator` → `--code-operator`; `punctuation`/`bracket` →
   `--code-punct`; `invalid` → `--destructive`). One style, five themes, no per-theme JS.
10. Load Archivo, Instrument Serif and Newsreader via `next/font/google` with
    `display:'swap'`, `preload:false`, `subsets:['latin']`, exposed as
    `--font-archivo` / `--font-instrument` / `--font-newsreader`; each `[data-theme]` block
    sets `--font-display` / `--font-prose` from them. Testable: a Midnight-only page load
    downloads zero extra font files (unused `@font-face` are never fetched), and tracked
    `public/` is unchanged at ≤ 3 MB.
11. Do not buy Integral CF for the repo. Keep `--font-display` as the single override point
    and document the licence terms in `docs/`. If purchased, the file stays gitignored.
12. Eclipse only: the WebGL background must interpolate `--shader-a` → `--shader-b`
    (ΔL 0.07) and be a lazy dynamic import outside the initial chunk, with the static CSS
    `radial-gradient` of the same two stops as both the reduced-motion and no-WebGL
    fallback. Testable: `prefers-reduced-motion: reduce` renders the gradient and never
    instantiates a GL context.
