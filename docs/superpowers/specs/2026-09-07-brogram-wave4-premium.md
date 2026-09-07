# BroGram Wave 4 — the premium presentation pass

**Date:** 2026-09-07
**Owner:** Musa (Velocity)
**Status:** Decided. Every open question in this document is answered and marked **Ruling**. Implementers build from this without asking.
**Extends, does not supersede:** `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` (v2). Every v2 ruling stands. Where this document narrows one — §7.8's motion split, §8.3's palettes, §8.7's type scale, §10's per-screen motion — it says so and gives the number.
**Evidence base:** `docs/research/v2/wave4/` — `typography.md`, `palettes.md`, `layout.md`, `motion.md`, `shaders.md`, `teaching.md`, `references.md`, and `directions.md` (three directions, two judges, the chosen synthesis).
**Ledger:** `openspec/changes/brogram-launch/tasks.md` gains a `wave4` section; each ruling below is one or more ledger rows.
**Plan:** `docs/superpowers/plans/2026-09-07-brogram-wave4-plan.md`.

---

## 0. The one-paragraph version

v2 gave the product a mechanism, a voice and four looks. It still reads as generated, because the design system exists and the screens ignore it: **506 raw `text-*` classes** against a scale used by zero components, **198 `font-medium` against 5 `font-normal`**, **81 hard-coded Tailwind palette classes** that no theme can touch, `--card` sitting **ΔL 0.04** off its own background so every card is a cage around a fill that does not exist, and a highlight band whose 1 px ring is scaled by `scaleY(n)` into a 3 px edge. This pass changes no route and no behaviour. It ships **five palettes** — Midnight, Amber, **Eclipse** (near-black, one violet, the lead), Arcade, **Folio** (warm white, Newsreader) — on one structure: an additive type scale with an 18 px tier the app has never had, eight spacing steps, three surfaces with fills that read, a `--rule` token so hairlines stop shouting, GSAP masked-line reveals rationed to named surfaces, one WebGL field that settles and freezes at 4500 ms and then deliberately loses its context, and a code-reading guide that moves through a worked example **only when the learner advances it**. Nothing loops while code is on screen; everything the celebration budget already licenses still fires.

---

## 1. What this pass is, and what it is not

### 1.1 Scope

**Pure presentation.** No route is added, removed or renamed. No hook changes what it returns. No contract field changes meaning. No agent trigger is touched. The only contract addition in the entire wave is one string literal — `'eclipse'` on `ThemeName` — and the only data-shape addition is optional and already authored in seed (`LessonSnippet.highlight`, §7.3).

**The test of the wave is a screenshot and a stopwatch.** If a reviewer cannot tell which of the five palettes a screenshot is in without reading the colours, the palettes failed. If a learner reaches the same place in the same number of clicks with the same result, the behaviour held.

### 1.2 The diagnosis, in numbers measured on `main` at 2026-09-07

| Measured | Value | Where |
|---|---|---|
| Raw `text-xs…4xl` classes | **506** | `src/app`, `src/components` |
| Components using the shipped `--text-*` scale | **0** | `globals.css:159-190` defines nine steps; nothing reads them |
| `font-medium` : `font-normal` | **198 : 5** | body prose is set at 500, so nothing is emphatic |
| Hard-coded Tailwind palette classes (`text-emerald-200`, `bg-emerald-300`, …) | **81** across 20 files | account 11, dashboard 9, CourseCard 6, login 5, exercise 4 — **these pixels do not change when the palette changes** |
| `wcagRatio(card, background)` | 1.072 Midnight, 1.077 Amber, 1.046 Arcade, 1.044 Paper | the card fill is not visible |
| `--elevation-*` call sites | **2** | `LevelBadge.tsx:50`, `Celebration.tsx:543` |
| Lesson prose measure | outer `max-w-3xl` (768) over inner `max-w-[45rem]` (720) | `LessonView.tsx:218,221` — the inner cap can never bind |
| Exercise brief column at 1280 px | ~200 px ≈ **28 characters** | `exercise/[id]/page.tsx:88` |
| Filled primary buttons on `/derot` | **6** | `derot/page.tsx:183` renders `variant: 'default'` per card |
| Worked-example guide band | `ring-1 ring-inset` + `rounded-md` under `scaleY(n)` | `WorkedBlock.tsx:56-61` — a three-line step renders 3 px edges and a smeared radius |
| `scripts/check-bundle-budget.mjs` | **does not exist** | `package.json` points `perf:bundle` at it |

### 1.3 Standing constraints, restated (they all hold)

Every rule in plan §2 of `2026-09-06-brogram-v2-plan.md` applies unchanged. The ones this wave can break by accident, restated so no task has to look them up:

1. **840+ existing tests stay green.** A task may change only the test files on its own row of the plan's licence table.
2. **The seven agent triggers are frozen.** Nothing here calls an agent. Nothing here mounts, tweens or reveals its way into one.
3. **The browser runs and grades code.** Untouched.
4. **Contracts are frozen** except the one-line `ThemeName` addition in W4.1.
5. **English only. No emoji in UI copy. No institution names.**
6. **Geist, never Inter** — amended by W4.6 to *"Geist for UI text and code; Archivo and Newsreader for display and, in Folio only, prose; never Inter."*
7. **MIT-licensable assets only.** Every face added is OFL 1.1. GSAP stays an npm dependency under its proprietary Standard "No Charge" licence, named correctly in third-party notices, never vendored.
8. **Juice fires at transitions, never during composition.** Nothing animates or sounds while the learner is typing or reading.
9. **Enforcement surfaces get no personality and no juice** — no motion, no sound, no shader on any lockdown, integrity or account-status surface, in either motion mode.
10. **Reduced motion is a resolved boolean** (`useReducedMotion()`), never `gsap.matchMedia()`.
11. **The celebration budget** (§7.8): 600–900 ms, positive moments only. Motion is `transform` and `opacity` only. Never `ease-in`, never `transition: all`, never animate `width`, `height`, `top` or `left`. Enter from `scale(0.95)`, never `scale(0)`. Exit is always faster than enter. Stagger 30–50 ms, total under 300 ms.
12. **WCAG 2.2 is pass/fail; APCA `Lc` is the second, advisory gate** — both enforced by `src/lib/theme/contrast.test.ts`.
13. **Tracked `public/` stays at or under 3 MB** (1,374,356 bytes today). `howler`, `canvas-confetti` and every line of WebGL stay out of the initial chunk.

**Ruling W4.0.** Where this spec and a lane report disagree, this spec wins, and §12 lists every place it overrules a lane with the measurement that decided it.

---

## 2. The five palettes

### 2.1 The set

| Id | Name | Ground | Character |
|---|---|---|---|
| `midnight` | **Midnight** | `oklch(0.16 0.014 260)` | Cool graphite, one indigo through button, ring and XP bar. The room you already work in at 2am, tidier. **Stays the seeded default.** |
| `amber` | **Amber** | `oklch(0.17 0.02 55)` | The only warm dark, and the only palette with its own radius (0.875rem). A lamp on a desk. |
| `eclipse` | **Eclipse** | `oklch(0.09 0.008 285)` | Almost black, almost colourless, until one violet lights the thing you must look at. **The design-of-record and the only palette with a shader and a wide display face.** |
| `arcade` | **Arcade** | `oklch(0.12 0 0)` | Pure black, cyan and magenta at full volume. Loud on purpose, measurably the easiest of the five to read, and the `prefers-contrast: more` seed. |
| `paper` | **Folio** | `oklch(0.972 0.006 85)` | Warm white ground, a white sheet on it, ink text, one indigo mark, Newsreader. A printed listing. |

**Ruling W4.1 — ids stay, the label moves.** `ThemeName` (`src/lib/contracts.ts:578`) gains `'eclipse'` and nothing else. `paper` is **relabelled** to "Folio" in `src/lib/theme/themes.ts` and repointed at the block in §2.3; it is never renamed, because `WellnessPrefs.theme` and `localStorage['brogram:theme']` persist the id and `resolveWellnessPrefs` falls back to `midnight` on an unknown one — a rename silently resets a stored preference. **No stored preference migrates.** Eclipse is opt-in from the picker; Midnight stays seeded; Arcade keeps the `prefers-contrast: more` seed and Folio keeps `prefers-color-scheme: light`.

**Ruling W4.2 — the de-hardcode sweep, and it is not optional.** 81 hard-coded Tailwind palette classes across 20 files (`text-emerald-200`, `bg-emerald-300`, `border-emerald-300`, `focus-visible:ring-emerald-300`, …) are pixels no palette can reach. Every one is replaced by the semantic token that carries its role — `--primary`, `--success`, `--accent`, `--ring`, `--celebration` — and a lint gate keeps the count at zero. **Five palettes are a lie until this lands**, so it is the wave's first task and everything else builds on top of it.

### 2.2 What is new in the token set

Added to **all five** blocks, registered in `@theme inline` as `--color-*` exactly the way `--color-celebration` already is:

