# Wave 4 — three directions, two judges, one synthesis

**Date:** 2026-09-07
**Inputs:** the seven lane reports in this directory.
**Output:** `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md` (spec addendum) and
`docs/superpowers/plans/2026-09-07-brogram-wave4-plan.md` (task plan).
**Brief:** a premium presentation pass — pure UI and UX, no route or behaviour change. Five
selectable palettes including an extremely dark cinematic one and a white one with elegant serif
type. It must feel deliberate, not generated.

---

## 1. The three directions

### Cinema first — *"the room goes dark so the code can be the brightest thing in it"*

`direction-cinema.md`. **Eclipse** leads: a new near-black `oklch(0.09 0.008 285)` ground with one
violet accent, Archivo caps at 56–72 px, a settle-then-freeze WebGL field confined to `/login`, the
course hero and `/derot`, masked-line GSAP reveals, and a tint-plus-rail guide that moves through
worked code only when the learner advances it. The other four palettes inherit every structural
decision. Nothing loops while code is on screen.

### Editorial first — *"a reading surface with an editor attached"*

`direction-editorial.md`. **Folio** (the relabelled `paper` slot) leads: warm white, ink text, one
indigo mark, Newsreader carrying display and prose through an `opsz` axis. Premium comes from
typographic hierarchy and spent contrast headroom, not chrome — an 18 px prose tier the app has never
had, a `--rule` token so cards stop being cages, and an upper bound on `--muted-foreground` so
secondary text is actually secondary. Exactly one WebGL field, Eclipse-only, absent from Folio.

### Craft first — *"one structure built to a standard, five palettes poured into it"*

`direction-craft.md`. The repo is the argument: the type scale in `globals.css` is used by zero
components (510 raw `text-*` classes instead), `--card` against `--background` measures 1.01–1.08:1,
`--elevation-*` is used twice in the whole app. Premium is a fill that reads, a rule that whispers,
an 18 px tier that exists, and a designed empty state. Eclipse is the *design-of-record* (the most
unforgiving surface, so structure that survives it is correct everywhere) without becoming the
default. Nine acceptance-test families decide whether it landed.

---

## 2. Scores

Two independent Opus judges, five axes, 1–10.

| Direction | Judge | Premium | Learning | Feasibility | Accessibility | Brand | Subtotal |
|---|---|---|---|---|---|---|---|
| **Cinema first** | 1 | 9 | 8 | 7 | 9 | 6 | 39 |
| | 2 | 9 | 8 | 6 | 7 | 9 | 39 |
| | | | | | | | **78** |
| **Craft first** | 1 | 8 | 9 | 7 | 9 | 6 | 39 |
| | 2 | 8 | 9 | 6 | 8 | 7 | 38 |
| | | | | | | | **77** |
| **Editorial first** | 1 | 8 | 9 | 8 | 9 | 5 | 39 |
| | 2 | 8 | 9 | 6 | 6 | 8 | 37 |
| | | | | | | | **76** |

**What both judges said about each.**

- *Cinema* — strongest: the settle-and-freeze shader doctrine, called "the one detail a reviewer
  would call deliberate rather than generated". Weakest, from both: **the reward register**. Across
  eleven screens it names no sound cue, no confetti, no XP odometer, no trophy and no Bro line, and it
  over-generalises "nothing loops while code is on screen" into a static Playground aura — under-spending
  Ruling R7.4 (spec line 1065), the one place the spec explicitly licenses looping motion and the full
  celebration budget.
- *Craft* — strongest: the code guide made testable, and the four-state matrix (empty / loading /
  error / restricted) as a shipping requirement. Weakest: the same register gap, plus a real build
  ordering bug — adopting `typography.md`'s `@theme inline` block reassigns Tailwind's own
  `--text-xs|sm|base|lg|xl` names underneath the 510 live raw call sites the same section bans.
  `globals.css:159-161` chose additive names for exactly this reason.
