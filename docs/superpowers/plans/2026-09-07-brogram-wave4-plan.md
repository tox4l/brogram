# BroGram Wave 4 Build Plan — the premium presentation pass

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` for every Claude task, `superpowers:requesting-code-review` before every merge point. **Every task in this wave is offered to Codex first** through `/codex:rescue --background --fresh` with a prompt file under `docs/prompts/astra-tasks/wave4/`; Claude builds it the moment the sandbox is down, which it has been since the v2 program opened. Steps use checkbox (`- [ ]`) syntax; tick them in `openspec/changes/brogram-launch/tasks.md`, not here.

**Goal.** Ship `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md` — five palettes, one structure, a guide that moves through code — in **one wave of twelve tasks** on disjoint paths in one shared working tree on `main`. **Nothing in this plan changes a route, a hook's return value, a contract field's meaning, or an agent trigger.** The only contract edit in the wave is one string literal.

**Spec:** `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md` (wave 4, authoritative for presentation)
**Extends:** `docs/superpowers/specs/2026-09-06-brogram-v2-bro.md` (v2 — every ruling stands)
**Research:** `docs/research/v2/wave4/` (seven lanes + `directions.md`)
**Ledger:** `openspec/changes/brogram-launch/tasks.md` — this plan adds a `## wave4` section with one row per task
**Build log:** `docs/build-log.md` — every W4 ruling gets a dated line as it lands

---

## 1. How this wave is executed

### 1.1 The parallel model, unchanged from v2

One working tree, one branch (`main`), no worktrees, no PRs against a fork of the tree.

- **Group A** starts immediately: T4.0 first and alone for one commit (it owns the token layer everything else reads), then T4.1–T4.4 in parallel behind it.
- **Group B** starts when T4.0, T4.1 and T4.2 have committed. T4.5–T4.9 are five parallel screen sweeps on five disjoint directories.
- **Group C** is the serial tail: T4.10 (the budget script and the e2e battery, which can only measure a finished tree) then T4.11 (review, build log, ledger).
- **Every task owns an exclusive set of paths for the whole wave.** Two tasks never name the same file. §4 is the contract; a task that discovers it needs a file it does not own **stops and reports** rather than editing it.
- Between commits inside the wave the tree may fail a lint gate (T4.1 lands gates that T4.5–T4.9 are still satisfying). It must never fail at the **wave gate** (§8).

### 1.2 Git discipline — non-negotiable, carried verbatim from v2 §1.2

```bash
git add <exact paths this task owns> && git commit -m "<type>(<scope>): <subject>"
```

**Never** `git reset`, `git checkout --`, `git stash`, `git clean`, `git restore <path>` (without `--staged`), or `git rebase` in this tree. `git add -A` and `git add .` are **banned** — they sweep in another agent's in-flight edits. Unstage with `git restore --staged <path>` only. No push until the wave gate is green; `git push origin main` is a controller action, once.

### 1.3 Models

| Work | Implement | Review |
|---|---|---|
| Tokens, colour math, contrast gates, lint scripts | **Sonnet** | **Opus**, and the palette verification is a named review step with a failing test behind it |
| Motion primitives, the shader, the code guide | **Sonnet** | **Opus** (+ Codex cross-review when up) |
| Screen sweeps (T4.5–T4.9) | **Sonnet**, or **Codex** when its sandbox is up | **Opus** |
| The e2e battery and the bundle script | **Sonnet** | **Opus** |
| Whole-wave review and the gate | — | **Opus** |

**Every task gets an Opus review before the wave gate.** A review that finds a Critical sends a fix round to the same implementing agent; a review that finds nothing is recorded in `docs/build-log.md` with the word "clean".

### 1.4 Codex, offered first, waited on never

**Every task below is offered to Codex first.** Its sandbox has been down since the v2 program opened, so the default path is Claude. If it recovers:

- Give it, in this order, the tasks marked `Codex-preferred`: **T4.5** (shell, dock, Account — the largest mechanical sweep), **T4.6** (dashboard, courses, course home), **T4.9** (reports, login, onboarding), **T4.7** (exercise).
- Codex is **serial**: one write-capable Codex task at a time in this tree. Everything else in the group stays on Claude subagents in parallel.
- **Capacity valve (v1 §16, and the default here).** If Codex is the critical path at any checkpoint, the Claude lane builds and Codex reviews before merge instead of writing. **Do not wait on Codex. Ever.**
- Codex cross-review is reached through Bash, not a tool call:
  `node "C:/Users/musal/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs" review --base main` with `run_in_background: true`.

---

## 2. Standing constraints (every task, every commit)

1. **Every existing test stays green.** `npx vitest run` is part of every task's acceptance and the wave gate. A task may change **only** the existing test files on its own row of §5.
2. **Pure presentation.** No route added, removed or renamed. No `page.tsx` gains or loses a data fetch. No hook changes what it returns. No `useState` moves. If a diff changes behaviour, it is out of scope — stop and report.
3. **The seven agent triggers are frozen.** Nothing here calls, mounts or reveals its way into an agent.
4. **Contracts are frozen** except the single `ThemeName` literal in T4.0, landed in both byte-identical copies in one commit.
5. **English only. No emoji in UI copy. No institution names.**
6. **MIT-licensable assets only.** Every added face is OFL 1.1 via `next/font/google`. No font binary enters `git ls-files`. GSAP stays an npm dependency under its proprietary Standard "No Charge" licence and is named as such in third-party notices.
7. **The celebration budget and the motion law hold** (v2 §7.8): 600–900 ms for positive moments only; `transform` and `opacity` only; never `ease-in`, `transition: all`, or animated `width|height|top|left`; enter from `scale(0.95)`; exit faster than enter; stagger 30–50 ms under 300 ms total.
8. **Juice fires at transitions, never during composition.**
9. **Enforcement surfaces get no personality and no juice** — no motion, no sound, no shader on lockdown, integrity or account-status, in either motion mode.
10. **Reduced motion is the resolved boolean** from `useReducedMotion()`, never `gsap.matchMedia()`. A component that animates without reading it fails review.
11. **WCAG 2.2 pass/fail, APCA advisory**, both through `src/lib/theme/contrast.test.ts`.
12. **Tracked `public/` stays at 1,374,356 bytes.** `howler`, `canvas-confetti` and every line of WebGL stay out of the initial chunk.
13. **`src/app/preview/**` is out of scope for this wave** — a dev-only surface with its own test. It is excluded from the T4.1 lint globs by name, not by accident, and its 11 hard-coded palette classes are logged as a follow-up.
14. `.env.example` is the only committed env file and never holds a value.

---

## 3. Corrections this plan carries against its own spec's sources

**W1 — `scripts/check-bundle-budget.mjs` does not exist.** `package.json` has pointed `perf:bundle` at it since v2 T0.0. **T4.10 creates it.** No task before T4.10 may assert a bundle number, and the wave gate runs `perf:bundle` only after T4.10 lands.