`--rule`, `--streak`, `--streak-foreground`, `--xp`, `--xp-foreground`, `--lesson-surface`, `--lesson-foreground`, `--lesson-code-surface`, `--guide`, `--dock`, `--dock-foreground`, `--dock-border`, and nine `--code-*` (`keyword`, `string`, `number`, `comment`, `function`, `type`, `variable`, `operator`, `punct`). `--shader-a` and `--shader-b` carry real values in Eclipse only and are declared `transparent` in the other four, because key-set parity across the five blocks is an asserted rule and a token missing from one block is the classic half-themed bug.

`--rule` is the point of the exercise: `--border` keeps its Lc 45 gate and is reserved for **interactive** boundaries (inputs, buttons, focusable tiles, the ring). `--rule` is the decorative hairline — card outlines, separators, tab baselines, table rules — and WCAG 1.4.11 does not cover it. This single split is what turns Folio from boxes-on-cream into a page and stops the darks looking like wireframes.

### 2.3 Every token value

All five blocks below were run through a byte-for-byte port of `src/lib/theme/contrast.ts` against the tier set in `contrast.test.ts` extended with the new tokens and the new gates in §2.4. **Result: zero failures, zero out-of-gamut values.**

```css
/* Midnight — color-scheme: dark; --radius: 0.625rem */
--background:oklch(0.16 0.014 260);          --foreground:oklch(0.96 0.005 260);
--card:oklch(0.23 0.016 260);                --card-foreground:var(--foreground);
--popover:oklch(0.26 0.016 260);             --popover-foreground:var(--foreground);
--primary:oklch(0.78 0.11 264);              --primary-foreground:oklch(0.15 0.02 264);
--secondary:oklch(0.27 0.014 260);           --secondary-foreground:var(--foreground);
--muted:oklch(0.27 0.014 260);               --muted-foreground:oklch(0.86 0.016 260);
--accent:oklch(0.74 0.12 200);               --accent-foreground:oklch(0.15 0.02 200);
--destructive:oklch(0.55 0.22 25);           --destructive-foreground:oklch(0.98 0.005 260);
--success:oklch(0.82 0.20 150);              --success-foreground:oklch(0.15 0.02 150);
--warning:oklch(0.58 0.11 85);               --warning-foreground:oklch(0.99 0.004 85);
--celebration:oklch(0.84 0.17 95);           --celebration-foreground:oklch(0.16 0.02 95);
--streak:oklch(0.80 0.11 40);                --streak-foreground:oklch(0.16 0.02 40);
--xp:oklch(0.80 0.10 264);                   --xp-foreground:oklch(0.15 0.02 264);
--border:oklch(0.72 0.02 260);  --input:oklch(0.72 0.02 260/0.95);  --ring:oklch(0.78 0.11 264/0.9);
--rule:oklch(0.34 0.016 260);   --glow:oklch(0.78 0.11 264/0.35);
--lesson-surface:oklch(0.215 0.015 260);     --lesson-foreground:oklch(0.95 0.006 260);
--lesson-code-surface:oklch(0.145 0.014 260);--guide:oklch(0.74 0.12 200);
--dock:oklch(0.24 0.016 260);   --dock-foreground:oklch(0.95 0.006 260);  --dock-border:oklch(0.70 0.02 260);
--code-keyword:oklch(0.86 0.08 300);  --code-string:oklch(0.88 0.14 150);  --code-number:oklch(0.88 0.10 75);
--code-comment:oklch(0.77 0.015 260); --code-function:oklch(0.88 0.06 250);--code-type:oklch(0.88 0.10 200);
--code-variable:oklch(0.94 0.008 260);--code-operator:oklch(0.88 0.06 30); --code-punct:oklch(0.85 0.01 260);
```

```css
/* Amber — color-scheme: dark; --radius: 0.875rem (unchanged, its own) */
--background:oklch(0.17 0.02 55);            --foreground:oklch(0.95 0.01 70);
--card:oklch(0.24 0.024 55);                 --card-foreground:var(--foreground);
--popover:oklch(0.27 0.024 55);              --popover-foreground:var(--foreground);
--primary:oklch(0.78 0.148 55);              --primary-foreground:oklch(0.16 0.02 55);
--secondary:oklch(0.27 0.02 55);             --secondary-foreground:var(--foreground);
--muted:oklch(0.27 0.02 55);                 --muted-foreground:oklch(0.86 0.018 60);
--accent:oklch(0.80 0.115 35);               --accent-foreground:oklch(0.16 0.02 35);
--destructive:oklch(0.55 0.22 25);           --destructive-foreground:oklch(0.98 0.005 70);
--success:oklch(0.82 0.19 145);              --success-foreground:oklch(0.16 0.02 145);
--warning:oklch(0.58 0.11 85);               --warning-foreground:oklch(0.99 0.004 85);
--celebration:oklch(0.86 0.13 80);           --celebration-foreground:oklch(0.16 0.02 80);
--streak:oklch(0.80 0.11 40);                --streak-foreground:oklch(0.16 0.02 40);
--xp:oklch(0.80 0.13 60);                    --xp-foreground:oklch(0.16 0.02 60);
--border:oklch(0.72 0.02 60);   --input:oklch(0.72 0.02 60/0.95);   --ring:oklch(0.78 0.148 55/0.9);
--rule:oklch(0.35 0.024 55);    --glow:oklch(0.78 0.148 55/0.32);
--lesson-surface:oklch(0.225 0.022 55);      --lesson-foreground:oklch(0.95 0.01 70);
--lesson-code-surface:oklch(0.155 0.02 55);  --guide:oklch(0.80 0.115 35);
--dock:oklch(0.25 0.024 55);    --dock-foreground:oklch(0.95 0.01 70);   --dock-border:oklch(0.70 0.02 60);
--code-keyword:oklch(0.86 0.07 35);   --code-string:oklch(0.88 0.13 145); --code-number:oklch(0.90 0.10 90);
--code-comment:oklch(0.77 0.015 60);  --code-function:oklch(0.88 0.09 70);--code-type:oklch(0.88 0.09 200);
--code-variable:oklch(0.94 0.01 60);  --code-operator:oklch(0.88 0.06 20);--code-punct:oklch(0.85 0.012 60);
```

```css
/* Eclipse — NEW. color-scheme: dark; --radius: 0.375rem */
--background:oklch(0.09 0.008 285);          --foreground:oklch(0.97 0.004 285);
--card:oklch(0.16 0.010 285);                --card-foreground:var(--foreground);
--popover:oklch(0.19 0.012 285);             --popover-foreground:var(--foreground);
--primary:oklch(0.80 0.126 305);             --primary-foreground:oklch(0.11 0.02 305);
--secondary:oklch(0.22 0.010 285);           --secondary-foreground:var(--foreground);
--muted:oklch(0.22 0.010 285);               --muted-foreground:oklch(0.85 0.008 285);
--accent:oklch(0.84 0.06 300);               --accent-foreground:oklch(0.13 0.02 300);
--destructive:oklch(0.55 0.22 25);           --destructive-foreground:oklch(0.98 0.004 285);
--success:oklch(0.82 0.19 152);              --success-foreground:oklch(0.13 0.02 152);
--warning:oklch(0.58 0.11 85);               --warning-foreground:oklch(0.99 0.004 85);
--celebration:oklch(0.84 0.09 305);          --celebration-foreground:oklch(0.12 0.02 305);
--streak:oklch(0.80 0.11 40);                --streak-foreground:oklch(0.13 0.02 40);
--xp:oklch(0.80 0.126 305);                  --xp-foreground:oklch(0.11 0.02 305);
--border:oklch(0.74 0.012 285); --input:oklch(0.74 0.012 285/0.95); --ring:oklch(0.80 0.126 305/0.9);
--rule:oklch(0.28 0.012 285);   --glow:oklch(0.80 0.126 305/0.30);
--lesson-surface:oklch(0.145 0.009 285);     --lesson-foreground:oklch(0.96 0.004 285);
--lesson-code-surface:oklch(0.105 0.008 285);--guide:oklch(0.80 0.126 305);
--dock:oklch(0.175 0.011 285);  --dock-foreground:oklch(0.96 0.004 285); --dock-border:oklch(0.74 0.012 285);
--shader-a:oklch(0.09 0.008 285); --shader-b:oklch(0.16 0.045 305);  /* the only two colours the GLSL sees */
--code-keyword:oklch(0.87 0.075 305); --code-string:oklch(0.88 0.12 152);--code-number:oklch(0.90 0.09 90);
--code-comment:oklch(0.765 0.008 285);--code-function:oklch(0.88 0.055 265);--code-type:oklch(0.88 0.08 200);
--code-variable:oklch(0.95 0.005 285);--code-operator:oklch(0.86 0.05 20);--code-punct:oklch(0.85 0.008 285);
```