- *Editorial* — strongest: the reading-surface package (18 px prose in `--foreground` at 68ch, the
  `LessonView` cap fix, the exercise grid retune, tint-plus-rail). Weakest: brand, and a set of
  arithmetic errors — "cards at 1.01:1" (real values 1.046–1.077), a Folio card ratio of 1.40–1.60 that
  is impossible on a warm-white ground, and an unscoped `--muted-foreground` ceiling of 7:1 that would
  *reduce* contrast on Arcade, the theme seeded to every `prefers-contrast: more` user.

---

## 3. The chosen synthesis: **Cinema first, with the Craft standard and the Editorial reading surface grafted in**

Cinema wins on points (78) and on the brief: the owner named the extremely dark cinematic palette
first, and his standing complaint is that the UI is *plain*. A direction that leads with warm white
and then bans atmosphere from it risks answering the complaint with more restraint. Cinema also owns
the single most expensive-looking, cheapest-to-run idea in the wave — the 4500 ms settle-then-freeze.

But Cinema alone loses the wave on its weakest axis. So the ship is Cinema's *register and
staging*, on Craft's *standard*, carrying Editorial's *reading surface*. Concretely:

**From Cinema (the spine).**
1. Eclipse leads: it owns the shader, the wide display face and every screenshot. Persisted IDs stay
   `midnight | amber | paper | arcade`; `eclipse` is added; `paper` is **relabelled** Folio and
   repointed, never renamed — `src/lib/wellness/prefs.ts` already falls back to `midnight` on an
   unknown id, so a rename would silently reset a stored preference.
2. The settle-and-freeze shader contract verbatim: one hand-rolled WebGL2 fullscreen triangle behind
   `dynamic({ssr:false})`, one context ever via a module counter, 0.5x CSS pixels, 30 fps,
   `powerPreference: 'low-power'`, `failIfMajorPerformanceCaveat`, stop at 4500 ms, snapshot to 2D,
   `WEBGL_lose_context`. Inside SC 2.2.2's five seconds, so no pause control is owed.
3. Archivo (OFL) as the licence-clean stand-in for Integral CF, with `--font-display` as the single
   gitignored override point if the owner buys the real face privately.
4. Reveals rationed: masked-line as the house reveal, character reveals on exactly two surfaces.
5. Header and dock pinned through `viewTransitionName: 'site-header'` with `animation: none`.

**From Craft (the standard).**
6. The four-state matrix — empty, loading, error, restricted — designed on every screen the wave
   touches, with restricted defined as the *quietest* surface in the app rather than a dimmed one.
7. Acceptance gates as CI, not as prose: type discipline, spacing set, motion budget, reduced motion,
   bundle, keyboard, states, one-primary-per-screen.
8. One shared `useFlipIndicator` for every indicator that moves between positions.
9. Eclipse as design-of-record but **not** the seeded default: Midnight stays seeded and no stored
   preference migrates.

**From Editorial (the reading surface).**
10. Lesson prose at the 18 px tier in `--foreground`, never `--muted-foreground`, capped at 68ch,
    with the `LessonView.tsx:218-221` fix so the inner cap actually binds.
11. The exercise grid retune to `xl:grid-cols-[22rem_minmax(0,1.6fr)_20rem]`, three panels flush-topped,
    taking the brief from ~28 to ~62 characters.
12. `--rule` split off `--border`, which keeps its Lc 45 gate for interactive edges only.
13. The palette picker as a labelled radio group where every swatch names itself in text.

**From the teaching lane (unanimous across all three).**
14. `CodeGuide.tsx` extracted from `WorkedBlock`, tint plus rail replacing `ring-1 ring-inset`
    (verified: `WorkedBlock.tsx:56-61` scales a 1 px ring and a `rounded-md` corner by `scaleY(n)`,
    so a three-line step renders 3 px edges and a smeared radius), driven by a CSS transition of
    exactly `transform 200ms var(--ease-move)` — a transition retargets mid-flight, a tween restarts.
15. Never auto-advance; `aria-current="step"` with a visually-hidden "Step 2 of 4, lines 3 to 5";
    under reduced motion the band still *arrives* at the new lines and only `transition` becomes `none`.

