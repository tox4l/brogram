<!-- Wave 4 research lane, compiled 2026-09-07. Copied verbatim from the lane agent's report. -->

> **Lane:** layout. **Date:** 2026-09-07. **Status:** research input, not a decision.
> **Scope.** Spacing, hierarchy, surfaces, measure and per-screen diagnosis, counted rather than estimated across `src/app` and `src/components`.
> **Decisions taken from it** live in `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md`;
> where this file and that spec disagree, **the spec wins** and says why.
>
> **Primary sources**
> - linear.app/now/behind-the-latest-design-refresh — visual weight, softer separators
> - radix-ui.com/themes/docs/theme/spacing — the 4 to 64 px scale; vercel.com/geist/materials — 6/12/16 radii
> - lucide.dev/contribute/icon-design-guide — 24x24 canvas, 2 px strokes
> - w3.org/WAI/WCAG22/Understanding/target-size-minimum.html (24 px) and target-size-enhanced.html (44 px)
> - practicaltypography.com/line-length.html — 45 to 90 characters; m3.material.io/foundations/layout/breakpoints/medium
> - Local counts: 510 raw text-* classes, 198 font-medium against 5 font-normal, --elevation-* used twice, card/background 1.01-1.08:1

---
# Spacing, hierarchy and the premium feel across the real screens

Read: the shell (`AppShell.tsx`, `ShellLayout.tsx`, `wellness/Dock.tsx`), the `(app)` screens, `lesson/LessonView.tsx`, `buddy/Drawer.tsx`, `rewards/*`, `globals.css`, and the wave-4 captures.

## 1. Diagnosis — the design system exists and the screens ignore it

Counts, not impressions (`grep` over `src/app` + `src/components`).

**The type scale is defined and unused.** `globals.css` ships `--text-display / h1 / h2 / h3 / h4 / body / small / micro / code` with per-step line-height, letter-spacing and weight. **Zero** components use them. Instead: 253 `text-sm`, 173 `text-xs`, 29 `text-2xl`, 20 `text-base`, 14 `text-xl`, 8 `text-3xl`, 7 `text-lg` — 84 % of sized text is 14 or 12 px, with no 18 px tier anywhere. Hence one giant heading over an undifferentiated 14 px field: the dashboard jumps 32 → 14 px with nothing between, and de-rot is six identical 14 px paragraphs ending in six identical sentences.

