<!-- Wave 4 research lane, compiled 2026-09-07. Copied verbatim from the lane agent's report. -->

> **Lane:** references. **Date:** 2026-09-07. **Status:** research input, not a decision.
> **Scope.** Cross-lane evidence: contrast standards, motion specifications, the learning literature behind the guide, typography research and licences, and four products worth stealing from precisely.
> **Decisions taken from it** live in `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md`;
> where this file and that spec disagree, **the spec wins** and says why.
>
> **Primary sources**
> - w3.org/TR/WCAG22 and adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html — WCAG 3 has no contrast algorithm yet, so APCA stays advisory
> - MDN prefers-reduced-motion, Media Queries 5, webkit.org/blog/7551, alistapart.com/article/accessibility-for-vestibular — replace, do not delete
> - drafts.csswg.org/css-view-transitions-1 — the view-transition tree is not exposed to the accessibility tree and the draft does not handle reduced motion
> - Dyson & Haselgrove 2001, Rello & Baeza-Yates 2016 (ACM TACCESS), Wallace et al. 2022 (ACM TOCHI) — measure, dyslexia and per-individual face differences
> - Sarkar, PPIG 2015 — syntax colouring cut task time by ~8.4 s, so no palette may flatten code tokens for mood
> - Stripe docs, ciechanow.ski, linear.app, vercel.com/font — what to borrow and what not to

---
# Wave 4 — References and evidence for the premium presentation pass

Compiled 2026-09-07. Every claim carries a URL. **Fact** = what the source states; **taste** is marked inline. `papers/` holds 7.6 MB of a 50 MB budget: Margulieux 2016, an ERIC worked-examples paper, Busjahn 2015, Sarkar 2015, Rello 2016.

Repo facts checked first: tracked `public/` is **1,374,356 bytes** (`git ls-files public`), ~1.6 MB under the 3 MB cap; fonts load via `next/font/google` in `src/app/layout.tsx` (Geist + Geist_Mono, self-hosted at build, outside tracked `public/`); timing constants sit in `src/lib/motion/tokens.ts`, pinned by `timing.test.ts`; contrast is hand-rolled OKLCH→sRGB in `src/lib/theme/contrast.ts`, gated by `contrast.test.ts`.

---

## 1. Contrast and colour

