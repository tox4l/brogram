<!-- Wave 4 research lane, compiled 2026-09-07. Copied verbatim from the lane agent's report. -->

> **Lane:** motion. **Date:** 2026-09-07. **Status:** research input, not a decision.
> **Scope.** The motion vocabulary: GSAP under the React Compiler lint, SplitText reveals, `<ViewTransition>` route transitions, Flip indicators, and how each is tested.
> **Decisions taken from it** live in `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md`;
> where this file and that spec disagree, **the spec wins** and says why.
>
> **Primary sources**
> - gsap.com/standard-license and gsap.com/blog/3-13 — free for commercial use including every former Club plugin; proprietary, not OSI
> - gsap.com/docs/v3/Plugins/SplitText and /Flip — aria:"auto", mask:"lines", autoSplit, Flip scale:true
> - react.dev/reference/eslint-plugin-react-hooks — set-state-in-effect, refs, purity and immutability are all error under eslint-config-next@16.3.4
> - nextjs.org/docs/app/guides/view-transitions and react.dev/reference/react/ViewTransition — wrappers in page.tsx, named transitions need explicit share
> - playwright.dev/docs/api/class-page#page-emulate-media and MDN Document.getAnimations — the two reduced-motion probes
> - Local measurement: gsap 3.15.0 dist sizes; CustomEase.create parity with the CSS cubic-beziers

---
# Wave 4 — Motion language: GSAP + the Web Animations API

The motion vocabulary for the premium pass. No route or behaviour change. Everything sits on the timing law in `src/lib/motion/tokens.ts` and the resolved boolean in `src/lib/motion/useReducedMotion.ts`.

## 1. What is installed (fact)