**W2 — `:root[data-motion]` does not exist in the tree.** The reduced-motion kill switch for `<ViewTransition>` needs it because React does not read the in-app override. **T4.2 writes it** from the same effect that already resolves `useReducedMotion()` — one attribute on `<html>`, no new state, no new hook.

**W3 — the `@custom-variant dark` list is a real coupling.** `globals.css:13` enumerates `[data-theme="midnight"|"amber"|"arcade"]`, and `src/lib/theme/dark-variant.test.ts` pins it. Adding `eclipse` without adding it to that list leaves every `dark:` utility silently off in the new palette. **T4.0 lands both in one commit.**

**W4 — `THEMES` swatch literals are pinned.** `src/lib/theme/themes.ts` carries hand-copied `oklch(...)` triples that `contrast.test.ts` compares against the parsed `globals.css`. Every retune in T4.0 updates both sides in the same commit or that assertion fails.

---

## 4. File ownership map

One row per task. **No path appears twice.** `→` means "created by".

| Task | Owns |
|---|---|
| **T4.0** | `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/theme/**`, `src/lib/contracts.ts`, `docs/contracts/brogram-contracts.ts` |
| **T4.1** | `scripts/check-design-tokens.mjs`→, `src/lib/design/**`→, `package.json` (one script row) |
| **T4.2** | `src/lib/motion/**`, `src/components/motion/**`→, `src/app/providers.tsx` |
| **T4.3** | `src/components/visual/**`→ |
| **T4.4** | `src/components/lesson/**`, `src/app/(app)/lesson/**`, `scripts/verify-lesson.mjs`, `scripts/verify-lesson.test.mjs`, `seed/lessons/lesson.schema.json` |
| **T4.5** | `src/components/shell/**`, `src/components/wellness/**`, `src/components/buddy/**`, `src/components/ui/**`, `src/app/(app)/account/**`, `src/components/account/**` |
| **T4.6** | `src/app/(app)/dashboard/**`, `src/app/(app)/courses/**`, `src/app/(app)/course/**`, `src/components/course/**` |
| **T4.7** | `src/app/(app)/exercise/**`, `src/components/exercise/**` |
| **T4.8** | `src/app/(app)/derot/**`, `src/components/derot/**`, `src/components/rewards/**`, `src/components/play/**` |
| **T4.9** | `src/app/(app)/reports/**`, `src/components/report/**`, `src/app/(auth)/**`, `src/app/(app)/onboarding/**`, `src/app/page.tsx` |
| **T4.10** | `scripts/check-bundle-budget.mjs`→, `e2e/motion.spec.ts`→, `e2e/measure.spec.ts`→, `e2e/shader.spec.ts`→, `e2e/palette.spec.ts`→ |
| **T4.11** | `docs/build-log.md`, `openspec/changes/brogram-launch/tasks.md` |

Not owned by anybody this wave, and therefore not edited: `src/app/preview/**`, `src/hooks/**`, `src/lib/agents/**`, `src/lib/curriculum/**`, `src/lib/query/**`, `src/lib/learner/**`, `supabase/**`, every API route.

---

## Group A

### T4.0 — Tokens, five palettes, two faces, and the contrast gate (serial, first, alone)

**Model:** Sonnet. **Review:** Opus, then a second adversarial Opus pass on the palette blocks (frozen surface).
**Depends on:** —
**Codex-preferred:** no — colour math and a frozen contract copy stay in the Claude lane.
**Spec:** §2, §3.1–3.4.

**Files**
- Edit: `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/theme/themes.ts`, `src/lib/theme/contrast.ts`, `src/lib/theme/contrast.test.ts`, `src/lib/theme/dark-variant.test.ts`, `src/lib/contracts.ts`, `docs/contracts/brogram-contracts.ts`

**Interfaces produced**
```ts
export type ThemeName = 'midnight' | 'amber' | 'eclipse' | 'arcade' | 'paper'  // 'eclipse' added
export const THEMES: readonly { id: ThemeName; name: string; blurb: string; swatch: [string,string,string] }[]
export function deltaL(a: string, b: string): number   // OKLCH lightness distance, contrast.ts
```

- [ ] **Step 1: the five `[data-theme]` blocks.** Copy the five palettes from spec §2.3 **verbatim**, each setting its own `color-scheme` and `--radius`. `paper` keeps its id and takes the Folio values. Every block defines the **identical key set**, including the twelve new tokens and the nine `--code-*`; `--shader-a` / `--shader-b` are Eclipse-only and are therefore declared as `transparent` in the other four so key-set parity holds. Register each new token in `@theme inline` as `--color-*`, the same shape as `--color-celebration`.
- [ ] **Step 2: `@custom-variant dark`** (`globals.css:13`) gains `[data-theme="eclipse"] *`, and `dark-variant.test.ts` gains the matching assertion. Both in this commit (correction W3).
- [ ] **Step 3: the type scale, additive only** (spec §3.2). Move `--text-body` to `1rem` / `1.6`; add `--text-lede`, `--text-hero`, `--text-hero-lg`; add `--font-display` and `--font-prose` reading `--font-display-face` / `--font-prose-face`, which each `[data-theme]` block sets. **No Tailwind `--text-xs|sm|base|lg|xl` name is redefined.** Add the `.display-caps` utility (`text-transform: uppercase; letter-spacing: 0.03em; font-variation-settings: 'wdth' 118, 'wght' 850`) and a `.tabular` utility if one is not already present.
- [ ] **Step 4: the motion and view-transition CSS** (spec §5.3), which lives in this file because this task owns it: `::view-transition { pointer-events: none }`, the `site-header` group rules, and the two-selector reduced-motion kill switch (media query **and** `:root[data-motion='reduced']`).
- [ ] **Step 5: `layout.tsx` — the two faces.** `Archivo` with `axes: ['wdth']` and `Newsreader` with `axes: ['opsz']`, both `next/font/google`, `subsets: ['latin']`, `display: 'swap'`, `preload: false`, exposed as `--font-archivo` and `--font-newsreader`. Geist Sans and Geist Mono are untouched. Nothing lands in `public/`.
- [ ] **Step 6: `themes.ts`** — five entries, `paper` relabelled `"Folio"`, every `swatch` triple re-copied from the new blocks (correction W4).
- [ ] **Step 7: `contracts.ts`** — add `'eclipse'` to `ThemeName` in both copies, byte-identical. Nothing else in either file changes.
- [ ] **Step 8: `contrast.ts`** — add `deltaL(a, b)` and an in-gamut predicate. Both are pure functions over the existing parser.
- [ ] **Step 9: `contrast.test.ts` — the gate (spec §10 family A).** Extend the parser to five blocks and add: key-set parity across all five; sRGB round-trip inside `[-0.001, 1.001]` for every `oklch()`; `deltaL(card, background)` 0.06–0.09 in the four darks and ≥ 0.02 in Folio; `muted-foreground` at Lc ≥ 75 and ≥ 4.5:1 on `background`, `card` **and** `muted`, and ≥ 14 Lc below `foreground` on `background`; `wcagRatio(rule, background)` in [1.25, 1.90] and `apcaLc(rule, background) < apcaLc(border, background)`; all nine `--code-*` at Lc 75 on `--lesson-code-surface` with `--code-comment` at Lc 60; `--guide` at ≥ 3:1 on `--lesson-code-surface`; `deltaL(success, warning) ≥ 0.10` in **all five**; no `[data-theme]` block defines a `--text-*` token.