```css
/* Arcade — color-scheme: dark; --radius: 0.25rem. The prefers-contrast: more seed. */
--background:oklch(0.12 0 0);                --foreground:oklch(0.99 0 0);
--card:oklch(0.19 0 0);                      --card-foreground:var(--foreground);
--popover:oklch(0.22 0 0);                   --popover-foreground:var(--foreground);
--primary:oklch(0.85 0.13 195);              --primary-foreground:oklch(0.12 0 0);
--secondary:oklch(0.26 0 0);                 --secondary-foreground:var(--foreground);
--muted:oklch(0.26 0 0);                     --muted-foreground:oklch(0.88 0 0);
--accent:oklch(0.84 0.10 350);               --accent-foreground:oklch(0.12 0 0);
--destructive:oklch(0.55 0.22 25);           --destructive-foreground:oklch(0.98 0 0);
--success:oklch(0.85 0.20 145);              --success-foreground:oklch(0.12 0 0);
--warning:oklch(0.52 0.11 75);               --warning-foreground:oklch(0.99 0 0);
--celebration:oklch(0.88 0.15 95);           --celebration-foreground:oklch(0.12 0 0);
--streak:oklch(0.80 0.11 40);                --streak-foreground:oklch(0.12 0 0);
--xp:oklch(0.85 0.13 195);                   --xp-foreground:oklch(0.12 0 0);
--border:oklch(0.72 0 0);       --input:oklch(0.72 0 0/0.95);      --ring:oklch(0.85 0.13 195/0.75);
--rule:oklch(0.30 0 0);         --glow:oklch(0.85 0.13 195/0.5);
--lesson-surface:oklch(0.175 0 0);           --lesson-foreground:oklch(0.99 0 0);
--lesson-code-surface:oklch(0.13 0 0);       --guide:oklch(0.85 0.13 195);
--dock:oklch(0.20 0 0);         --dock-foreground:oklch(0.99 0 0);      --dock-border:oklch(0.72 0 0);
--code-keyword:oklch(0.86 0.085 350); --code-string:oklch(0.90 0.15 145);--code-number:oklch(0.92 0.10 95);
--code-comment:oklch(0.78 0 0);       --code-function:oklch(0.88 0.10 195);--code-type:oklch(0.90 0.045 250);
--code-variable:oklch(0.99 0 0);      --code-operator:oklch(0.88 0.06 25);--code-punct:oklch(0.86 0 0);
```

```css
/* Folio — the `paper` slot, evolved. color-scheme: light; --radius: 0.25rem */
--background:oklch(0.972 0.006 85);          --foreground:oklch(0.21 0.012 60);
--card:oklch(1 0 0);                         --card-foreground:var(--foreground);
--popover:oklch(1 0 0);                      --popover-foreground:var(--foreground);
--primary:oklch(0.40 0.12 275);              --primary-foreground:oklch(0.99 0.003 85);
--secondary:oklch(0.955 0.008 85);           --secondary-foreground:var(--foreground);
--muted:oklch(0.955 0.008 85);               --muted-foreground:oklch(0.46 0.015 65);
--accent:oklch(0.92 0.03 275);               --accent-foreground:oklch(0.26 0.05 275);
--destructive:oklch(0.50 0.20 27);           --destructive-foreground:oklch(0.99 0.003 85);
--success:oklch(0.46 0.11 155);              --success-foreground:oklch(0.99 0.003 85);
--warning:oklch(0.58 0.11 75);               --warning-foreground:oklch(0.99 0.003 85);
--celebration:oklch(0.48 0.11 60);           --celebration-foreground:oklch(0.99 0.003 85);
--streak:oklch(0.50 0.14 40);                --streak-foreground:oklch(0.99 0.003 85);
--xp:oklch(0.40 0.12 275);                   --xp-foreground:oklch(0.99 0.003 85);
--border:oklch(0.60 0.012 70);  --input:oklch(0.66 0.012 70);      --ring:oklch(0.40 0.12 275/0.8);
--rule:oklch(0.86 0.008 70);    --glow:oklch(0.40 0.12 275/0.18);
--lesson-surface:oklch(1 0 0);               --lesson-foreground:oklch(0.21 0.012 60);
--lesson-code-surface:oklch(0.955 0.008 85); --guide:oklch(0.40 0.12 275);
--dock:oklch(1 0 0);            --dock-foreground:oklch(0.21 0.012 60); --dock-border:oklch(0.60 0.012 70);
--code-keyword:oklch(0.36 0.12 285);  --code-string:oklch(0.38 0.09 155);--code-number:oklch(0.40 0.10 45);
--code-comment:oklch(0.48 0.012 70);  --code-function:oklch(0.36 0.10 250);--code-type:oklch(0.38 0.06 200);
--code-variable:oklch(0.24 0.012 60); --code-operator:oklch(0.40 0.11 25);--code-punct:oklch(0.40 0.012 70);
```

### 2.4 The four new gates, and why the obvious numbers were wrong

**Ruling W4.3 — the card fill is gated on OKLCH ΔL, not on a WCAG ratio.** All three directions demanded `wcagRatio(card, background)` of 1.30–1.45 in the darks. Measured: reaching 1.30 needs `--card` at **L 0.28** on Midnight's 0.16 ground and **L 0.26** on Eclipse's 0.09 ground — a slab, and the end of near-black. At these lightnesses the WCAG ratio is dominated by its own `+0.05` flare term and is simply the wrong instrument; OKLCH `L` is perceptual lightness and is the right one. **`--card` sits ΔL 0.06–0.09 above `--background` in the four dark palettes** (shipped: exactly 0.070 in all four), `--popover` a further ΔL 0.03, `--lesson-surface` ΔL 0.055, `--dock` ΔL 0.08. The resulting WCAG ratios (1.149 / 1.160 / 1.066 / 1.099) are recorded as **advisory** and asserted only as "greater than today".

**Ruling W4.4 — on a light ground the card ratio is bounded by white, so Folio carries depth with shadow.** A pure-white card on the previously proposed `oklch(0.985)` ground measures **1.044**; the 1.40 target would need a ground near L 0.888, which is not a white palette. Folio's ground moves to `oklch(0.972 0.006 85)`, the card stays pure white (ΔL 0.028, ratio 1.084), and **`--shadow-xs` on every resting card in Folio is mandatory, not decorative** — exactly what v2 §8.5 already says light themes do. In the four darks the shadow tokens lighten the surface instead and no card carries a black shadow.

**Ruling W4.5 — `--muted-foreground` is gated on an Lc *gap*, never a WCAG ceiling.** Two proposals were wrong in opposite directions. Dropping muted text to 4.6:1 would put it at APCA **Lc ≈ 32**, failing the repo's own body tier by 43 points. An unscoped 7:1 ceiling would force a contrast *reduction* on Arcade (14.14:1 today), the palette seeded to every `prefers-contrast: more` user. The gate is therefore: **`--muted-foreground` clears Lc 75 and WCAG 4.5 on `--background`, `--card` and `--muted`, and sits at least 14 Lc below `--foreground` on `--background`.** Shipped gaps: Midnight 20.5, Amber 18.5, Eclipse 24.7, Arcade 23.2, Folio 19.7. Hierarchy comes from the gap, from size, and from **role** — §3 moves lesson prose off `--muted-foreground` entirely.

**Ruling W4.6 — every authored `oklch()` must round-trip into sRGB.** Nine shipped tokens exceed the gamut (Midnight `--primary: oklch(0.78 0.16 264)` where the chroma ceiling at that L and hue is 0.111). Browsers gamut-*map* by chroma reduction (CSS Color 4 §14.2); `contrast.ts` clips per channel. The authored number therefore does not describe what renders and the gate certifies a colour nobody sees. **Every `oklch()` in every block round-trips to linear sRGB with all three channels inside `[-0.001, 1.001]`.** All five blocks above pass; the current file does not.

### 2.5 Measured, for the record

| Palette | fg/bg (Lc / WCAG) | muted Lc / gap | ΔL card | card ratio | rule ratio | border Lc | ring (Lc / WCAG) |
|---|---|---|---|---|---|---|---|
| Midnight | 98.8 / 17.28 | 78.3 / 20.5 | 0.070 | 1.149 | 1.65 | 52.9 | 53.7 / 7.9 |
| Amber | 96.4 / 16.53 | 77.9 / 18.5 | 0.070 | 1.160 | 1.68 | 52.6 | 52.0 / 7.6 |
| Eclipse | 101.2 / 18.97 | 76.5 / 24.7 | 0.070 | 1.066 | 1.42 | 56.5 | 55.0 / 8.6 |
| Arcade | 105.6 / 19.72 | 82.5 / 23.2 | 0.070 | 1.099 | 1.49 | 53.2 | 51.0 / 7.7 |
| Folio | 101.5 / 16.97 | 79.2 / 19.7 | 0.028 | 1.084 | 1.41 | 61.3 | 75.0 / 5.3 |

Every BODY pair (Lc 75 / WCAG 4.5), every UI pair (Lc 60 / 3:1), every DIVIDER (Lc 45), the RING, all nine `--code-*` against `--lesson-code-surface` (Lc 75, comments Lc 60), `--guide` against `--lesson-code-surface` at ≥ 3:1 as a 1.4.11 graphic, and the ΔL ≥ 0.10 `--success` / `--warning` separation now promoted from Arcade-only to all five: **zero failures across all five blocks.**

### 2.6 Code tokens are one `HighlightStyle`, five palettes