**Restored, against Cinema's own text (the judges' shared objection).**
16. Ruling R7.4 stands: Playground is the one place decorative motion is the point, and this wave
    spends it there. De-rot hub and run, the level-up headline, the pass moment and the trophy shelf
    keep their sound cue, their odometer and their confetti inside the §7.8 celebration budget.
    "Nothing loops while code is on screen" is a rule about *code screens*, not about the product.

---

## 4. Four corrections this synthesis makes to all three directions

Each was measured, not argued. The spec carries them as rulings W4.3, W4.4, W4.5 and W4.9.

1. **The 1.30–1.45 card-on-background band is unreachable at these grounds.** Measured with a
   byte-for-byte port of `src/lib/theme/contrast.ts`: reaching 1.30 needs `--card` at L 0.28 on
   Midnight's 0.16 ground and L 0.26 on Eclipse's 0.09 — a slab, and the end of near-black. The WCAG
   ratio is dominated by its own `+0.05` flare term at these lightnesses and is the wrong instrument.
   **The gate becomes OKLCH ΔL ≥ 0.06 between `--card` and `--background`** (shipped: 0.070 in all
   four darks), with the WCAG ratio recorded as advisory.
2. **On a light ground the card ratio is bounded by white.** Editorial's Folio target of 1.40–1.60 at
   a `oklch(0.985)` ground is arithmetically impossible: a pure-white card there measures **1.044**,
   and 1.40 would need a ground near L 0.888 — no longer a white palette. Folio's ground moves to
   `oklch(0.972 0.006 85)` (white card = 1.084, ΔL 0.028) and carries depth with `--shadow-xs`, which
   is what §8.5 already says light themes do.
3. **The `--muted-foreground` ceiling must be an Lc *gap*, not a WCAG ceiling.** A 7:1 cap would force
   a contrast *reduction* on Arcade (14.14:1 today), the palette seeded to every `prefers-contrast: more`
   user, and dropping muted text to 4.6:1 would put it at APCA Lc ~32 — failing the repo's own body
   gate by 43 points. The gate becomes: `muted-foreground` stays at **Lc ≥ 75 on every surface it is
   used on**, and sits **≥ 14 Lc below `--foreground` on `--background`**. Shipped gaps: 20.5 / 18.5 /
   24.7 / 23.2 / 19.7.
4. **The type scale is additive, never a redefinition.** `globals.css:159-161` deliberately uses
   `--text-display|h1|h2|h3|h4|body|small|micro|code` instead of Tailwind's `--text-xs|sm|base`. Craft's
   adoption of the `@theme inline` block would redefine `text-sm` under 510 live call sites while the
   same section bans them — no intermediate build is correct. This wave **adds** `--text-lede` (18 px)
   and `--text-hero` (56 px) / `--text-hero-lg` (72 px), moves `--text-body` from 14/1.375 to 16/1.6,
   and migrates call sites screen by screen. Nothing Tailwind owns is reassigned.

A fifth, smaller: `package.json` points `perf:bundle` at `scripts/check-bundle-budget.mjs`, which
**does not exist** (verified). Every bundle assertion in this wave is written against a script the
wave's own T4.9 creates, or deferred to it — no direction may assume it is there.

---

## 5. What did not survive

- **Integral CF.** Page-view-tiered annual web subscription, no redistribution: it cannot be
  sublicensed to a forker of an MIT repo. Archivo (OFL 1.1, real `wdth`/`wght` axes) stands in.
  `--font-display` is the one override point if the owner buys it for himself.
- **A second serif.** Editorial's "one well-cut serif is what a magazine does, two is a mood board" is
  right in principle, but Newsreader's `opsz` axis is what makes it work for display *and* prose, and
  Instrument Serif has no bold. Folio ships **Newsreader only**; Instrument Serif is dropped.
- **Any 3D library.** No `three` (356 KB min), no `ogl`, no `@paper-design/shaders-react`.
- **A "Previous step" control on the worked block.** Backtracking is what real code readers do, but a
  new control is a behaviour change and this pass is presentation only. Logged as the first item for
  the next behavioural pass.
- **Auto-advance, in every form.** No timer, ever.