**Acceptance**
```bash
npx vitest run src/lib/theme src/lib/contracts.test.ts
npx vitest run
npx tsc --noEmit
npm run build
```
Manual: pick each of the five in turn — background, text, primary and accent change together, no white flash, no half-themed component. Reload on Folio: still Folio. Clear `localStorage`, set the OS to high contrast, reload: Arcade.

**Existing tests it may change:** `src/lib/theme/contrast.test.ts` (additions and the five-block parser), `src/lib/theme/dark-variant.test.ts` (additions).
**Review (Opus):** no component branches on theme; the five blocks define an identical key set; `color-scheme` is per block; the two contract copies are byte-identical; the contrast test genuinely fails when a value is nudged — prove it by breaking one and re-running.
**Commit:** `git add src/app/globals.css src/app/layout.tsx src/lib/theme src/lib/contracts.ts docs/contracts/brogram-contracts.ts && git commit -m "feat(theme): five verified OKLCH palettes, --rule and code tokens, additive 18px scale, two OFL display faces"`

---

### T4.1 — The design-discipline gates

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T4.0
**Codex-preferred:** no.
**Spec:** §10 family B.

**Files**
- Create: `scripts/check-design-tokens.mjs`, `src/lib/design/discipline.test.ts`
- Edit: `package.json` (one script row: `"design:check": "node scripts/check-design-tokens.mjs"`)

**Interfaces produced:** `npm run design:check`, exit 1 with a file:line list on any violation.
**Interfaces consumed:** —

- [ ] **Step 1: the scanner.** Pure Node over `src/app/**` and `src/components/**`, excluding `src/components/ui/**` for the type rule and `src/app/preview/**` entirely (constraint 13). Six rules, each reported separately with counts and a file:line list:
  1. raw `\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b` — **506 today, target 0**
  2. hard-coded palette classes `(text|bg|border|ring|from|to|via)-(emerald|slate|zinc|neutral|gray|red|amber|green|blue|cyan|violet|rose|orange|yellow|sky|indigo|teal|lime|fuchsia|pink|purple|stone)-\d{2,3}` — **81 today, target 0**
  3. spacing utilities outside `{1,2,3,4,6,8,12,16}`
  4. radii outside `rounded-(lg|xl|2xl|full)`
  5. `size-3`, `size-3.5` or smaller on a lucide element
  6. `transition: all`, `ease-in`, and animated `width|height|top|left` anywhere in `src/`
- [ ] **Step 2: the ratio and count rules.** `font-normal : font-medium` at least 1 : 3 (**5 : 198 today**). At most one filled-variant `Button`/`buttonVariants({ variant: 'default' })` per route file (**6 on `/derot` today**). `will-change: transform` in at most three selectors.
- [ ] **Step 3: `discipline.test.ts`** runs the scanner in-process and asserts zero violations, with **per-rule allowlists carrying an explicit expiry note naming the task that clears them** — T4.5 through T4.9 delete their own entries. An allowlist with no owner is a review failure.
- [ ] **Step 4:** a header comment naming this file as the thing to extend when a new discipline rule is agreed, and a ledger row.

**Acceptance**
```bash
npm run design:check      # exits 1 today with six counted rules; the allowlist keeps the test green
npx vitest run src/lib/design
npx vitest run
```

**Existing tests it may change:** none.
**Review (Opus):** the scanner does not regex over `.css`; every allowlist entry names the task that removes it; the rule set matches spec §10 family B exactly, with nothing added and nothing softened.
**Commit:** `git add scripts/check-design-tokens.mjs src/lib/design package.json && git commit -m "test(design): counted discipline gates for type, palette classes, spacing, radii and motion"`

---

### T4.2 — Motion primitives: eases, `<Reveal>`, `useFlipIndicator`, the motion attribute

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T4.0 (the CSS half of the kill switch)
**Codex-preferred:** no — the React Compiler lint rules make this the highest-risk hook work in the wave.
**Spec:** §5.

**Files**
- Edit: `src/lib/motion/tokens.ts`, `src/lib/motion/timing.test.ts`, `src/app/providers.tsx`
- Create: `src/lib/motion/eases.ts`, `src/lib/motion/eases.test.ts`, `src/components/motion/Reveal.tsx`, `src/components/motion/Reveal.test.tsx`, `src/components/motion/useFlipIndicator.ts`, `src/components/motion/useFlipIndicator.test.tsx`

**Interfaces produced**
```ts
export const DUR: { …existing…, guide: 260 }
export function registerEases(): void                      // CustomEase.create over all four EASE entries
export function Reveal(props: { mode: 'lines'|'words'|'chars'|'fade'; reduced: boolean; children: string }): JSX.Element
export function useFlipIndicator(container: RefObject<HTMLElement>, activeKey: string, reduced: boolean): void
```

- [ ] **Step 1: `DUR.guide = 260`** and a `timing.test.ts` addition pinning it inside the 200–300 ms movement band.
- [ ] **Step 2: `eases.ts`** — `registerEases()` calls `CustomEase.create(name, points)` for all four `EASE` entries, parsing the existing `cubic-bezier()` strings with the `bezierTuple` helper that already exists. Called once from the client module that runs `gsap.registerPlugin(useGSAP, CustomEase, SplitText, Flip)`. Test: `gsap.parseEase('enter')(0.25) === 0.765 ± 0.001`, and a source scan asserting no `ease: 'power|back|elastic` outside `src/lib/motion/`.
- [ ] **Step 3: `<Reveal>`** over `SplitText.create({ type, mask: 'lines', aria: 'auto', autoSplit: true, onSplit })`. `children` is **typed to `string`** — `aria: 'auto'` hides every generated child, so a link or `<code>` inside would be silenced. `mode="chars"` throws in development unless the caller passes `surface="onboarding-hook" | "level-up"`; those are the only two licensed surfaces. Under `reduced`, return the children unsplit and never call `SplitText`.
- [ ] **Step 4: `useFlipIndicator`** on `Flip.getState` → reposition → `Flip.from(state, { duration: DUR.guide / 1000, ease: 'move', scale: true, absolute: true })`. Under `reduced` it positions with one `gsap.set` and never calls `Flip.from`. It owns the dock lane indicator and the tab underline; a header comment states that the code guide deliberately does **not** use it (spec W4.20).
- [ ] **Step 5: `providers.tsx`** writes `data-motion="reduced" | "full"` on `<html>` from the same effect that already resolves `useReducedMotion()` (correction W2). No new state, no new hook, no `setState` inside any `useGSAP` callback, no `ref.current` read during render.
- [ ] **Step 6: tests** on the `rewards.test.tsx` model — `vi.mock('gsap', importOriginal)` keeping `context`/`add`/`revert` real so `useGSAP`'s lifecycle runs, spying only `to`/`set`/`fromTo`/`killTweensOf`. Assert decisions, not pixels: reduced motion took the `set` branch; `ease` is `'enter'`; `duration === DUR.x / 1000`; `killTweensOf` ran first; under `reduce` the DOM has no split nodes and `textContent` is unchanged.