The nine `--code-*` tokens ship as a single `HighlightStyle.define()` in `src/components/exercise/Editor.tsx` mapping `@lezer/highlight` tags — `keyword`/`controlKeyword`/`definitionKeyword` → `--code-keyword`; `string`/`character` → `--code-string`; `number`/`bool`/`atom` → `--code-number`; `comment`/`lineComment`/`blockComment` → `--code-comment`; `function(variableName)`/`function(propertyName)` → `--code-function`; `typeName`/`className` → `--code-type`; `variableName`/`propertyName` → `--code-variable`; `operator` → `--code-operator`; `punctuation`/`bracket` → `--code-punct`; `invalid` → `--destructive`. **One style, five palettes, no per-theme JavaScript, and no component branches on which theme is active.** Syntax colouring measurably cuts task time, so no palette may flatten code tokens for mood.

### 2.7 The picker

Five swatch tiles in the Account "Make it yours" panel and in the shell quick-switch, `role="radiogroup"` with `role="radio"` children, **44 × 44 CSS px targets**, each showing background, primary and accent **and naming itself in text**. Colour is the content here, so it may never be the only channel. Applied instantly, `disableTransitionOnChange` still on, `[data-theme-switching] * { transition: none !important }` still on. Persistence is unchanged from v2 §8.8: `localStorage['brogram:theme']` for first paint, `wellness.prefs.theme` for cross-device, server wins on reconcile.

---

## 3. Type, and the licences behind it

### 3.1 The faces

| Role | Face | Licence | How it loads |
|---|---|---|---|
| UI text, all five palettes | **Geist Sans** | SIL OFL 1.1 (`vercel/geist-font`) | `next/font/google`, already wired |
| All code, all five palettes | **Geist Mono** | SIL OFL 1.1 | `next/font/google`, already wired |
| Display, Eclipse | **Archivo** variable, `axes: ['wdth']`, rendered at `'wdth' 118, 'wght' 850`, uppercase, `+0.03em` | SIL OFL 1.1 (Omnibus-Type) | `next/font/google`, `preload: false` |
| Display **and** prose, Folio | **Newsreader** variable, `axes: ['opsz']`, `opsz 56` display / `opsz 18` prose | SIL OFL 1.1 (Production Type) | `next/font/google`, `preload: false` |
| *Not shipped* | ~~Integral CF~~ | Retail; desktop from $29.99/style, **web is a page-view-tiered annual subscription** | — |

**Ruling W4.7 — Integral CF does not ship, and the reason is the licence, not the money.** Its web licence is an annual, page-view-tiered subscription whose files may not be redistributed. An MIT repository cannot commit them and cannot sublicense them to a forker. **Archivo is the stand-in** — the same wide, flat-sided, closed-aperture grotesque skeleton at `wdth 118 / wght 850`. `--font-display` is the **single override point**: if the owner buys Integral CF for himself, the licensed `.woff2` lands in a gitignored `src/app/fonts/` and one `--font-display` declaration changes. Nothing else in the system knows.

Everything on Fontshare (Clash Display, Tanker, Satoshi) is ruled out: the ITF Free Font License permits commercial use but restricts redistributing and self-hosting the raw files. **Instrument Serif is dropped** — one well-cut serif is what a magazine does, and Newsreader's `opsz` axis is what lets one file be both a 56 px masthead and an 18 px reading face. Geist Sans and Geist Mono are not swapped: they are OFL, they are not Inter, and 840 green tests depend on them.

**Ruling W4.8 — serif never reaches code, and never reaches a body run in italic.** Sans, monospaced and roman styles measurably outperform serif, proportional and italic for dyslexic readers. Folio's mitigation is structural: four of five palettes are sans, the choice persists in `wellness.prefs.theme`, no body run is ever italic, code is Geist Mono in every palette, and Folio is never auto-seeded under `prefers-contrast: more`. The exercise brief stays Geist Sans even in Folio — a serif column beside a mono column at that width is noise.

### 3.2 The scale is additive; nothing Tailwind owns is reassigned

**Ruling W4.9.** `globals.css:159-190` deliberately uses additive names (`--text-display|h1|h2|h3|h4|body|small|micro|code`) rather than Tailwind's `--text-xs|sm|base|lg|xl`. Redefining Tailwind's names underneath 506 live raw call sites while the same ruling bans those call sites leaves no intermediate build correct. So this wave **adds three steps, moves one, and migrates call sites screen by screen**:

```css
@theme inline {
  /* moved: the one-line change that lifts every inheriting surface */
  --text-body: 1rem;          --text-body--line-height: 1.6;      /* was 0.875rem / 1.375 */

  /* added */
  --text-lede: 1.125rem;      --text-lede--line-height: 1.65;     /* 18px — the tier the app never had */
  --text-hero: 3.5rem;        --text-hero--line-height: 1.05;     --text-hero--letter-spacing: -0.025em;
  --text-hero-lg: 4.5rem;     --text-hero-lg--line-height: 1.0;   --text-hero-lg--letter-spacing: -0.03em;

  /* unchanged: display 48, h1 32, h2 24, h3 20, h4 16, small 13, micro 12, code 13 */

  --font-display: var(--font-display-face, var(--font-sans));
  --font-prose:   var(--font-prose-face,   var(--font-sans));
}
```

`body { font-size: var(--text-body); line-height: var(--text-body--line-height) }` already exists at `globals.css:195` — moving `--text-body` from 14/1.375 to 16/1.6 lifts every inheriting surface in one line with no migration, and is the single cheapest win in the wave. `--font-display-face` and `--font-prose-face` are redefined per `[data-theme]` beside the colour tokens: **the palette swaps the face, never the scale.** No `[data-theme]` block may define a `--text-*` token; that is an asserted rule.

Uppercase inverts the tracking sign. Negative tracking is for mixed case at ≥ 24 px; all-caps Archivo at 56–72 px needs **+0.02em to +0.04em** or the counters close up. It is applied through one `.display-caps` utility, never by editing a scale token.

### 3.3 Weight and colour per state