| Source | Takeaway | Applies in BroGram |
|---|---|---|
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | The only contrast standard legally referenced today: SC 1.4.3 = 4.5:1 body, 3:1 at ≥24 px or ≥18.66 px bold; SC 1.4.11 = 3:1 for UI components and meaningful graphics. | Both new palettes clear the same `contrast.test.ts` gate as the four shipped ones — including the serif palette's hairline rules and the cinematic palette's dim "locked" path-map nodes, which are 1.4.11 graphics. |
| [Roselli, "WCAG3 Contrast as of April 2026"](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html) | **Fact:** WCAG 3 still states "the contrast algorithm used in WCAG 3 is yet to be determined"; APCA was exploratory and was pulled from the July 2023 draft. | Keep APCA `Lc` in `contrast.ts` advisory only; WCAG 2.2 stays pass/fail. |
| [SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 24×24 CSS px minimum, with spacing exceptions. | Palette swatches, lesson progress-rail dots, `spot-the-bug` clickable lines (§10.5). Rail dots are the likeliest failure. |
| [CSS Color 4 — OKLab/OKLCH](https://www.w3.org/TR/css-color-4/#ok-lab) | OKLCH is normative; `L` is perceptual lightness, so equal `L` across hues reads as equal visual weight. | Author all five palettes on one shared `L` ladder: state changes move hue and chroma, never perceived weight. *(Taste — checkable, Rec. 2.)* |

---

## 2. Motion: specifications, and the systems the checklist descends from

| Source | Takeaway | Applies in BroGram |
|---|---|---|
| [MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) · [Media Queries 5](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion) | `reduce` means motion "removed **or replaced**" — replace, not delete. | Confirms R7.9's wording. **Fact:** no credible telemetry on adoption exists; quote no percentage. |
| [WebKit, "Responsive Design for Motion"](https://webkit.org/blog/7551/responsive-design-for-motion/) | Large-area movement, parallax, scaling and spinning are the vestibular triggers; opacity and colour are not. | Licences the core trade: the guide may fade and slide ≤8 px; a shader background may not move at all under `reduce`. |
| [A List Apart, "Accessibility for Vestibular Disorders"](https://alistapart.com/article/accessibility-for-vestibular/) | First-person account; parallax and foreground/background rate mismatch are the named offenders. | Rules out parallax on the cinematic palette's hero — the obvious temptation. |
| [Material 3 easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) | `emphasized-decelerate` is `cubic-bezier(0.05, 0.7, 0.1, 1.0)`; durations tokenised `short1` 50 ms … `long2` 500 ms. | Ancestor of the checklist's "150–300 ms, ease-out"; ours is the same shape, more aggressive. **Do not adopt M3 tokens** — cite it in review to defend the curve. |
| [Apple HIG — Motion](https://developer.apple.com/design/human-interface-guidelines/motion) · [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Motion communicates a change; Reduce Motion is honoured with a *substitute*, Apple's being a cross-fade. | Matches R7.9's "directional slides become cross-fades". |
| [CSS View Transitions Level 1 (ED)](https://drafts.csswg.org/css-view-transitions-1/) | **Fact:** "The view transition tree is not exposed to the accessibility tree"; a failed animation never blocks the DOM change; the draft does **not** handle `prefers-reduced-motion`. | Reduced-motion for `<ViewTransition>` is ours to write; no content may live only inside a view-transition pseudo. |
| [GSAP Standard License](https://gsap.com/community/standard-license/) · [Webflow announcement](https://webflow.com/blog/gsap-becomes-free) | **Fact:** free for commercial use including every former Club plugin since 30 April 2025, but **not open source** — Webflow retains IP, and use inside a no-code animation builder is prohibited. | GSAP stays an npm dependency, never vendored; SplitText is the sanctioned route for display-type reveals. |

---

## 3. The moving teaching guide — the evidence for it

The best-supported idea in the directive, provided it is built as **signalling**, not decoration.

| Source | Takeaway | Applies in BroGram |
|---|---|---|
| [Alpizar & Adesope et al., *ETR&D* 2020](https://link.springer.com/article/10.1007/s11423-020-09748-7) | 44 effect sizes, 29 studies, 2,726 participants: signalling reliably raises learning outcomes. | The highlight band following the worked example *is* a signal — the best-backed element in the pass. |
| [Schneider et al., *Educational Research Review* 2018](https://www.sciencedirect.com/science/article/abs/pii/S1747938X17300581) | 103 studies, 12,201 participants: retention g+ = 0.53, transfer g+ = 0.33. | Numbers for the spec, so this survives a scope cut as "polish". |
| [Margulieux, Catrambone & Guzdial 2016](https://bpb-us-e1.wpmucdn.com/sites.gatech.edu/dist/b/1555/files/2020/09/MargulieuxCatramboneGuzdial2016.pdf) | Grouping *and labelling* a worked solution by subgoal improves construction, retention and transfer; labelled prose helps only when the example is labelled too. | The guide moves between **labelled groups of lines**, not line by line, rendering a short subgoal label beside the band. The label is the mechanism; motion only draws the eye. |
| [Busjahn et al., *ICPC* 2015](https://cs.uef.fi/pages/bednarik/ICPC2015_authors_version.pdf) | Novices read code far more linearly (prose-like); non-linear reading grows with expertise. | Our learners are novices, so top-to-bottom matches how they read. An execution-order guide that jumps into a function body and back is expert behaviour and fights the reader. |
| [Sarkar, *PPIG* 2015](https://advait.org/files/sarkar_2015_syntax_colouring.pdf) | Eye-tracked, randomised, within-subjects: syntax colouring cut task time by ~8.4 s on average; the benefit weakens with experience. | The cinematic palette may not flatten CodeMirror tokens for mood. Every palette needs its own tested token set. |
| [CS1 Subgoals publications](https://www.cs1subgoals.org/publications/) (worked-example / split-attention line) | Separated but mutually-referring sources impose extra load. | Callout text sits adjacent to the highlighted lines, never in a side panel — a constraint on the 720 px lesson column. |

---

## 4. Typography: reading evidence and licences

| Source | Takeaway | Applies in BroGram |
|---|---|---|
| [Dyson & Haselgrove, *IJHCS* 2001](https://www.sciencedirect.com/science/article/abs/pii/S1071581901904586) | ~55 characters per line beat 25 cpl for comprehension at normal reading speed. | Backs 65–75 as an upper bound and validates the 720 px column. Set the measure in `ch`, not px, so it survives the serif palette's different average character width. |
| [Rello & Baeza-Yates, *ACM TACCESS* 2016](https://www.superarladislexia.org/pdf/2016-Luz%20Rello-Fonts-taccess.pdf) | Sans-serif, **monospaced** and roman styles measurably outperformed serif, proportional and italic for dyslexic readers. | Hard limit on the white palette: serif is display and headings only. Body stays Geist, code Geist Mono, no italic body runs. |
| [Wallace et al., *ACM TOCHI* 2022](https://dl.acm.org/doi/10.1145/3502222) | Different faces measurably speed reading for different individuals; there is no single best font. | The evidence *for* five palettes as a real preference, not a skin. Persist the choice in `wellness.prefs` beside the theme. |
| [Connary Fagen — Integral CF](https://connary.com/fonts/integral/) | **Fact:** by Connary Fagen (not Fontfabric). Desktop from **$29.99** per style; Essentials (4) **$69.99**; Family (12) **$221.99**; web is a **yearly page-view-tiered subscription**. | Incompatible with an MIT repo redistributing font files — a page-view subscription cannot be sublicensed to forkers. |
| OFL 1.1 substitutes: [Anton](https://fonts.google.com/specimen/Anton), [Big Shoulders](https://fonts.google.com/specimen/Big+Shoulders), [Archivo](https://fonts.google.com/specimen/Archivo), [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif), [Newsreader](https://fonts.google.com/specimen/Newsreader); [licence text](https://openfontlicense.org/). Geist is also [OFL 1.1](https://github.com/vercel/geist-font/blob/main/LICENSE.TXT). | Heavy condensed all-caps titling — Integral's actual job — is covered by Anton or Big Shoulders Display; Instrument Serif and Newsreader are the elegant-serif candidates. | Two display faces maximum across five palettes, loaded through `next/font/google` so nothing lands in tracked `public/`. |

---

## 5. Four products worth stealing from, precisely

1. **Stripe docs** — [docs.stripe.com/quickstarts](https://docs.stripe.com/quickstarts), build described at [stripe.dev/blog/markdoc](https://stripe.dev/blog/markdoc). **Borrow:** prose↔code synchronised highlighting — hovering a paragraph lights the lines it describes, removing the translation step between concept and implementation; the closest shipping thing to "a guide that moves through code". **Don't borrow:** the three-column layout; our lesson is one 720 px column, and Stripe's columns serve reference-scanning experts, not novices reading linearly (§3).
2. **Bartosz Ciechanowski** — [ciechanow.ski](https://ciechanow.ski/). **Borrow:** every visual is manipulable and load-bearing — no diagram the reader cannot poke — plus near-zero chrome and no brand motion. **Don't borrow:** bespoke per-article WebGL; his pages are read once at leisure, ours is a daily tool with a chunk budget, and his work carries no reuse licence.
3. **Linear** — [linear.app](https://linear.app), read-out in [LogRocket's teardown](https://blog.logrocket.com/ux-design/linear-design/). **Borrow:** the near-black canvas where content emerges from darkness, aggressive negative letter-spacing at display sizes, one mid-weight (~510) doing the work of regular and semibold — the reference for the cinematic palette. **Don't borrow:** the typeface; Linear runs Inter Variable, banned by plan §2.7. Take the tracking curve and weight strategy, apply them to Geist.
4. **Vercel / Next.js docs** — [vercel.com/font](https://vercel.com/font). **Borrow:** Geist's own display treatment, and the proof that one family plus one mono, tightly tracked, reads premium with no paid face. **Don't borrow:** the gradient/WebGL hero — over the initial-chunk budget, and plan §2.9 forbids a Vercel-only learner-facing path.

---

## Recommendations

1. **No palette ships until `contrast.test.ts` passes for all five**, WCAG 2.2 pass/fail, APCA advisory. Extend the `globals.css` parser and key-set-parity assertion to both new `[data-theme]` blocks.
2. **Assert an equal-`L` ladder.** Test that `--muted-foreground`, `--border` and `--card` share OKLCH `L` within ±0.02 across all five blocks — this is what stops five palettes reading as five moods of unequal weight.
3. **Do not ship Integral CF.** Anton or Big Shoulders Display (OFL 1.1) for the cinematic display face; Instrument Serif or Newsreader (OFL 1.1) for the white palette. If the owner wants Integral CF personally, gate it behind a gitignored local override with a documented swap. Testable: `git ls-files public` shows no `.woff2` and tracked `public/` stays under 3 MB.
4. **Serif is display-only.** Test that no `--font-serif` token reaches `body`, `p`, `li` or any CodeMirror class, and that no palette sets italic body text (Rello 2016).
5. **The guide moves between labelled subgoal groups, top to bottom, never in execution order** (Margulieux 2016 + Busjahn 2015). Testable: a fixture with N groups yields exactly N stops, each with a non-empty label, in source order.
6. **The guide animates opacity plus a ≤8 px transform only**, `EASE.move` at `DUR.base` (200 ms), per §10.5. Under the resolved reduced-motion boolean it jumps with no transform and the previous callout dims by opacity alone. Extend `timing.test.ts` to its tween config.
7. **Write our own reduced-motion rule for `<ViewTransition>`**: `@media (prefers-reduced-motion: reduce) { ::view-transition-old(*), ::view-transition-new(*) { animation: none } }` plus the resolved-boolean opt-out — and keep no content exclusive to a view-transition pseudo.
8. **M3 and Apple stay in review notes, not in code.** `src/lib/motion/tokens.ts` remains the single source of timing; no new easing constant lands without a `timing.test.ts` band.
9. **Every palette carries its own CodeMirror token set, tested against 1.4.3 and 1.4.11** (Sarkar 2015). The cinematic palette may not desaturate code tokens below the thresholds the others meet.
10. **Any WebGL or shader surface is decorative-only, lazy-imported, and absent under reduced motion** — never behind text that must be read, never on `/exercise/[id]`, never in the initial chunk. Testable: assert it is absent from first-load JS for `/exercise/[id]`.
11. **Add a GSAP row to the licence table**: free-for-commercial but proprietary, consumed as an npm dependency, never vendored — so an MIT forker is not misled.
12. **Never quote a reduced-motion adoption percentage.** No credible telemetry exists; justify the work from the vestibular literature instead.