**Acceptance**
```bash
npx vitest run src/lib/motion src/components/motion
npx eslint src          # set-state-in-effect and refs are error; must stay clean
npx vitest run
```

**Existing tests it may change:** `src/lib/motion/timing.test.ts` (additions only).
**Review (Opus):** no `setState` in a `useGSAP` callback; every tween created in an event handler is `contextSafe`; SSR never touches `gsap.*`; `chars` is unreachable outside the two named surfaces; `Reveal` under reduced motion produces byte-identical `textContent`.
**Commit:** `git add src/lib/motion src/components/motion src/app/providers.tsx && git commit -m "feat(motion): one curve for GSAP and CSS, rationed Reveal, shared Flip indicator, resolved motion attribute"`

---

### T4.3 — `ShaderSurface` and the settle-and-freeze field

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T4.0 (`--shader-a`, `--shader-b`), T4.2 (`useReducedMotion` call shape unchanged, but the attribute must exist)
**Codex-preferred:** no.
**Spec:** §6.

**Files**
- Create: `src/components/visual/ShaderSurface.tsx`, `src/components/visual/ShaderField.tsx`, `src/components/visual/field.glsl.ts`, `src/components/visual/ShaderSurface.test.tsx`, `src/components/visual/context.ts`

**Interfaces produced**
```tsx
export function ShaderSurface(props: { preset?: 'aurora'; motionPref: MotionPreference; className?: string }): JSX.Element
```