| Role | Family | Weight | Size | Tracking | Colour |
|---|---|---|---|---|---|
| Hero, level-up, one per screen | `--font-display` | 800–900 | `--text-hero` / `--text-hero-lg` | +0.03em, uppercase (Eclipse) | `--foreground` |
| H1 | `--font-display` | 700 | `--text-h1` | −0.015em | `--foreground` |
| H2 / H3 | `--font-sans` | 600 | `--text-h2` / `--text-h3` | −0.01em / −0.005em | `--foreground` |
| Lesson prose | `--font-prose` | 400 | `--text-lede` (18) | 0 | **`--foreground`, never `--muted-foreground`** |
| Body | `--font-sans` | **400** | `--text-body` (16) | 0 | `--foreground` |
| Secondary, help, meta | `--font-sans` | 400 | `--text-small` (13) | 0 | `--muted-foreground` — colour and size carry the demotion, never weight |
| Label, eyebrow | `--font-sans` | 500 | `--text-micro` (12) | +0.06em, uppercase | `--muted-foreground` |
| Code | `--font-mono` | 400 (500 on the guide's active line) | `--text-code` | 0 | `--code-*` |
| Verdict | `--font-sans` | 600 | `--text-body` | 0 | **glyph + word + colour, never colour or weight alone** (v2 R34) |
| Live numerals | inherits | 500 | per role | 0 | `tabular-nums` mandatory |

**Ruling W4.10 — body prose is `font-normal`.** The ratio moves from 5 : 198 to at least 1 : 3. `font-medium` is for labels, buttons and active nav; when everything is half-bold nothing is emphatic.

**Ruling W4.11 — `font-variant-numeric: tabular-nums` on every sans numeral that ticks**: XP odometer, streak days, level, score, chain, combo, `mm:ss`. It silently no-ops if the font lacks `tnum`, so the test is a rendered width comparison of `111` against `000`; if it fails, the fix is a `next/font/local` swap against the OFL files in `vercel/geist-font`, not a shrug. Mono digits are fixed-advance by construction and need nothing.

**Ruling W4.12 — `liga: 0, calt: 0` in the CodeMirror theme and in every `<pre>` a lesson renders.** A beginner must see the characters they have to type: `!=` and `=>` never become a glyph that is not on the keyboard.

### 3.4 Loading, and the budget

`next/font` output lands in `.next/static/media/`, **never in tracked `public/`** — verified: 11 files, 164 KB for both Geist families today, against a tracked `public/` of 1,374,356 bytes that this wave does not touch. `subsets: ['latin']` only (English only, so never `latin-ext`). Extra variable axes are excluded by default, so Archivo needs `axes: ['wdth']` and Newsreader `axes: ['opsz']` **explicitly**. `display: 'swap'` stays — `'optional'` scores better on CLS but can drop the display face entirely on a slow first visit, and here the face *is* the palette. `adjustFontFallback` stays on, with `'Times New Roman'` for the serif. `preload: false` on both display faces; they are fetched on theme switch. Forecast: ~270 KB of woff2 in `.next/static/media/`, gated at **≤ 320 KB**.

---

## 4. Spacing, surfaces, icons, measure

**Spacing — eight steps and nothing else.** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px, i.e. Tailwind `{1,2,3,4,6,8,12,16}`. Rhythm is the hierarchy: **8 within a group, 16 between groups, 32 between sections, 48 between page regions.** `dashboard/page.tsx` runs eight unrelated steps on one screen today; that stops.

**Radii — three, plus full.** `rounded-lg` (8) controls, `rounded-xl` (12) cards, `rounded-2xl` (16) sheets and modals, `rounded-full` for pills and dots. Amber keeps its own `--radius: 0.875rem`; Eclipse takes 0.375rem and Arcade and Folio 0.25rem, which is a palette expression of the same three-step ladder, not a fourth ladder.

**Surfaces — three tiers with fills that read.** `sunken` = `--background`; `raised` = `--card` at the ΔL of W4.3, outlined in `--rule`; `floating` = `--popover` plus `--elevation-md`. `--elevation-xs` on a resting card (mandatory in Folio, W4.4), `sm` on hover, `md` on popover, drawer and toast, `lg` on modal and celebration only, in at most two files. Elevation never moves without the fill moving with it. **Prefer a fill step over a rule wherever both would work.**

**Icons — one set, one stroke, three sizes.** lucide (ISC), 2 px stroke on a 24 grid, rendered at **16 inline / 20 control / 24 feature**. Never below 16: a 24-grid 2 px stroke at `size-3` is a 1 px stroke that disintegrates. The de-rot icon chips are removed in favour of a 20 px glyph optically aligned to the title cap-height.

**Measure.** `--measure-prose: 68ch` (walkthrough, CLO text, exercise brief, reports intro), `--measure-form: 34rem` (login, onboarding, account), code uncapped — code wraps by its own rules and a `ch` cap on a `<pre>` is a bug. Two fixes by file:

- `LessonView.tsx:218,221` — outer `max-w-5xl`, prose `max-w-[68ch]`, rail 12 rem, so the inner cap actually binds. Today's `max-w-3xl` outside `max-w-[45rem]` inside means it never does.
- `exercise/[id]/page.tsx:88` — `xl:grid-cols-[22rem_minmax(0,1.6fr)_20rem]`, all three panels flush to one top edge. The brief moves from ~28 characters to ~62. The editor column at 1280 px is the one number to watch in review (§11 family C asserts a floor, not just the brief's).

**Header and dock.** Header content height **56 px** — a rule, not a band. Nav hit areas ≥ 24 × 24 CSS px with ≥ 8 px gaps; Buddy, the sound toggle and the theme switch at **44 px**. The rail's first label baseline aligns to the page H1 baseline (today they miss by ~10 px).

**One filled primary action per screen.** `/derot` goes from six filled Starts to one filled and five ghost.

---

## 5. Motion

### 5.1 Tokens — extend, never replace

`src/lib/motion/tokens.ts` stays the law and `timing.test.ts` keeps pinning it. Three additions, no replacements:

| Addition | Value | Why |
|---|---|---|
| `DUR.guide` | **260 ms** | Nothing existed between `slow` (320) and `celebration` (700); the code guide, dock indicator and tab underline all live in the 200–300 ms movement band. |
| `registerEases()` | `CustomEase.create()` over all four `EASE` entries | GSAP cannot read a CSS `cubic-bezier()` string. `Celebration.tsx` and `XpCounter.tsx` run `power1/2.out` while CSS runs `cubic-bezier(0.22, 1, 0.36, 1)` — **two curves for one named motion** (`power2.out` at t = 0.25 is 0.578; the enter curve, 0.765). Verified in this repo: `CustomEase.create('enter', '0.22, 1, 0.36, 1')` accepts the four control points directly. |
| Stagger cap | `stagger: Math.min(0.04, 0.3 / n)` | 40 ms per item, never a bare 0.04 on a long list; total stays under 300 ms. |

**Ruling W4.13 — no raw GSAP ease name outside `src/lib/motion/`.** Every `ease:` in the app is `'enter' | 'move' | 'drawer' | 'standard'`. There is no exit curve token: `ease-in` is banned, so exits use `EASE.standard` one `DUR` step faster than the enter (`base→fast`, `slow→base`), which is what `motionTokens.ts` already does by leaving `ease` unset.

### 5.2 Text reveals, rationed

One component, `<Reveal mode="lines" | "words" | "chars" | "fade">`, over `SplitText.create({ type, mask: 'lines', aria: 'auto', autoSplit: true, onSplit })`. Three details are load-bearing:

- `aria: 'auto'` puts the original text in an `aria-label` on the parent and `aria-hidden` on every generated span, so the sentence is read and not the letters. **`<Reveal>` is therefore typed to text-only children** — an `aria-hidden` subtree would silence a link or a `<code>` span inside it.
- `mask: 'lines'` gives the masked line reveal with no extra CSS: `yPercent: 110 → 0` per line, `DUR.slow`, `EASE.enter`, 40 ms stagger. **This is the house reveal and the one that reads as expensive.**
- `autoSplit: true` with `onSplit(self) { return gsap.from(self.lines, …) }` re-splits on font load and resize. Mandatory, because Folio introduces a serif whose lines measured before the webfont lands are the wrong lines.

**Ruling W4.14 — the ration is the anti-generated rule.** Line reveals on the lesson hook and recap and on section headings that open a screen. Word reveals on course and screen headings. **Character reveals on exactly two surfaces in the entire product: the onboarding hook line and the level-up headline.** Everything else fades. Character reveals on body copy are the loudest "generated" tell in the vocabulary.

**Ruling W4.15 — under reduced motion, do not split the DOM at all.** `if (reduced) return children` before `SplitText.create`. A split DOM with no animation is pure risk — line boxes, selection, copy and paste — for zero gain. Text is at final opacity on first paint; odometers `set` rather than tween.

Odometers keep `XpCounter`'s shape verbatim: a proxy object in a ref, `snap: { v: 1 }`, `toLocaleString()` in `onUpdate`, `killTweensOf` before re-tweening, and an `sr-only aria-live="polite"` sibling carrying the settled value. **No second counter component is written.**

### 5.3 Route transitions

`<ViewTransition>` from `react`, wrappers in **`page.tsx` files only, never a layout** — a layout persists, so enter and exit never fire there. Six routes, exactly as v2 §7.8 scopes them: dashboard, course, lesson, courses, de-rot, reports. **Never on `/exercise/[id]`.** `nav-forward` going deeper, `nav-back` on up-links, 60 px offset, exit 150 ms, enter 210 ms delayed 150 ms — asymmetric by construction.

Four rules that are easy to get wrong, all mandatory:

1. A named `<ViewTransition>` with `default="none"` needs an explicit `share=`; without it the pair silently stops morphing.
2. `::view-transition { pointer-events: none }` — otherwise a click during the transition is swallowed.
3. Header and dock carry `viewTransitionName: 'site-header'` with `::view-transition-group(site-header){animation:none;z-index:100}` and `::view-transition-old(site-header){display:none}`. **A moving header destroys the spatial anchor and turns the cinema into a carnival.**
4. React does not honour reduced motion here and the in-app override is React state, not a media query, so the kill switch needs **both** selectors:

```css
@media (prefers-reduced-motion: reduce) { /* the block below, verbatim */ }
:root[data-motion='reduced'] ::view-transition-old(*),
:root[data-motion='reduced'] ::view-transition-new(*),
:root[data-motion='reduced'] ::view-transition-group(*) {
  animation-duration: 0s !important; animation-delay: 0s !important;
}
```

`:root[data-motion]` does not exist in the tree today. The provider that already resolves `useReducedMotion()` writes it on `<html>` in the same effect that reads it — one attribute, no new state, no new hook.

### 5.4 Indicators that move between positions

One shared `useFlipIndicator(containerRef, activeKey, reduced)` on `Flip.getState` → reposition → `Flip.from(state, { duration: DUR.guide / 1000, ease: 'move', scale: true, absolute: true })`. `scale: true` animates `scaleX`/`scaleY` instead of `width`/`height`, which is exactly the §7.8 ban. It owns the dock lane indicator and the tab underline — **not** the code guide (§7.2 explains why). Under reduced motion it positions with one `gsap.set` and `Flip.from` is never called.

Hover, press and focus stay **CSS transitions**: they retarget mid-flight where a keyframe restarts from zero. Buttons `DUR.instant` on `scale(0.97)`; cards `DUR.fast` on `translateY(-2px)` plus an elevation step; both inside `@media (hover: hover) and (pointer: fine)`. Properties are always enumerated — `transition: all` appears nowhere. `will-change: transform` on **three selectors at most**: the guide band, the dock indicator, the drawer.

### 5.5 The reduced-motion law

**Ruling W4.16 — reduced motion replaces, never deletes.** Staggers become one ≤ 150 ms fade. Directional slides become cross-fades. Idle loops hold on a frame. The shake does not play; the verdict is unchanged. Skeleton shimmer becomes a static tint. `--duration-celebration` collapses to `--duration-fast` and the spring becomes an opacity cross-fade. **The one exception, and it is the important one: the code guide's band still moves to the new lines — only `transition` becomes `none`.** Losing the band's position deletes the teaching, not the motion.

### 5.6 GSAP under the React Compiler lint

`eslint-config-next@16.3.4` spreads `eslint-plugin-react-hooks@7.1.1` recommended rules, which evaluate to `set-state-in-effect: error`, `refs: error`, `purity: error`, `immutability: error`. That binds every hook in this wave:

- Always `useGSAP(fn, { scope: containerRef, dependencies: [...] })`; never a bare `useEffect` plus `gsap.to`.
- **No `setState` inside a `useGSAP` callback** — it is a `useLayoutEffect`. Animation output reaches the DOM through a ref (`el.textContent`, `el.dataset.state`), as `XpCounter` already does. If React must know a tween finished, use `useSyncExternalStore` over a small emitter.
- Never read `ref.current` during render.
- Tweens created in event handlers are wrapped in `contextSafe`, or they escape the context and never revert.
- `gsap.registerPlugin(useGSAP, CustomEase, SplitText, Flip)` **once**, in a client module imported by the shell. SSR never touches `gsap.*`. SplitText + CustomEase + Flip ride the shell chunk (~39 KB min) because they are needed on first paint; `canvas-confetti`, `howler` and every line of WebGL stay behind `import()`.

---

## 6. Shaders — three surfaces, then they stop

### 6.1 Placement

**Ruling W4.17.** No 3D library ships: not `three` (356 KB min / 86 KB gzip; 488 KB for a minimal tree-shaken app), not `ogl`, not `@paper-design/shaders-react`. An ambient field is **one fullscreen triangle and one fragment shader** — no scene graph, no camera, no loader — roughly 4 KB of hand-rolled WebGL2 plus ~1 KB of GLSL, behind `dynamic(() => import('./ShaderField'), { ssr: false, loading: () => null })`.

| Surface | Verdict | Why |
|---|---|---|
| `/login`, Eclipse only | **Yes** | One-purpose screen, no code, no reading load |
| `/course/[code]` hero band, Eclipse only | **Yes**, confined to the hero box | Tiles and path map below stay on solid `--card` |
| `/derot` hub, Eclipse only | **Yes**, low amplitude | R7.4 already grants this lane decorative motion |
| `/dashboard` | **No** | A working surface with live counters |
| `/lesson/[cloId]` | **No** | §10.5: no looping motion anywhere — this is a reading surface |
| `/exercise/[id]` | **No** | It competes with the editor for GPU and for attention during composition |
| Playground games | **No WebGL** | DOM and CSS only; emphatically not behind `follow-the-dot`, where a moving field behind a moving target degrades the task and the score |
| Celebrations | **No WebGL** | `canvas-confetti` (~6 KB gzip, ISC) is already dynamic-imported and honours `disableForReducedMotion` |
| Lockdown, integrity, account status | **Never** | Standing constraint 9 |

In the other four palettes the same slots render the **static CSS floor** — two `radial-gradient`s in `--background` / `--glow` token space — and that is a finished look, not a degraded one.

### 6.2 The contract

**Ruling W4.18 — settle, freeze, snapshot, lose the context.** WCAG 2.2 SC 2.2.2 (Level A) bites on moving content that starts automatically, **lasts more than five seconds**, and is presented in parallel with other content. A perpetual field behind a login form is all three. Two legal shapes exist: add a pause control, or stop under five seconds. This product does the second, because it is also the better design and the cheaper engineering:

```ts
const SETTLE_MS = 4500     // motion stops inside SC 2.2.2's five seconds; no pause control is owed
const RENDER_SCALE = 0.5   // 0.5x CSS pixels, upscaled by CSS: 16x fewer fragments than DPR 2
const FPS_CAP = 30         // half the frames, half the fragments again

const gl = canvas.getContext('webgl2', {
  alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
  preserveDrawingBuffer: true,        // the frozen last frame must survive rAF stopping
  powerPreference: 'low-power',
  failIfMajorPerformanceCaveat: true, // fail over to CSS rather than software-rasterise
})
if (!gl) return                        // -> the CSS floor is the final look; no layout branch

// At SETTLE_MS: stop the loop, ctx2d.drawImage(canvas, 0, 0), unmount the GL canvas, then
//   gl.getExtension('WEBGL_lose_context')?.loseContext()
// Steady-state GPU cost is then zero and route churn can never reach the ~16-context cap.
```

Nine more rules, each testable:

1. **One context ever**, enforced by a module counter that returns `null` on a second mount.
2. **Reduced motion is resolved *before* the dynamic import** — the `Confetti.tsx:36` pattern. Under `reduce`, no canvas and no shader chunk appears in the network log.
3. **Colour comes only from `--shader-a` and `--shader-b`, read from computed style at init.** Zero `vec3(` colour literals in the GLSL.
4. **Re-key on a live palette switch**, or a frozen Eclipse-violet snapshot survives a switch to Midnight.
5. **Dither the gradient** by ±1/255, or a two-stop near-black field bands visibly on OLED.
6. **No text, icon or control ever sits over live shader pixels.** A `--card` surface or a `--background` scrim at ≥ 0.92 alpha always intervenes, because live pixels invalidate every tested contrast pair.
7. The canvas starts at `opacity: 0` and transitions to 1 over `--duration-slow` on the first drawn frame: a failed context, a slow compile and a reduced-motion learner all produce the same result with no flash and no CLS.
8. The loop is gated on `IntersectionObserver` and `document.visibilityState`, and bails before creating anything if `navigator.connection?.saveData` is true.
9. WebGL2 is at 96.44%; the 3.56% without it get the CSS floor, which is **the default look, not a degraded one**.

---

## 7. The code-reading guide

The best-evidenced element in this pass. Signalling raises retention at g+ = 0.53 across 103 studies (N = 12,201); eye-movement modelling examples show d = −0.83 on time-to-first-fixation and d = 0.43 on cognitive performance; and a 2026 study of 120 CS undergraduates on Python debugging found that **human-mediated initiation beat automated triggering**, which delivered mistimed, disruptive guidance. So the guide must remain signalling and must never decay into decoration.

### 7.1 What already exists

`src/components/lesson/WorkedBlock.tsx` ships the right skeleton: a plain `<pre>` (no CodeMirror, no tokenizer, no editor chunk), a fixed 24 px `LINE_HEIGHT_PX`, and one absolutely-positioned band moved with `transform: translateY() scaleY()` on `var(--ease-move)` at 200 ms, suppressed when `reduced`. The seed agrees with the design: 52 `worked` blocks, 4.15 steps mean, 13.0 code lines mean, 216 steps of which 142 are single-line and 74 are ranges, and **50 of 52 blocks step monotonically down the file** (the two exceptions are both SQL, teaching clause evaluation order). Zero tabs, zero non-ASCII, zero out-of-range line refs — **and nothing checks any of that**: `scripts/verify-lesson.mjs` verifies snippets, `predict-output`, `micro-code`, `spot-the-bug` and `fill-blank`, and leaves `worked` unverified.

### 7.2 `CodeGuide.tsx` — the component contract

**Ruling W4.19 — extract `src/components/lesson/CodeGuide.tsx` and replace the ring with tint plus rail.**

```ts
export type GuideSpan = {
  /** 1-based, inclusive. A number is a single line. */
  line: number | [number, number]
  /** Optional literal to underline, resolved inside the span's line range. */
  token?: string
}

export interface CodeGuideProps {
  code: string                 // the block's source, exactly as authored
  language: Language           // for the mono theme only; no tokenizer runs
  active: GuideSpan | null     // the stepped band. null renders no band element at all.
  passive?: GuideSpan[]        // static tints at 60% of the active alpha (LessonSnippet.highlight)
  reduced: boolean             // the resolved boolean, never a media query
  label: string                // accessible label for the surrounding region
  idPrefix: string             // for aria-controls / aria-describedby wiring
}
```

`WorkedBlock` passes `active`; `SnippetBlock` passes `passive` and never `active`. Rendering with `active: null` produces **no band element**, which is the seam a later guidance-fading or execution-trace feature would use.

**The band is two absolutely-positioned children, both `transform`-only**: a `bg-guide/12` box and a **2 px `--guide` rail at `left: 8px`**. `ring-1 ring-inset` is dropped. The current ring and its `rounded-md` corner are scaled by `scaleY(n)`, so a three-line step renders 3 px edges and a smeared radius — the most generated-looking detail in the build. A borderless tint plus a rail is undistorted at any scale, and the rail is what the eye actually tracks.

**Ruling W4.20 — a CSS transition, not GSAP, and not Flip.** The transition string is exactly `transform 200ms var(--ease-move)` and never contains `all`, `top`, `height` or `ease-in`. A transition **retargets mid-flight** when a learner clicks fast; a tween restarts from zero. Flip stays for the dock indicator and tab underline, where the geometry is unknown ahead of time. This is also the only element in the wave whose motion is first-party CSS with no library at all.

**Token-level guidance, free from monospace geometry.** When a step's `say` contains **exactly one** backticked span and that literal resolves **uniquely** inside the step's line range, draw a 2 px underline at `left: calc(16px + Nch)`, `width: calc(Mch)`, animated with `translateX` and `scaleX` from a shared origin. No tokenizer, no syntax highlighting, no bundle. It is safe because the seed contains zero tabs and zero non-ASCII in `worked` code, and W4.22 makes the verifier enforce that going forward. Any other case — no backtick, several, or a non-unique match — falls back to line level and never throws. (Only 2 of 216 `say` strings carry a backtick today; this is a detail that gets better as content is authored, not a dependency.)

**Ruling W4.21 — revive `LessonSnippet.highlight`.** It exists in `src/lib/contracts.ts` and in `seed/lessons/lesson.schema.json`, is authored in seed, and `SnippetBlock.tsx` renders nothing for it. It becomes the `passive` prop: a static, non-stepping tint at 60% of the active band's alpha, applied on block enter. Authored-and-dropped becomes authored-and-shown, with no contract change.

### 7.3 Where the guide appears

| Block kind | Guide |
|---|---|
| `worked` | **Yes**, stepped (`active`) |
| `snippet` | **Yes**, passive only |
| `spot-the-bug`, before an answer | **No** — a band would hand over `bugLines` |
| `predict-output`, `micro-code`, `fill-blank` | **No** |
| The learner's editor, `PromptPanel` | **No** — the prompt's fenced code is markdown with no line data |

### 7.4 Advance, keyboard and screen reader

**Ruling W4.22 — never auto-advance. No timer, no `setInterval`, no autoplay flag, ever.** Learner-initiated stepping is what the 2026 EMME study measured as better, it matches the transient-information effect (replaced information must be held in working memory), and it keeps SC 2.2.2 out of scope entirely — nothing auto-updates, so no pause control is owed anywhere in the lesson.

Advance is the existing native `<button>`, so click and Enter are already both covered; Space is added by the native button semantics and needs no key handler. Focus never leaves the control except on the last step, where `WorkedBlock` already moves focus to the newly-revealed final callout.

The band is `aria-hidden` and always will be, so **the step text carries the location**: the active callout takes `aria-current="step"` and every callout is prefixed with a visually-hidden `"Step 2 of 4, lines 3 to 5."`. The guide moves between **labelled groups in reading order**, never in execution order — novices read code linearly, and 50 of 52 seed blocks already step monotonically down.

### 7.5 Verifier checks (`scripts/verify-lesson.mjs`)

**Ruling W4.23 — `worked` and `snippet.highlight` become verified content.** The script gains, as hard failures (exit 1):

1. Every `steps[].line` and every `highlight` range is inside `code.split('\n').length`, with `start <= end`.
2. `code` in a `worked` or `snippet` block contains no tab and no non-ASCII character (the monospace `ch` arithmetic in §7.2 depends on both).
3. Any backticked span in a step's `say` occurs **exactly once** within that step's own line range, or the step is reported as line-level-only rather than silently mis-underlined.
4. Steps are in non-decreasing line order **unless** the block sets an explicit `readingOrder: 'semantic'` marker — the two SQL blocks are legitimate and must not become a lint failure.

---

## 8. The four states, on every screen this wave touches

**Ruling W4.24.** No screen ships with an undesigned empty, loading, error or restricted state.

| State | Shape |
|---|---|
| **Empty** | An `--text-lede` headline, one `--text-body` sentence inside 68ch, one action. Never a dashed box with a hard-coded link — `reports/page.tsx:164-167` is a dashed border plus `text-emerald-200`, and it dies this wave. |
| **Loading** | The shape of the answer, never a spinner. `LessonSkeleton.tsx` is the model and every route already has a `loading.tsx` to put one in. Shimmer sweeps 1400 ms linear; a static tint under reduced motion. |
| **Error** | `role="alert"`, plain English, always a retry or an exit, built on the shared `<ErrorRetry>`. A `--destructive` glyph on a `--rule` panel — **never a destructive fill**, because a red panel for "the report could not load" is a lie about severity. |
| **Restricted** | **The quietest surface in the app**: `--muted` fill, no motion, no sound, no shader, no personality, no "bro". Information, not punishment. It is the reference implementation for standing constraint 9. |

---

## 9. Per-screen treatment

Common to all: header, dock in the learner's placement, the footer line, a shape-matched `loading.tsx`, the shared error state. Motion listed here **replaces** the corresponding line in v2 §10 where it is more specific and is additive everywhere else.

**`/login`.** The full statement and the only screen that is nearly all stage. Eclipse: the field settles and freezes behind a card at ≥ 0.92 alpha. Folio: the form on `--card` over the paper ground with one `--rule` hairline above the submit. One `--measure-form` column, vertically centred, one wordmark at `--text-hero` on a masked-line reveal, one filled button. Error text is flat and unanimated. Under reduced motion or without WebGL the CSS floor is the finished look.

**`/onboarding`.** One question per view at `--text-h1`. The product's **first of two** character reveals, on the opening hook line only. The existing 120 ms option fill and 200 ms card exchange are kept — this is already the best-choreographed screen in the app. Progress is a hairline `--rule` track that fills, not a pill. Options are 44 px targets that take a real fill on select. No shader: a form is read.

**`/courses`.** A two-column editorial index at 24 px gaps. Title `--text-h2`, language and CLO count at `--text-micro` uppercase `+0.06em`, description at `--text-body` in the retuned muted tier. Cards take a real `--card` fill with `--rule` edges and `--elevation-xs`; the dashed borders go. Titles stagger at 40 ms with a masked-line reveal. `coming-soon` entries are the restricted-adjacent state, **designed rather than dimmed**: `sunken` ground, `--rule` top border, no button, the reason stated.

**`/dashboard`.** The working surface, so the least cinematic in the product: no shader, no loop, nothing above `--text-h1`. Exactly one filled `raised` surface — the resume card — carrying the only filled button. Stats become `--text-h1` tabular numerals over `--text-micro` uppercase labels, divided by `--rule`. The XP odometer stays on the `XpCounter` proxy pattern. The line under the heading lifts from 14 px muted to `--text-body` in `--foreground`; today's 32 → 14 px jump with nothing between is exactly why the screen reads thin.

**`/course/[code]`.** The one hero band that earns a shader — full-bleed **inside the hero box only**, Eclipse only, frozen at 4500 ms; a static duotone tint in the other four. Title at `--text-hero` (Archivo caps in Eclipse, Newsreader in Folio). CLO text capped at 68ch below on solid `--card`, down from ~110 characters. The path map keeps its DOM-list-first accessibility contract from v2 §10.4 verbatim; visually it becomes one 2 px `--rule` connector instead of dashed circles at three radii, with node state carried by **shape and fill as well as colour** and every node keeping a 24 × 24 CSS px hit area.

**`/lesson/[cloId]`.** The reading surface. No shader, no looping motion, ever. Prose at `--text-lede` / 1.6 in `--lesson-foreground` — never 14 px muted, because a reading surface must not be set in secondary colour. `--measure-prose` binds (the `LessonView.tsx:218,221` fix). In Folio the prose face is Newsreader at `opsz 18`; in the other four it is Geist Sans. The code guide is the only moving element on the page, and only when the learner advances it. Block reveals keep their 8 px rise and 300 ms enter, once, on scroll into view.

**`/exercise/[id]`.** `xl:grid-cols-[22rem_minmax(0,1.6fr)_20rem]`, three panels flush-topped, results rows on `--rule`. Brief prose is Geist Sans at `--text-body` in every palette. **No `<ViewTransition>`, no shader, no reveal, no ambient motion of any kind** — the editor and its warm runtime own this screen and juice fires only at the transition. Verdicts pair glyph and word and colour. The submit button loses its hard-coded emerald and takes `--primary`.

**`/derot` hub.** Shader on in Eclipse at low amplitude. **One filled Start and five ghost**, down from six filled. Icon chips removed for a 20 px glyph aligned to the title cap-height; "Not attempted yet" demoted to `--text-micro`. The lane switch keeps its 200 ms `EASE.move` indicator, now through `useFlipIndicator`, and the per-card idle micro-motion from v2 §10.8 stays — it pauses off-screen via `IntersectionObserver` and stops entirely under reduced motion. Nothing here may hint that de-rot is ever restricted.

**`/derot/arcade/[kind]` and `/derot/play/[game]`.** The loudest surfaces in the product, and this wave does not quieten them. Zero ambient shader — these are timed tasks and a moving field degrades both task and score — but the countdown ring, combo pop, score count-up, personal-best stamp, run-summary sound and the full §7.8 celebration budget all stay, because **R7.4 is where the budget is meant to be spent**. Playground stays DOM and CSS: `Breathe` keeps its transform-only pacer and gains a static `radial-gradient` aura on the existing `scaleFor` transform for 0 KB; `follow-the-dot` gains nothing ambient at all. Score and best sit in `--text-h1` tabular numerals.

**`/reports`.** Tabs on a `--rule` baseline, section headings at `--text-h2`, 32 px between sections, cards on fill rather than outline. Trophy cards keep their 30 ms stagger and the one entrance flourish for a trophy unlocked this session. Charts inherit `--code-*`-adjacent chart tokens per palette; **no series is distinguished by colour alone**. The report preview is a printed page in every palette — serif headings in Folio, ink on white, hairline rules, no shadows — because it is the one artefact a learner shows to someone else.

**`/account`.** One `--measure-form` column, headings at `--text-lede`, field labels at `--text-micro` uppercase, help text at `--text-small` muted, section rules in `--rule`. The five palette swatches are the most important control in the wave (§2.7). **Integrity, account-status and diagnostics panels are the restricted-state reference: zero motion in both modes, no sound, no personality, no "bro".** Every hard-coded emerald in this file — 11 of them, the highest count in the app — becomes a token.

**Buddy drawer.** Unchanged in shape. The drawer keeps its 320 ms `EASE.drawer` in, 200 ms out, and its 12 px bubble rise. It gains nothing from this wave except the token sweep and the type scale.

---

## 10. Acceptance tests

Nine families. Each is a real command or a real assertion, and each fails today.

**A — Contrast (`src/lib/theme/contrast.test.ts`).** All five `[data-theme]` blocks pass with **key-set parity** (a token missing from one block is the classic half-themed bug). Plus: every `oklch()` round-trips to linear sRGB inside `[-0.001, 1.001]` (fails today on nine tokens); `ΔL(card, background)` between 0.06 and 0.09 in the four darks and ≥ 0.02 in Folio; `muted-foreground` clears Lc 75 and 4.5:1 on `background`, `card` and `muted` **and** sits ≥ 14 Lc below `foreground`; `wcagRatio(rule, background)` between 1.25 and 1.90 and `apcaLc(rule, background) < apcaLc(border, background)`; every `--code-*` at Lc 75 on `--lesson-code-surface` with comments at Lc 60; `--guide` at ≥ 3:1 on `--lesson-code-surface`; `ΔL(success, warning) ≥ 0.10` in **all five**; the `THEMES` swatch triples still pinned to the real tokens.

**B — Type and colour discipline (source scan, CI).** Zero raw `text-xs|sm|base|lg|xl|2xl|3xl|4xl` under `src/app/(app)`, `src/app/(auth)` and `src/components` outside `src/components/ui` (**506 today**). Zero hard-coded Tailwind palette classes matching `(text|bg|border|ring|from|to|via)-(emerald|slate|zinc|…)-\d{2,3}` outside `src/app/preview` (**81 today**). `font-normal : font-medium` at least 1 : 3 (**5 : 198 today**). Spacing utilities restricted to `{1,2,3,4,6,8,12,16}`. Radii restricted to `lg|xl|2xl|full`. No lucide icon below `size-4`. No `[data-theme]` block defines a `--text-*` token. At most one filled-variant button per route (**6 on `/derot` today**).

**C — Measure and layout (Playwright, 1280 × 800).** Every paragraph in the walkthrough prose column, the CLO list, the exercise brief and the reports intro measures **55–80 characters** — scoped to those four selectors, never a blanket page assertion. The exercise brief column is ≥ 320 px and the editor column ≥ 480 px. All three exercise panels share a top edge within 2 px. The rail's first label baseline is within 2 px of the page H1 baseline. Header content height is 56 px; every nav target is ≥ 24 × 24 CSS px and Buddy, sound and theme are ≥ 44 px.

**D — Motion budget (Playwright + source scan).** Every `document.getAnimations()` entry after a navigation has `effect.getTiming().duration ≤ 900`. No `transition: all`, no `ease-in`, no animated `width|height|top|left` anywhere in `src/`. `will-change: transform` in at most three selectors. `gsap.parseEase('enter')(0.25)` is `0.765 ± 0.001`. No raw GSAP curve name outside `src/lib/motion/`. The guide band's transition string is exactly `transform 200ms var(--ease-move)`.

**E — Reduced motion (Playwright, both channels).** Under `emulateMedia({ reducedMotion: 'reduce' })` **and** under `wellness.prefs.motion = 'reduced'` with `:root[data-motion='reduced']`: zero running animations 50 ms after a navigation; no split DOM nodes and unchanged `textContent` in every `<Reveal>`; no `<canvas>` and no shader chunk in the network log; `Flip.from` never called; **and the guide band's `transform` after step 3 identical to the motion-on value.** Lockdown, integrity and account-status surfaces show zero animations in **both** modes.

**F — Shader containment.** `[data-shader-surface]` absent on `/dashboard`, `/lesson/*`, `/exercise/*` and every lockdown surface. Two mounts yield one `<canvas>`. `requestAnimationFrame` call count flat from t = 6 s to t = 12 s. `gl.isContextLost()` true at t = 6 s with the surface still visibly non-uniform. Context attributes asserted against a fake `getContext`. `canvas.width === Math.round(cssWidth * 0.5)` after a `ResizeObserver` tick. Zero `vec3(` colour literals in the GLSL.

**G — The guide (Vitest + Playwright).** `active: null` renders no band element. The band's computed style has no `border-width` and no `box-shadow`, and a snapshot at `scaleY(3)` has uniform edges. A step whose `say` holds one uniquely-resolving backticked span renders an underline whose `left` equals the column index; a non-matching backtick renders none and does not throw. `aria-current="step"` is on the active callout and its accessible name starts with "Step". No `setInterval` or `setTimeout` in any advance path under `src/components/lesson`. No band inside a `spot-the-bug` check's pre-answer DOM. A fixture lesson with a step pointing at line 99 of an 11-line block exits `verify-lesson.mjs` with 1.

**H — States and keyboard.** Every route this wave touches renders a designed empty, loading, error and restricted state in a component test — none falling back to a bare spinner or a dashed box. Focus reaches every interactive element in DOM order with a visible `--ring` at ≥ 3:1 in all five palettes. Palette swatches form a labelled radio group traversable by arrow key. `::view-transition { pointer-events: none }` is present. Verdict assertions find a text node **and** a glyph node on both pass and fail.

**I — Bundle and regression.** `.next/static/media/*.woff2` totals ≤ 320 KB. `git ls-files public` totals **1,374,356 bytes** with no `.woff2` and no non-OFL font binary. `three`, `ogl` and `@paper-design/shaders-react` absent from the dependency diff. `howler`, `canvas-confetti` and the shader chunk out of the initial chunk. `/dashboard` ≤ 380 KB and `/derot` ≤ 420 KB **once `scripts/check-bundle-budget.mjs` exists** — it does not today, so the wave writes it (plan T4.10) and no earlier task may assert against it. And the standing gate: `npx vitest run` green, `npx tsc --noEmit` exit 0, `npx eslint src` clean, `npm run build` exit 0.

---

## 11. Non-goals for this wave

1. **Execution-trace playback with a variables pane.** It needs a stepping interpreter, which is a runtime change. `CodeGuide`'s `active: null` is the seam it would use.
2. **Guidance fading keyed to learner state.** The expertise-reversal literature says the guide should thin as a learner improves; doing it needs `LessonProgress` reads inside a presentation component, which is a behaviour change.
3. **Prose ↔ code synchronised hover** (the Stripe-docs move). It is the right long-game idea and it needs a data shape lessons do not have yet.
4. **Any new control.** Nothing gains a button, a toggle or a keyboard shortcut it does not have today.
5. **A second sound cue set.** The fifteen-cue sprite from v2 §7.7 is what this wave spends; it adds none.
6. **A theme-aware component.** No component branches on which theme is active. That indirection is the entire point of the token layer.

## 12. Open rulings for the owner

1. **"Previous step" on the worked block.** Backtracking is what real code readers do, and the block offers no way back. Adding the control is a behaviour change and therefore outside "pure UI and UX". **Do not ship it unasked** — it is the first item for the next behavioural pass.
2. **Integral CF, bought personally.** The system is ready for it: one gitignored `.woff2` under `src/app/fonts/` and one `--font-display` line. The owner's call, and it never enters the repository.
3. **Whether Eclipse becomes the seeded default** after a week of use. This wave ships it opt-in with Midnight seeded and no preference migrated, which is the reversible choice.

## 13. Where this spec overrules a lane report

| Lane claim | Overruled by | Measurement |
|---|---|---|
| `layout.md`: retune `--muted-foreground` to 4.6–6.0:1 | W4.5 | That is APCA Lc ≈ 32, failing the repo's own body gate by 43 points |
| `layout.md` / all three directions: `--card` at 1.30–1.45:1 | W4.3 | Requires card L 0.28 on Midnight, 0.26 on Eclipse — the end of near-black. ΔL is the correct gate |
| Editorial direction: Folio card 1.40–1.60:1 | W4.4 | A white card on `oklch(0.985)` measures 1.044; 1.40 needs a ground near L 0.888 |
| `typography.md`: redefine `--text-xs|sm|base|lg|xl` in `@theme inline` | W4.9 | 506 live raw call sites; `globals.css:159-161` chose additive names for exactly this reason |
| `palettes.md`: Eclipse display at `wdth 112 / wght 800` | §3.1 | `wdth 118 / wght 850` is the closer match to the Integral CF skeleton; both are inside Archivo's real axis range |
| `palettes.md`: ship Instrument Serif for Folio display | §3.1 | It has no bold; Newsreader's `opsz` axis covers display and prose in one file |
| `shaders.md`: the canvas keys on a theme called `cinematic` | §2.1 | The id is `eclipse` |
| `teaching.md`: guide alpha from `--primary` | §7.2 | `--guide` is its own token in all five blocks and is gated as a 1.4.11 graphic |
| Cinema direction: a static aura for Playground | §9 | Ruling R7.4 (v2 spec line 1065) explicitly licenses full decorative motion there; this wave spends it |