**Weight carries nothing.** 198 `font-medium`, 23 `font-semibold`, 5 `font-normal` — body prose is set at 500. When everything is half-bold nothing is emphatic; [Linear's refresh](https://linear.app/now/behind-the-latest-design-refresh) is explicit that "not every interface element should carry equal visual weight", and dimmed its own sidebar so the work area takes precedence.

**Colour carries no hierarchy either.** From the real tokens: Midnight `muted-foreground` is 9.43:1 on background against `foreground` at 16.06:1 — secondary text only 1.7× quieter. **Paper is 15.60:1 vs 16.99:1, a 1.09× difference: secondary and primary text are visually identical.** `contrast.test.ts` only requires ≥ 4.5:1 there, so 3× of headroom is being thrown away.

**Structure is carried entirely by loud hairlines around invisible cards.** `card` vs `background` is **1.01:1 in Midnight, 1.14:1 in Paper** — the card fill does not exist. `border` vs background is **3.29:1 and 10.57:1**. Every card is a cage around nothing. The `--elevation-xs/sm/md/lg` tokens are used **twice in the whole app** (`LevelBadge.tsx:50`, `Celebration.tsx:543`); no screen uses `shadow-xs/sm/md/lg`. `contrast.test.ts` gates `border` at APCA Lc 45 with no WCAG floor — the loudness is a choice, not a requirement.

**No spacing rhythm.** 12 distinct `space-y` steps (0.5 … 10), 11 `gap` steps, 12 `mt` steps, 6 paddings, 6 radii. `dashboard/page.tsx` alone runs `space-y-7`, `mt-1`, `mt-1.5`, `mt-2`, `mt-3`, `mt-4`, `p-5`, `gap-3`, `pb-5`, `pt-5`. Nothing is a multiple of anything.

**Measure is broken in both directions.** `exercise/[id]/page.tsx:82` uses `xl:grid-cols-[minmax(12rem,0.8fr)_minmax(22rem,1.7fr)_minmax(14rem,0.9fr)]`; at 1280 px the task prose lands at ~200 px ≈ **28 characters per line** (`python-exercise-passed.png`, where the brief is a ragged ribbon and "Examples" is clipped). `LessonView.tsx:218-221` sets `max-w-3xl` (768 px) outside and `max-w-[45rem]` (720 px) inside, so the inner cap can never bind. `/course/[code]` CLO lines run ~110 characters. Butterick's range is 45–90 ([line-length](https://practicaltypography.com/line-length.html)); the skill checklist says 65–75.

**Iconography and controls are three systems.** The header packs a bare 20 px speaker, a bare palette glyph, a text link and a bordered pill into 200 px. De-rot tiles put icons in 32 px chips; the dashboard puts `size-3` (12 px) glyphs inline — a 24-grid 2 px-stroke drawing at 0.5×, i.e. a 1 px stroke that disintegrates ([lucide design guide](https://lucide.dev/contribute/icon-design-guide): "24 × 24-pixel canvas", "strokes must be 2 pixels wide"). And `derot-hub.png` shows six filled "Start" buttons of equal weight — six primary actions on one screen.

## 2. Prescription

**Spacing scale — 8 steps, nothing else.** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px, matching Radix Themes' published `--space-1…9` ([radix-ui.com](https://www.radix-ui.com/themes/docs/theme/spacing)) and Geist's 4-px base. Rhythm: **within a group 8, between groups 16, between sections 32, between page regions 48** — the group-gap escalation that makes Material's 24 dp medium-breakpoint margin and pane spacer read as deliberate ([m3.material.io](https://m3.material.io/foundations/layout/breakpoints/medium)).

**Containers.** Keep `max-w-7xl` + `px-5 sm:px-8` and the 17.5 rem rail. Add three named measures: `--measure-prose: 68ch` (walkthrough, CLO text, briefs), `--measure-form: 34rem` (account, onboarding), `--measure-wide: 100%` (code, tables). Replace the exercise page's fractional grid with `xl:grid-cols-[22rem_minmax(0,1.6fr)_20rem]` so the brief is ≥ 352 px ≈ 62 ch.

**Surfaces — three tiers with fills that exist.** `sunken` (= `background`), `raised` (`card`, retuned to ~1.35:1 in the dark themes, ~1.5:1 in Paper), `floating` (`popover` + `--elevation-md`). Radius **8 / 12 / 16 only**: controls 8, cards 12, sheets and modals 16 — Geist's materials run 6/12/16 from `material-small` to `material-fullscreen` ([vercel.com/geist/materials](https://vercel.com/geist/materials)). Elevation uses the four existing tokens: xs on resting cards, sm on hover, md on popover/drawer/toast, lg on modal and celebration only — and never moves without the fill moving with it.

**Borders and dividers.** Split the token. `--border` stays gated at Lc ≥ 45, reserved for interactive boundaries (inputs, buttons, focusable tiles, ring). Add `--rule` at roughly **1.6:1 in Midnight/Amber, 1.25:1 in Paper** for decorative hairlines, card outlines and separators — WCAG 1.4.11 does not cover purely decorative separators. This single change is what turns Paper from boxes-on-cream into a page. Prefer a fill step over a rule wherever both would work; Linear's refresh cut separator count and softened divider contrast for the same reason.

**Iconography.** One set (lucide, ISC/MIT, already installed), one stroke (2 px at 24), one ladder: **16 px inline, 20 px control, 24 px feature**. Never render lucide below 16 px. No icon chips on de-rot tiles — a 20 px glyph optically aligned to the title cap-height, tinted `muted-foreground`.

**Header and dock proportions.** Header: **56 px** content height (`py-3`, 20 px wordmark, 32 px nav items) instead of today's 68 px — a rule, not a band. Nav items keep a ≥ 24 × 24 CSS px hit area with 8 px gaps ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)); Buddy and the toggles go to 44 px, the [2.5.5 enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) figure. Rail: keep 280 px, internal rhythm 8/16/24, heading at `--text-micro`; align its first label baseline to the H1 baseline rather than the container top (today they miss by ~10 px).

**Per screen.** *Dashboard*: the resume card is the only filled `raised` surface; stats become `--text-h2` numerals over `--text-micro` labels. *Course*: cap the CLO column at `--measure-prose`; one 2 px path connector, not dashed circles at three radii. *Lesson*: prose at **16 px / 1.6** in `foreground`, not 14 px `muted-foreground` — a reading surface must not be set in secondary colour. *Exercise*: fixed columns, all three panels flush-topped, results rows on `--rule`. *De-rot*: one filled "Start", five ghost; "Not attempted yet" to `--text-micro`. *Reports*: tabs on `--rule`, cards on fill. *Account*: one 34 rem column, headings at `--text-h4`.

## 3. Recommendations (numbered, testable)

1. Fail the build on any `text-xs|sm|base|lg|xl|2xl|3xl` in `src/app/(app)` or `src/components`; all sized text uses `text-display|h1|h2|h3|h4|body|small|micro|code`. Target 0 raw sizes (today 510).
2. Restrict spacing utilities to `{1,2,3,4,6,8,12,16}` (4→64 px). Test: no `space-y-|gap-|p-|m*-` with `.5`, `5`, `7`, `9`, `10` outside `src/components/ui`.
3. Restrict radii to `rounded-lg (8) | rounded-xl (12) | rounded-2xl (16) | rounded-full`. Test: no `rounded`, `-xs`, `-sm`, `-md` in screens.
4. Retune `--muted-foreground` into **4.6–6.0:1** on background in all four themes (Paper today 15.60:1), and add an upper bound to `contrast.test.ts`: `>= 4.5` and `<= 7`.
5. Retune `--card` so `wcagRatio(card, background)` is **1.30–1.45** in Midnight/Amber and **1.40–1.60** in Paper (today 1.01 / 1.14); assert both bounds.
6. Add `--rule` per theme; assert `wcagRatio(rule, background) < wcagRatio(border, background)` and `>= 1.15`. Migrate every decorative `border-border` on a non-interactive element to it. `--border` keeps its Lc 45 gate unchanged.
7. Wire `shadow-xs/sm/md/lg` to the four elevation tokens as above. Test: `shadow-lg` appears in ≤ 2 files.
8. Add `--measure-prose: 68ch` and `--measure-form: 34rem`; apply to `LessonView`, the CLO text, the exercise brief and the reports intro. Playwright: at 1280 × 800 every paragraph there measures 55–80 characters.
9. Replace the `exercise/[id]/page.tsx:82` grid with `xl:grid-cols-[22rem_minmax(0,1.6fr)_20rem]`; assert the brief column ≥ 320 px and all three panels sharing a top edge (± 2 px).
10. Fix `LessonView.tsx:218-221`: outer `max-w-5xl`, prose `max-w-[68ch]`, rail 12 rem — the inner cap must actually bind.
11. Body prose becomes `font-normal`; `font-medium` is for labels, buttons and active nav. Test: `font-normal`:`font-medium` ≥ 1:3 (today 5:198).
12. No lucide below 16 px; sizes limited to `size-4|size-5|size-6`. Test: no `size-3`/`size-3.5` on a lucide element. Remove the de-rot icon chips.
13. Header content height 56 px; nav hit areas ≥ 24 × 24 CSS px with ≥ 8 px gaps; Buddy and the toggles ≥ 44 px. Playwright: assert bounding boxes.
14. One filled primary button per screen — count of filled-variant buttons per route ≤ 1; de-rot goes from 6 to 1.
15. Align the rail's first label baseline to the page H1 baseline in `ShellLayout.tsx`; assert the two differ by ≤ 2 px at 1280 × 800.

**Fact vs taste.** Fact: every count and contrast ratio above, computed from the literal `oklch()` tokens in `globals.css`, plus the cited spec numbers. Taste: the three-tier surface model, 8/12/16 radii, the 56 px header, the ranges in items 4–6, and "one filled button per screen". Nothing here changes a route or a behaviour — the shell grid, the 280 px rail and every page's skeleton survive intact.

## Sources

- https://linear.app/now/behind-the-latest-design-refresh — visual weight, softer separators
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://www.radix-ui.com/themes/docs/theme/spacing — 4→64 px scale
- https://vercel.com/geist/materials, https://vercel.com/geist/introduction — 6/12/16 radii
- https://lucide.dev/contribute/icon-design-guide — 24 × 24 canvas, 2 px stroke
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — 24 px
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html — 44 px
- https://m3.material.io/foundations/layout/breakpoints/medium — 24 dp margins
- https://practicaltypography.com/line-length.html — 45–90 characters
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://docs.stripe.com/stripe-apps/design — limited custom styling as consistency