- [ ] **Step 1: the wrapper.** `ShaderSurface` is cheap and always safe: it paints the **static CSS floor** (two `radial-gradient`s in `--shader-a` / `--shader-b` token space) unconditionally, resolves `useReducedMotion(motionPref)` and `resolvedTheme` **before** the dynamic import, and mounts `ShaderField` only when `!reduced && resolvedTheme === 'eclipse'`. `aria-hidden="true"`, `pointer-events-none`, `data-shader-surface={preset}`. Hooks run unconditionally before any branch.
- [ ] **Step 2: the lazy chunk.** `dynamic(() => import('./ShaderField'), { ssr: false, loading: () => null })`, so the GLSL and the GL code ride one chunk and never appear in a route's client-reference manifest.
- [ ] **Step 3: `context.ts`** — a module-level counter. The second concurrent mount returns `null`. One WebGL2 context ever, because a renderer caps near 16 live contexts and kills the oldest, and this app client-routes dozens of times a session.
- [ ] **Step 4: the field.** One fullscreen triangle, one fragment shader, hand-rolled. Context attributes **exactly** as spec §6.2. `RENDER_SCALE = 0.5` against CSS pixels with `devicePixelRatio` ignored; `FPS_CAP = 30`; the loop gated on `IntersectionObserver` and `document.visibilityState`; a bail before creating anything if `navigator.connection?.saveData`. Colours read from computed style at init — **zero `vec3(` colour literals in the GLSL** — plus a ±1/255 hash dither, without which a two-stop near-black field bands on OLED.
- [ ] **Step 5: the freeze.** At `SETTLE_MS = 4500`: stop the loop, `ctx2d.drawImage(canvas, 0, 0)` into a sibling 2D canvas, unmount the GL canvas, then `gl.getExtension('WEBGL_lose_context')?.loseContext()`. Re-key on a live palette switch, or the frozen Eclipse-violet snapshot survives a switch to Midnight. The canvas fades in over `--duration-slow` on the first drawn frame, so a failed context, a slow compile and a reduced-motion learner all look the same with no flash and no CLS.
- [ ] **Step 6: tests.** Mount two, assert one `<canvas>`. Assert the context-attribute object against a fake `getContext`. Assert `canvas.width === Math.round(cssWidth * 0.5)` after a `ResizeObserver` tick. Assert that with `reduced` true no import is attempted and no canvas exists. Grep the GLSL string for `vec3(` colour literals — zero hits. (The timing and context-loss probes are Playwright's, in T4.10.)

**Acceptance**
```bash
npx vitest run src/components/visual
npx vitest run
npm run build
```
Manual, in Eclipse: the field settles and stops inside five seconds and the frame stays. Switch to Midnight: the surface becomes the CSS floor immediately. Emulate reduced motion: no canvas in the DOM, no shader chunk in the network panel.

**Existing tests it may change:** none.
**Review (Opus):** no text, icon or control sits over live shader pixels anywhere; no dependency added; `preserveDrawingBuffer: true` is present or the snapshot is blank; the component renders nothing but the CSS floor in the four non-Eclipse palettes.
**Commit:** `git add src/components/visual && git commit -m "feat(visual): one WebGL2 field that settles at 4500ms, snapshots and loses its context"`

---

### T4.4 — `CodeGuide`, the lesson reading surface, and the verifier

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T4.0 (`--guide`, `--lesson-*`, `--text-lede`), T4.2 (`<Reveal>`)
**Codex-preferred:** no — this is the wave's one teaching change and it carries the evidence base.
**Spec:** §7, §9 (`/lesson/[cloId]`).

**Files**
- Create: `src/components/lesson/CodeGuide.tsx`, `src/components/lesson/CodeGuide.test.tsx`
- Edit: `src/components/lesson/WorkedBlock.tsx`, `src/components/lesson/SnippetBlock.tsx`, `src/components/lesson/LessonView.tsx`, `src/components/lesson/lesson.test.tsx`, `src/app/(app)/lesson/[cloId]/page.tsx`, `scripts/verify-lesson.mjs`, `scripts/verify-lesson.test.mjs`, `seed/lessons/lesson.schema.json`

**Interfaces produced**
```ts
export type GuideSpan = { line: number | [number, number]; token?: string }
export function CodeGuide(props: CodeGuideProps): JSX.Element   // exact shape in spec §7.2
```

- [ ] **Step 1: extract `CodeGuide.tsx`** with the props in spec §7.2. `active: null` renders **no band element** — that is the seam a later fading or trace feature uses.
- [ ] **Step 2: tint plus rail.** Two absolutely-positioned `transform`-only children: a `bg-guide/12` box and a 2 px `--guide` rail at `left: 8px`. **Drop `ring-1 ring-inset` and `rounded-md`** — `WorkedBlock.tsx:56-61` scales both by `scaleY(n)`, so a three-line step renders 3 px edges and a smeared radius.
- [ ] **Step 3: the transition is CSS, exactly `transform 200ms var(--ease-move)`.** Not GSAP, not Flip: a transition retargets mid-flight when a learner clicks fast, a tween restarts from zero. Under `reduced`, `transition: none` **and nothing else** — the band still arrives at the new lines.
- [ ] **Step 4: the token underline.** When a step's `say` holds exactly one backticked span resolving uniquely inside its line range, draw a 2 px underline at `left: calc(16px + Nch)`, `width: calc(Mch)`, animated with `translateX` and `scaleX`. Any other case falls back to line level and never throws.
- [ ] **Step 5: `passive` spans.** `SnippetBlock` passes `LessonSnippet.highlight` as `passive`, rendered as a static tint at 60% of the active alpha on block enter. Authored in seed since v2, rendered by nothing until now.
- [ ] **Step 6: accessibility.** `aria-current="step"` on the active callout; a visually-hidden `"Step 2 of 4, lines 3 to 5."` prefix on every callout; the band stays `aria-hidden`. Advance stays the existing native `<button>` (click and Enter already; Space comes free). **No timer, no `setInterval`, no `setTimeout` in any advance path — ever.**
- [ ] **Step 7: the reading surface.** `LessonView.tsx:218,221` becomes outer `max-w-5xl`, prose `max-w-[68ch]`, rail `12rem`, so the inner cap actually binds. Prose moves to `--text-lede` / 1.6 in `--lesson-foreground`, never `--muted-foreground`. Block reveals keep their 8 px rise and 300 ms enter, once, through `<Reveal mode="lines">` on hook and recap only. No shader, no looping motion.
- [ ] **Step 8: the verifier** (`scripts/verify-lesson.mjs`) gains the four checks in spec §7.5 as hard failures, plus the optional `readingOrder: 'semantic'` marker in `lesson.schema.json` so the two SQL blocks that teach clause evaluation order stay legal.
- [ ] **Step 9: tests** per spec §10 family G, including a fixture whose step points at line 99 of an 11-line block (exit 1) and an assertion that no band element exists inside a `spot-the-bug` check's pre-answer DOM.

**Acceptance**
```bash
npx vitest run src/components/lesson "src/app/(app)/lesson"
node scripts/verify-lesson.mjs
node seed/validate.mjs
npx vitest run
```
Manual: step a four-step worked block with the mouse, fast — the band retargets without restarting. Turn reduced motion on: the band still lands on the right lines, instantly.

**Existing tests it may change:** `src/components/lesson/lesson.test.tsx` (additions and the band-selector update), `src/app/(app)/lesson/[cloId]/page.test.tsx` (additions), `scripts/verify-lesson.test.mjs` (additions).
**Review (Opus):** no GSAP import in `CodeGuide.tsx`; the transition string is exact; the guide is absent from `predict-output`, `micro-code`, `fill-blank` and pre-answer `spot-the-bug`; no seed file is edited (the schema is, the content is not); the reduced-motion transform equals the motion-on transform.
**Commit:** `git add src/components/lesson "src/app/(app)/lesson" scripts/verify-lesson.mjs scripts/verify-lesson.test.mjs seed/lessons/lesson.schema.json && git commit -m "feat(lesson): tint-and-rail code guide, verified worked blocks, an 18px reading column"`

---

## Group B — five parallel screen sweeps

All five depend on **T4.0, T4.1, T4.2** and share one shape: replace raw type classes with the scale, replace hard-coded palette classes with tokens, apply the eight-step spacing rhythm and the three radii, put fills on cards and `--rule` on decorative edges, design the four states, and delete this task's entries from the T4.1 allowlist. **None of them changes a fetch, a route, a hook or a handler.** Each names the extra, screen-specific work below.

### T4.5 — Shell, dock, Buddy, shared UI, Account

**Model:** Sonnet or **Codex** (`Codex-preferred: yes`). **Review:** Opus.
**Depends on:** T4.0, T4.1, T4.2
**Spec:** §4, §2.7, §8, §9 (`/account`, Buddy).
**Owns:** `src/components/shell/**`, `src/components/wellness/**`, `src/components/buddy/**`, `src/components/ui/**`, `src/app/(app)/account/**`, `src/components/account/**`

- [ ] Header content height **56 px**; nav targets ≥ 24 × 24 CSS px with ≥ 8 px gaps; Buddy, sound toggle and theme switch at **44 px**. The rail's first label baseline aligns to the page H1 baseline within 2 px.
- [ ] `src/components/ui/**`: card and button variants take `--rule` for decorative edges and keep `--border` for interactive ones; elevation wired to `--elevation-xs|sm|md|lg` with `shadow-lg` in at most two files; radii reduced to `lg|xl|2xl|full`.
- [ ] The **five-palette picker** (spec §2.7): `role="radiogroup"`, 44 px tiles showing background, primary and accent, each naming itself in text, applied instantly, in both Account and the shell quick-switch.
- [ ] Account: one `--measure-form` column, headings at `--text-lede`, labels at `--text-micro` uppercase, help at `--text-small` muted, section rules in `--rule`. **All 11 hard-coded emerald classes in `account/page.tsx` become tokens** — the highest count in the app.
- [ ] Integrity, account-status and diagnostics panels are the **restricted-state reference**: zero motion in both modes, no sound, no personality.
- [ ] The dock lane indicator moves to `useFlipIndicator`.

**Tests it adds:** a component test per state (empty / loading / error / restricted) for Account; a keyboard traversal test of the five-swatch radiogroup; a bounding-box test for the 56 px header and the 44 px controls.
**Existing tests it may change:** `src/app/(app)/account/page.test.tsx`, `src/app/(app)/account/prefsMutation.test.tsx`, `src/components/wellness/*.test.tsx`, `src/components/buddy/Drawer.test.tsx` — **additions and selector updates only; no assertion deleted or weakened.**
**Commit:** `git add src/components/shell src/components/wellness src/components/buddy src/components/ui "src/app/(app)/account" src/components/account && git commit -m "feat(shell): 56px header, token sweep, five-palette picker, restricted-state reference"`

### T4.6 — Dashboard, Courses, Course home

**Model:** Sonnet or **Codex** (`Codex-preferred: yes`). **Review:** Opus.
**Depends on:** T4.0, T4.1, T4.2, T4.3 (`ShaderSurface` for the hero band)
**Spec:** §9 (`/dashboard`, `/courses`, `/course/[code]`).
**Owns:** `src/app/(app)/dashboard/**`, `src/app/(app)/courses/**`, `src/app/(app)/course/**`, `src/components/course/**`

- [ ] Dashboard: exactly **one** filled `raised` surface (the resume card) carrying the only filled button; stats at `--text-h1` tabular numerals over `--text-micro` uppercase labels on `--rule` dividers; the 14 px muted line under the heading lifts to `--text-body` in `--foreground`. **No shader.** 9 hard-coded emerald classes go.
- [ ] Courses: the two-column editorial index; `coming-soon` becomes a **designed** restricted-adjacent state, not a dimmed one; the dashed borders go; titles stagger at 40 ms with a masked-line reveal.
- [ ] Course home: `<ShaderSurface>` **inside the hero box only**; CLO column capped at `--measure-prose` (from ~110 characters); the path map keeps its v2 §10.4 DOM-list-first contract **verbatim** and gains one 2 px `--rule` connector, node state in shape and fill as well as colour, and 24 × 24 CSS px hit areas.

**Tests it adds:** a filled-button count of 1 on each of the three routes; a Playwright measure assertion on the CLO column; a test that the path map's accessible names and `aria-describedby` prerequisite wiring are unchanged.
**Existing tests it may change:** `src/app/(app)/dashboard/page.test.tsx`, `src/app/(app)/courses/page.test.tsx`, `src/app/(app)/course/[code]/page.test.tsx`, `src/components/course/course.test.tsx` — additions and selector updates only.
**Commit:** `git add "src/app/(app)/dashboard" "src/app/(app)/courses" "src/app/(app)/course" src/components/course && git commit -m "feat(screens): one primary per screen, real card fills, a hero band and a readable CLO column"`

### T4.7 — Exercise and the editor theme

**Model:** Sonnet or **Codex** (`Codex-preferred: yes`). **Review:** Opus.
**Depends on:** T4.0, T4.1, T4.2
**Spec:** §2.6, §3.3, §9 (`/exercise/[id]`).
**Owns:** `src/app/(app)/exercise/**`, `src/components/exercise/**`

- [ ] The grid at `exercise/[id]/page.tsx:88` becomes `xl:grid-cols-[22rem_minmax(0,1.6fr)_20rem]` with all three panels flush to one top edge. Brief ≥ 320 px (~62 characters, from ~28); **editor column ≥ 480 px at 1280 px** — assert the floor, because narrowing the editor on the screen the editor owns is the one way this change goes wrong.
- [ ] The nine `--code-*` tokens ship as **one** `HighlightStyle.define()` mapping `@lezer/highlight` tags (spec §2.6). One style, five palettes, no per-theme JavaScript. `font-feature-settings: 'liga' 0, 'calt' 0` on `.cm-scroller`.
- [ ] **No `<ViewTransition>`, no shader, no reveal, no ambient motion.** Juice fires only at the transition. Verdicts pair glyph and word and colour. The submit button's hard-coded emerald becomes `--primary`.
- [ ] Results rows on `--rule`; brief prose in Geist Sans at `--text-body` in every palette, including Folio.

**Tests it adds:** a Playwright assertion that zero animations run during composition and during an `/exercise/[id]` navigation; a `HighlightStyle` tag-map unit test; a verdict test asserting a text node **and** a glyph node on both pass and fail.
**Existing tests it may change:** `src/app/(app)/exercise/[id]/page.test.tsx`, `src/components/exercise/*.test.tsx` — additions and label updates only; every lockdown and grading assertion survives byte for byte.
**Commit:** `git add "src/app/(app)/exercise" src/components/exercise && git commit -m "feat(exercise): a readable brief, one code highlight style across five palettes, silence during composition"`

### T4.8 — De-rot, Playground and the reward surfaces

**Model:** Sonnet. **Review:** Opus.
**Depends on:** T4.0, T4.1, T4.2, T4.3
**Spec:** §9 (`/derot`, the run screens), and **v2 R7.4 — this is where the celebration budget is spent.**
**Owns:** `src/app/(app)/derot/**`, `src/components/derot/**`, `src/components/rewards/**`, `src/components/play/**`

- [ ] The hub goes from **six filled Starts to one filled and five ghost** (`derot/page.tsx:183`); icon chips out, one 20 px glyph aligned to the title cap-height; "Not attempted yet" to `--text-micro`. `<ShaderSurface>` at low amplitude, Eclipse only. The lane switch moves to `useFlipIndicator`.
- [ ] **Nothing here is quietened.** The countdown ring, combo pop, score count-up, personal-best stamp, run-summary sound and the full 600–900 ms budget all stay: R7.4 licenses them and the wave's judges both flagged under-spending here as the one way this pass fails. Zero *ambient* motion during a timed run, which is a different rule.
- [ ] Playground stays DOM and CSS: `Breathe` keeps its transform-only pacer and gains a static `radial-gradient` aura on the existing `scaleFor` transform for 0 KB; `follow-the-dot` gains nothing ambient at all — a moving field behind a moving target degrades the task and the score.
- [ ] Score and best in `--text-h1` tabular numerals; all odometers stay on the `XpCounter` proxy pattern; the level-up headline is the **second and last** licensed character reveal.

**Tests it adds:** a filled-button count of 1 on `/derot`; a test that `Breathe.tsx` and `FollowTheDot.tsx` contain no `getContext`; an assertion that the celebration path still fires all its cues with motion on and collapses to a cross-fade under reduce.
**Existing tests it may change:** `src/app/(app)/derot/**/*.test.tsx`, `src/components/derot/*.test.tsx`, `src/components/rewards/rewards.test.tsx` — additions and selector updates; **every scoring assertion survives.**
**Commit:** `git add "src/app/(app)/derot" src/components/derot src/components/rewards src/components/play && git commit -m "feat(derot): one primary action, a low shader, and the celebration budget spent where R7.4 puts it"`

### T4.9 — Reports, Login, Onboarding, landing

**Model:** Sonnet or **Codex** (`Codex-preferred: yes`). **Review:** Opus.
**Depends on:** T4.0, T4.1, T4.2, T4.3
**Spec:** §8, §9 (`/reports`, `/login`, `/onboarding`, `/`).
**Owns:** `src/app/(app)/reports/**`, `src/components/report/**`, `src/app/(auth)/**`, `src/app/(app)/onboarding/**`, `src/app/page.tsx`

- [ ] Login: one `--measure-form` column, one `--text-hero` wordmark on a masked-line reveal, one filled button, flat unanimated error text, `<ShaderSurface>` behind a ≥ 0.92 scrim in Eclipse and the CSS floor everywhere else. 5 hard-coded classes go.
- [ ] Onboarding: the **first** of the two licensed character reveals, on the hook line only. The existing 120 ms option fill and 200 ms card exchange are kept exactly as they are — this is already the best-choreographed screen in the app. Progress becomes a hairline `--rule` track that fills. Options are 44 px targets.
- [ ] Reports: tabs on a `--rule` baseline, cards on fill, `--text-h1` tabular numerals, no series distinguished by colour alone. **The empty state at `reports/page.tsx:164-167` — a dashed box with a hard-coded `text-emerald-200` link — is replaced by the designed empty state in spec §8.** The report preview reads as a printed page in every palette.
- [ ] The four states designed on all four routes.

**Tests it adds:** the four-state component tests for `/reports`, `/login` and `/onboarding`; a test that the onboarding character reveal is absent under reduced motion and that `textContent` is unchanged.
**Existing tests it may change:** `src/app/(app)/reports/page.test.tsx`, `src/app/(app)/reports/data.test.ts`, `src/app/(auth)/login/page.test.tsx`, `src/app/(app)/onboarding/page.test.tsx` — additions and selector updates; the PDF assertions survive unchanged.
**Commit:** `git add "src/app/(app)/reports" src/components/report "src/app/(auth)" "src/app/(app)/onboarding" src/app/page.tsx && git commit -m "feat(screens): a staged login, a designed empty state, a report that reads as printed"`

---

## Group C — the serial tail

### T4.10 — The bundle budget script and the e2e battery

**Model:** Sonnet. **Review:** Opus.
**Depends on:** every task above (it measures a finished tree)
**Codex-preferred:** no.
**Spec:** §10 families C, D, E, F, I.

**Files**
- Create: `scripts/check-bundle-budget.mjs`, `e2e/motion.spec.ts`, `e2e/measure.spec.ts`, `e2e/shader.spec.ts`, `e2e/palette.spec.ts`

- [ ] **Step 1: `check-bundle-budget.mjs`** — it does not exist today despite `perf:bundle` pointing at it (correction W1). It asserts: `/dashboard` ≤ 380 KB and `/derot` ≤ 420 KB of first-load JS; `.next/static/media/*.woff2` ≤ 320 KB total; tracked `public/` still **1,374,356 bytes** with no `.woff2`; `three`, `ogl` and `@paper-design/shaders-react` absent; `howler`, `canvas-confetti` and the shader chunk out of the initial chunk. The per-route budgets are **generated from a measurement** on the finished tree and no route's budget may exceed its v1 number.
- [ ] **Step 2: `e2e/motion.spec.ts`** — with motion on, every `effect.getTiming().duration ≤ 900`; under `emulateMedia({ reducedMotion: 'reduce' })` **and** under `:root[data-motion='reduced']`, zero running animations 50 ms after a navigation; lockdown, integrity and account-status show zero animations in both modes; zero animations during an `/exercise/[id]` navigation.
- [ ] **Step 3: `e2e/measure.spec.ts`** at 1280 × 800 — 55–80 characters in the four named prose columns (scoped selectors, never a blanket page assertion); brief ≥ 320 px and editor ≥ 480 px; three panels flush within 2 px; header 56 px; targets 24 and 44 px; the rail baseline within 2 px of the H1 baseline.
- [ ] **Step 4: `e2e/shader.spec.ts`** — `[data-shader-surface]` absent on `/dashboard`, `/lesson/*`, `/exercise/*` and every lockdown surface; `requestAnimationFrame` call count flat from t = 6 s to t = 12 s; `gl.isContextLost()` true at t = 6 s with the surface still visibly non-uniform; no canvas and no shader chunk under `reduce`.
- [ ] **Step 5: `e2e/palette.spec.ts`** — each of the five applied in turn: `data-theme` on `<html>`, no half-themed component (a screenshot diff with `animations: 'disabled'`), focus ring ≥ 3:1 in all five, the choice surviving a reload.

**Acceptance**
```bash
npm run perf:bundle
npx playwright test
npx vitest run
```

**Existing tests it may change:** `e2e/*.spec.ts` — updates for new selectors and copy; **no assertion dropped.**
**Review (Opus):** every budget number came from a measurement, not from this document; the measure assertions are scoped to named selectors and will not flake on a long CLO string; the reduced-motion spec exercises both channels.
**Commit:** `git add scripts/check-bundle-budget.mjs e2e/motion.spec.ts e2e/measure.spec.ts e2e/shader.spec.ts e2e/palette.spec.ts && git commit -m "test(wave4): bundle budget from a measurement, plus the motion, measure, shader and palette batteries"`

### T4.11 — Wave review, build log, ledger

**Model:** — . **Review:** **Opus**, whole-wave.
**Depends on:** T4.10
**Owns:** `docs/build-log.md`, `openspec/changes/brogram-launch/tasks.md`

- [ ] Whole-wave Opus review against the spec's §10 families and this plan's §2. A Critical sends a fix round to the owning task's agent; a clean review is recorded with the word "clean".
- [ ] One dated `docs/build-log.md` line per ruling W4.0 through W4.24, each naming the commit that landed it.
- [ ] The `## wave4` ledger section ticked, one row per task.
- [ ] The three open rulings in spec §12 written up for the owner: the "Previous step" control, Integral CF bought personally, and whether Eclipse becomes the seeded default after a week.

**Commit:** `git add docs/build-log.md openspec/changes/brogram-launch/tasks.md && git commit -m "docs(wave4): rulings, ledger and the three open questions for the owner"`

---

## 5. Existing-test change licence

**A task may change only the files on its own row.** Anything else is a review failure. "Additions only" means no existing assertion is deleted or weakened.

| Existing test file | Task allowed to change it | Licence |
|---|---|---|
| `src/lib/contracts.test.ts` | — | **Nobody.** The byte-for-byte guard; it must pass unedited after the `ThemeName` line lands in both copies. |
| `src/lib/theme/contrast.test.ts` | T4.0 | Extended to five blocks plus the new gates; every existing tier assertion survives |
| `src/lib/theme/dark-variant.test.ts` | T4.0 | One addition for `eclipse` |
| `src/lib/motion/timing.test.ts` | T4.2 | Additions for `DUR.guide` and the registered eases |
| `src/components/lesson/lesson.test.tsx`, `src/app/(app)/lesson/[cloId]/page.test.tsx` | T4.4 | Additions and the band-selector update |
| `scripts/verify-lesson.test.mjs` | T4.4 | Additions for the four new checks |
| `src/app/(app)/account/*.test.ts(x)`, `src/components/wellness/*.test.tsx`, `src/components/buddy/*.test.ts(x)`, `src/components/account/IntegrityPanel.test.tsx` | T4.5 | Additions and selector updates |
| `src/app/(app)/dashboard/page.test.tsx`, `src/app/(app)/courses/*.test.ts(x)`, `src/app/(app)/course/[code]/page.test.tsx`, `src/components/course/course.test.tsx` | T4.6 | Additions and selector updates |
| `src/app/(app)/exercise/[id]/page.test.tsx`, `src/components/exercise/*.test.tsx` | T4.7 | Additions and label updates; every lockdown and grading assertion survives byte for byte |
| `src/app/(app)/derot/**/*.test.ts(x)`, `src/components/derot/*.test.tsx`, `src/components/rewards/rewards.test.tsx` | T4.8 | Additions and selector updates; **every scoring assertion survives** |
| `src/app/(app)/reports/*.test.ts(x)`, `src/app/(auth)/login/page.test.tsx`, `src/app/(app)/onboarding/page.test.tsx` | T4.9 | Additions and selector updates; the PDF assertions survive unchanged |
| `e2e/*.spec.ts` | T4.10 | Selector and copy updates; no assertion dropped |
| **everything else** (161 test files) | — | **Nobody.** |

---

## 6. Asset and dependency licence table

Nothing in this wave is fetched at build, and nothing lands in tracked `public/`.

| Thing | Source | Licence | How it ships |
|---|---|---|---|
| Geist Sans, Geist Mono | `vercel/geist-font` | **SIL OFL 1.1** | `next/font/google`, already wired, unchanged |
| Archivo (Eclipse display) | Omnibus-Type via Google Fonts | **SIL OFL 1.1** | `next/font/google`, `axes: ['wdth']`, `preload: false` → `.next/static/media/` |
| Newsreader (Folio display and prose) | Production Type via Google Fonts | **SIL OFL 1.1** | `next/font/google`, `axes: ['opsz']`, `preload: false` → `.next/static/media/` |
| ~~Integral CF~~ | Connary Fagen | Retail; **page-view-tiered annual web subscription**, no redistribution | **Not shipped.** `--font-display` is the single gitignored override point if bought privately |
| Anything on Fontshare | ITF Free Font License | Forbids self-hosting and redistribution | **Ruled out**; a lint rule fails on any `fontshare` string under `src/` |
| GSAP + `@gsap/react` (SplitText, Flip, CustomEase) | Webflow | **Standard "No Charge"** — free for commercial use, **not OSI** | npm dependency, never vendored, named correctly in third-party notices |
| lucide-react | lucide | ISC | already installed |
| `canvas-confetti` | catdad | ISC | already installed, dynamic-imported |
| The WebGL field and its GLSL | **BroGram, first-party** | MIT with the repo | ~4 KB in a lazy chunk; no 3D library |
| The CSS shader floor | **BroGram, first-party** | MIT with the repo | two `radial-gradient`s, 0 KB |

---

## 7. Risks, and what is done about each

| Risk | Mitigation |
|---|---|
| Two agents edit one file | §4 is exclusive per task for the whole wave; a task that needs a file it does not own **stops and reports**. `git add` is always path-scoped. |
| The palettes ship on this document's numbers | T4.0 Step 9 turns every number in spec §2 into a **failing unit test** first — including the three gates (ΔL card, Lc gap, sRGB round-trip) that fail on the current file. |
| The type migration breaks a screen mid-wave | The scale is **additive** (W4.9): nothing Tailwind owns is redefined, so a screen that has not migrated yet still renders correctly. T4.1's allowlist tracks who has and who has not. |
| The exercise grid narrows the editor | T4.7 asserts an editor **floor** of 480 px at 1280, not just the brief's ceiling. |
| The de-hardcode sweep silently changes a semantic | Each replacement maps a role, not a hue: emerald-on-primary-action → `--primary`, emerald-on-verdict → `--success`, emerald-on-focus → `--ring`. Opus review checks the mapping per site, and the verdict tests assert glyph + word + colour. |
| A screenshot looks the same in two palettes | T4.10's `e2e/palette.spec.ts` diffs all five with `animations: 'disabled'`. |
| The shader hits the 16-context cap on route churn | One context ever via a module counter, plus a deliberate `loseContext()` at 4500 ms. Asserted in both Vitest and Playwright. |
| Reduced motion deletes the teaching | The guide band's reduced-motion transform is asserted **equal** to the motion-on transform in both a unit test and an e2e test. It is the one animation in the wave whose position survives `reduce`. |
| The wave under-spends the celebration budget | Both wave judges flagged exactly this. T4.8 owns it as a named requirement, and its review checks that no cue, odometer or confetti path was removed. |
| Codex stays down | Nothing depends on it. The capacity valve is the **default**: Claude builds, Codex reviews if it returns. |
| `perf:bundle` is asserted before it exists | Correction W1: no task before T4.10 may assert a bundle number, and the gate runs it only after T4.10 lands. |

---

## 8. The wave gate

The wave does not close until every line is exit 0, the whole-wave Opus review is clean, `docs/build-log.md` carries the W4 rulings, the ledger rows are ticked, and `main` is pushed.

```bash
npx tsc --noEmit
npx eslint src
npx vitest run                                     # every existing test green, and rising
npm run design:check                               # zero violations, zero allowlist entries left
node seed/validate.mjs
node scripts/verify-lesson.mjs
node scripts/build-static-curriculum.mjs --check
npm run build
npx playwright test
npm run perf:bundle                                # from T4.10 on
npm run perf:timings
```

Plus one manual pass the owner runs on a fresh profile against the deployed build, five times — **once per palette**:

1. Sign in. The login screen is staged, not decorated, and nothing moves after five seconds.
2. Open a lesson. The prose is 18 px, dark, and 68 characters wide. Step the worked example fast with the mouse: the band retargets and never restarts.
3. Turn on Reduce Motion. Repeat step 2. **The band still lands on the right lines.**
4. Open an exercise. Nothing moves while you type. Submit: everything fires.
5. Open `/derot`. There is exactly one filled button on the screen, and a run is still loud.
6. Open Account. Switch palette. Nothing flashes, nothing stays the old colour, and every swatch says its own name.

Ruling added 12:05 Doha, 2026-09-07 (controller, after T4.0's review): T4.0's fix round may edit src/components/ui/sonner.tsx, src/components/shell/ThemeQuickSwitch.test.tsx, src/app/(app)/account/page.test.tsx and src/lib/wellness/prefs.ts (THEME_NAMES) for the eclipse and Folio entries, additions and selector updates only, no assertion deleted; T4.5 keeps those files afterwards. Fonts: the 320 KB budget is met by self-hosting latin-subset static instances of Archivo and Newsreader through next/font/local (only the weights and widths the spec uses, subset with fonttools, OFL licence files beside them, total measured at or under 320 KB), not through next/font/google's variable downloads.

Ruling (13:48 Doha, 2026-09-07): standing constraint 6 (no font binary in git ls-files) is amended for Wave 4: the two OFL display faces ship as subset static woff2 instances under src/lib/fonts with their OFL.txt files tracked beside them, because next/font/google cannot meet the 320 KB budget and the licence permits redistribution; the budget test is the gate. src/lib/fonts/** is owned by T4.0 (and T4.5 after the wave).