- `gsap@3.15.0`, `@gsap/react@2.1.2`. The npm package ships **every** former Club plugin: `node_modules/gsap/` contains `SplitText.js`, `Flip.js`, `CustomEase.js`, `MorphSVGPlugin.js`, `DrawSVGPlugin.js`, `Observer.js`.
- Licence: `package.json` says *Standard "no charge" license*. It permits use "on any website, web application, or digital interface", states "All of GSAP including the plugins that were formerly 'members-only' like SplitText and MorphSVG can be used in commercial projects at no charge", requires no attribution, and prohibits only competing animation builders and reverse-engineering ([licence](https://gsap.com/standard-license/), [3.13](https://gsap.com/blog/3-13/)). **Not MIT** — a permissive dependency of an MIT app, which must be named correctly in third-party notices.
- Minified (`node_modules/gsap/dist/`): core 71.2 KB, SplitText 7.6 KB, CustomEase 7.0 KB, Flip 24.9 KB.
- **The React Compiler lint is already on.** `eslint-config-next@16.3.4` spreads `eslint-plugin-react-hooks@7.1.1` `configs.recommended.rules`, which evaluates (verified locally) to `set-state-in-effect: error`, `refs: error`, `purity: error`, `immutability: error` ([react.dev](https://react.dev/reference/eslint-plugin-react-hooks)). It binds every hook this wave.

## 2. Tokens — extend, do not replace

`DUR`/`EASE` already match spec 7.8. Three gaps:

1. **GSAP cannot read a CSS `cubic-bezier()` string.** `Celebration.tsx` and `XpCounter.tsx` use `power1/2.out` while CSS uses `cubic-bezier(0.22, 1, 0.36, 1)` — two curves for one named motion (`power2.out` at t=0.25 is 0.578; the enter curve, 0.765). Verified in this repo: `CustomEase.create('enter', '0.22, 1, 0.36, 1')` accepts the four CSS control points directly and returns values identical to the SVG-path form (0.765 / 0.961 / 0.997 at t = .25/.5/.75). Register all four `EASE` entries once; GSAP and CSS become one curve.
2. **No exit curve.** Spec 7.8 bans `ease-in`, so exits use `EASE.standard` at one `DUR` step down (`base→fast`, `slow→base`) — what `motionTokens.ts` already does by leaving `ease` unset.
3. **Nothing between `slow` (320) and `celebration` (700).** The code guide needs `DUR.guide = 260`, inside the 200–300 ms movement band.

Stagger stays 40 ms, capped at 300: `stagger: Math.min(0.04, 0.3 / n)`, never a bare 0.04 on a long list.

## 3. Text reveals

SplitText 3.13+ solves the two things hand-rolled splitting gets wrong ([docs](https://gsap.com/docs/v3/Plugins/SplitText/)):

- `aria: "auto"` (default) puts `aria-label` with the original text on the parent and `aria-hidden` on every generated span — the sentence is read, not the letters.
- `mask: "lines"` wraps each line in a `visibility: clip` element. Masked line reveal with no extra CSS: `yPercent: 110 → 0` per line, `DUR.slow`, `EASE.enter`, 40 ms stagger. This is the one reveal that reads as expensive.
- `autoSplit: true` with `onSplit(self) { return gsap.from(self.lines, …) }` re-splits on font load and resize; returning the tween synchronises timing across re-splits. Required, because the white palette introduces a serif face and a split measured before the webfont lands has the wrong lines.

Taste: character reveals on exactly two surfaces (onboarding hook line, level-up headline); word reveals for section headings; line reveals for lesson hook and recap. Everything else fades. Character reveals on body copy are the loudest "generated" tell.

**Odometers** keep `XpCounter`'s shape verbatim: proxy object in a ref, `snap: { v: 1 }`, `toLocaleString()` in `onUpdate`, `killTweensOf` before re-tweening, `sr-only aria-live="polite"` sibling carrying the settled value.

**Reduced-motion fallback: do not split at all.** `if (reducedMotion) return` before `SplitText.create` — a split DOM with no animation is pure risk (line boxes, selection, copy/paste) for zero gain. Text is at final opacity on first paint; odometers `set`.

## 4. Route transitions

Next 16 App Router + React `<ViewTransition>` needs no config; navigations are already Transitions, so it activates automatically (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`). Spec 7.8 already scopes it to dashboard, course, lesson, courses, de-rot, reports, and bans it on `/exercise/[id]`.

Four rules that are easy to get wrong:

- Wrappers go in each `page.tsx`, **never a layout** — layouts persist, so enter/exit never fire there.
- A named `<ViewTransition>` with `default="none"` needs an explicit `share=`; without it the pair silently stops morphing.
- `::view-transition { pointer-events: none }`, or clicks during the transition are swallowed.
- Header and dock get `viewTransitionName: 'site-header'` with `::view-transition-group(site-header){animation:none;z-index:100}` and `::view-transition-old(site-header){display:none}`. A moving header destroys the spatial anchor.

Direction: `<Link transitionTypes={['nav-forward']}>` going deeper (course → lesson → rep), `['nav-back']` on up-links; 60 px offset, exit 150 ms, enter 210 ms delayed 150 ms — asymmetric by construction, satisfying "exit faster than enter" ([Next](https://nextjs.org/docs/app/guides/view-transitions), [React](https://react.dev/reference/react/ViewTransition)).

React does **not** honour reduced motion here, and the in-app override is React state, not a media query. So the kill switch needs both selectors:

```css
@media (prefers-reduced-motion: reduce) { /* …same block… */ }
:root[data-motion='reduced'] ::view-transition-old(*),
:root[data-motion='reduced'] ::view-transition-new(*),
:root[data-motion='reduced'] ::view-transition-group(*) {
  animation-duration: 0s !important; animation-delay: 0s !important;
}
```

## 5. The teaching guide and micro-interactions

The highlight band moving through code between callout steps is a **FLIP**, not a tween of `top`/`height`. `Flip.getState(band)` → reposition → `Flip.from(state, { duration: 0.26, ease: 'move', scale: true, absolute: true })`. `scale: true` animates `scaleX/scaleY` instead of `width`/`height` — exactly the spec 7.8 ban ([Flip](https://gsap.com/docs/v3/Plugins/Flip/)). Same mechanism for the dock indicator and tab underline: one shared hook, not three.

Hover, press and focus stay **CSS transitions** (spec 7.8): they retarget mid-flight; keyframes restart from zero. Buttons `DUR.instant` on `scale(0.97)`; cards `DUR.fast` on `translateY(-2px)` plus a shadow token; both inside `@media (hover: hover) and (pointer: fine)`. Never `transition: all` — enumerate the properties. `will-change: transform` on three selectors only (guide band, dock indicator, drawer).

## 6. useGSAP under the Compiler lint

- Always `useGSAP(fn, { scope: containerRef, dependencies: [...] })`; never a bare `useEffect` + `gsap.to`.
- **No `setState` in the callback** — `set-state-in-effect` is `error` and `useGSAP` is a `useLayoutEffect`. Animation output reaches the DOM through a ref (`el.textContent`, `el.dataset.state`), as `XpCounter` does. If React must know a tween finished, use `useSyncExternalStore` over a small emitter, not `onComplete: () => setDone(true)`.
- `refs` is `error`: never read `ref.current` during render.
- Tweens created in event handlers must be wrapped in `contextSafe`, or they escape the context and never revert.
- `gsap.registerPlugin(useGSAP, CustomEase, SplitText, Flip)` once, in a client module imported by the shell. SSR never touches `gsap.*`.
- **Reduced motion is a parameter, never `gsap.matchMedia()`** (spec 7.8); `matchMedia()` only for real queries — viewport width, `hover: hover`.

Bundle: SplitText + CustomEase + Flip ride the shell chunk (~39 KB min), needed on first paint; `canvas-confetti`, `howler` and any WebGL stay behind `import()`.

## 7. Testing

**Vitest (jsdom)** — `src/components/rewards/rewards.test.tsx` is the template: `vi.mock('gsap', importOriginal)` keeping `context`/`add`/`revert` real so `useGSAP`'s lifecycle runs, spying only `to`/`set`/`fromTo`/`killTweensOf`. Assert decisions, not pixels: reduced motion took the `set` branch; ease is `'enter'`; duration equals `DUR.x / 1000`; `killTweensOf` ran first. jsdom has no layout, so Flip and SplitText are mocked and asserted on call shape only.

**Playwright** — `page.emulateMedia({ reducedMotion: 'reduce' })`, or `use: { reducedMotion: 'reduce' }` ([docs](https://playwright.dev/docs/api/class-page#page-emulate-media)); the in-app override is driven through the wellness prefs UI. Two probes carry the lane: (a) under reduce, `page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)` is 0 within 50 ms of a navigation ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations)); (b) with motion on it is non-zero and every `effect.getTiming().duration` is ≤ 900, the spec 7.8 cap. Screenshots use `animations: 'disabled'`. `e2e/` has no reduced-motion coverage today — this is net-new.

## Recommendations

1. Add `registerEases()` in `src/lib/motion/` calling `CustomEase.create(name, points)` for all four `EASE` entries, parsing the existing `cubic-bezier()` strings (`bezierTuple` already does the parse). *Test:* `gsap.parseEase('enter')(0.25) === 0.765 ± 0.001`.
2. Ban raw ease names in GSAP calls; every `ease:` is `'enter' | 'move' | 'drawer' | 'standard'`. *Test:* source scan asserting no `ease: 'power|back|elastic` outside `src/lib/motion/`.
3. Add `DUR.guide = 260`, used by the code-guide band, dock indicator, tab underline. *Test:* token snapshot; `Flip.from` receives `duration: 0.26`.
4. Ship one `useFlipIndicator(containerRef, activeKey, reducedMotion)` on `Flip.getState` + `Flip.from({ scale: true, absolute: true })`; reduced motion positions via `gsap.set` in one frame. *Test:* `Flip.from` not called when `reducedMotion` is true.
5. One `<Reveal mode="lines|words|chars|fade">` component over `SplitText.create({ type, mask: 'lines', aria: 'auto', autoSplit: true, onSplit })`, returning children unsplit under reduced motion; `chars` allowed on two surfaces only. *Test:* under reduce the DOM has no split nodes and `textContent` is unchanged.
6. All odometers reuse `XpCounter`'s proxy-ref pattern; no second counter component. *Test:* extend `rewards.test.tsx` to the new surfaces.
7. Route transitions: wrappers in `page.tsx` only, six named routes, `default="none"` plus explicit `share`/`enter`/`exit`, `nav-forward`/`nav-back` on every internal `<Link>`, and no `<ViewTransition>` on `/exercise/[id]`. *Test:* Playwright asserts zero animations during an `/exercise/[id]` navigation.
8. Add the two-selector reduced-motion kill switch, `::view-transition { pointer-events: none }`, and the `site-header` anchor rules to `src/app/globals.css`. *Test:* probes (a) and (b).
9. Anchor header and dock with `viewTransitionName: 'site-header'`; neither ever slides. *Test:* mid-transition screenshot shows the header at a fixed offset.
10. No `setState` in any `useGSAP` callback; no `ref.current` read in render. *Test:* `npx eslint src` clean with `set-state-in-effect` and `refs` at `error` (already true — keep it).
11. `will-change: transform` on at most three selectors; `transition: all` nowhere. *Test:* source scan.
12. Add `e2e/motion.spec.ts`: reduce ⇒ zero running animations after navigation; motion-on ⇒ all durations ≤ 900 ms; enforcement surfaces (lockdown, integrity, account status) ⇒ zero animations in both modes, per standing constraint 11.
13. Name the GSAP Standard "No Charge" licence in third-party notices, not MIT.
