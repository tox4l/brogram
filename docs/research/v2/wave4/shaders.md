<!-- Wave 4 research lane, compiled 2026-09-07. Copied verbatim from the lane agent's report. -->

> **Lane:** shaders. **Date:** 2026-09-07. **Status:** research input, not a decision.
> **Scope.** Whether WebGL earns its place, what it costs, where it may appear, and the contract that keeps it inside WCAG 2.2.2.
> **Decisions taken from it** live in `docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md`;
> where this file and that spec disagree, **the spec wins** and says why.
>
> **Primary sources**
> - w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html — the three conditions of SC 2.2.2 and the five-second threshold
> - developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices — render to a smaller back buffer and upscale; lose contexts eagerly
> - developer.mozilla.org — getContext attributes (powerPreference, failIfMajorPerformanceCaveat), requestAnimationFrame pausing in background tabs, prefers-reduced-motion
> - github.com/mrdoob/three.js/pull/32240 — three.js r182 is 356.24 KB min / 86.48 KB gzip; a minimal tree-shaken app is 488 KB
> - github.com/oframe/ogl (Unlicense, 29 KB) and github.com/paper-design/shaders (Apache-2.0) — the libraries considered and rejected
> - issues.chromium.org 40939743 and 40543269 — a renderer caps near 16 live WebGL contexts and kills the oldest
> - caniuse.com/webgl2 (96.44%), /css-masks, /css-backdrop-filter; web.dev/articles/animations-guide — blur is expensive to paint
> - Local measurement: tracked public/ is 1,374,356 bytes across 9 files

---
# Wave 4 — Shaders and WebGL, where they earn their place

Fact is cited; taste is labelled **[taste]**. Repo facts measured on `main`, 2026-09-07.

## 1. Library cost decides this before anything else

Tracked `public/` is **1,374,356 bytes** across 9 files (`git ls-files public` + `stat`) against the ≤ 3 MB cap (§5.6). A shader needs none of it — GLSL is a string in a JS chunk. The binding constraint is per-route JS: `/dashboard` ≤ 380 KB, `/derot` ≤ 420 KB.

Three.js WebGL is **356.24 KB min / 86.48 KB gzip**; a tree-shaken minimal app (renderer, camera, empty scene) measures **488.04 KB / 121.25 KB gzip** ([three.js PR #32240, r182](https://github.com/mrdoob/three.js/pull/32240)) — a whole route budget for a background. OGL is **Core 8 KB + Math 6 KB, 29 KB total**, zero deps, **Unlicense** ([oframe/ogl](https://github.com/oframe/ogl/blob/master/README.md)). `@paper-design/shaders-react` is **Apache-2.0**, zero-dep, no attribution required ([repo](https://github.com/paper-design/shaders)) — licensable inside an MIT project, but unnecessary.

**No 3D library ships.** An ambient field is one fullscreen triangle and one fragment shader: no scene graph, no camera, no loaders. Hand-rolled WebGL2 is *~3–4 KB minified plus ~1 KB of GLSL* (**estimate**). OGL is the reserve if FBO ping-pong ever appears; being public domain it can be vendored file-by-file.

## 2. Cost: fill rate, not main thread

Per-frame JS is three `uniform` calls and one `drawArrays` — sub-0.1 ms (**estimate**). The real cost is fragments × instructions. 1440×900 CSS at DPR 2 is 2880×1800 = **5.18 M fragments/frame, 311 M/s at 60 fps**. At 0.5× CSS pixels: 720×450 = **324 k/frame, 19.4 M/s — 16× less**. That is MDN's advice verbatim: *"rendering into a smaller back buffer, and upscaling the result… reducing canvas.width and height and keeping canvas.style.width and height at a constant size"* ([WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)). A dim low-frequency field has no edges, so half resolution is invisible **[taste]**.

Battery: `powerPreference: "low-power"` *"prioritizes power saving over rendering performance"*; `failIfMajorPerformanceCaveat` *"indicates if a context will be created if the system performance is low or if no hardware GPU is available"* ([MDN getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)) — the second keeps a mid-range laptop off a software rasteriser. Background tabs cost nothing: *"requestAnimationFrame() calls are paused in most browsers when running in background tabs"* ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)).

Contexts are a scarce global: Chrome caps a renderer near **16** and kills the oldest with `webglcontextlost` ([Chromium 40939743](https://issues.chromium.org/issues/40939743), [40543269](https://issues.chromium.org/issues/40543269)). This app client-routes dozens of times a session — **one context ever, or none**. WebGL2 is **96.44%** ([caniuse](https://caniuse.com/webgl2)); Safari < 15 has none, and that 3.6% is the *default* look, not a degraded one.

## 3. The rule that shapes the design

WCAG 2.2 SC 2.2.2 (**Level A**): *"For any moving, blinking or scrolling information that (1) starts automatically, (2) lasts more than five seconds, and (3) is presented in parallel with other content, there is a mechanism for the user to pause, stop, or hide it"* ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)). A perpetual aurora behind a login form is all three conditions. Two legal shapes exist: add a pause control, or **stop under five seconds**. **[taste]** The second is better product *and* better engineering — a 4.5 s settle-then-freeze reads as a title sequence, not a screensaver, and steady-state GPU cost falls to zero.

`prefers-reduced-motion: reduce` names *"scaling or panning large objects"* as vestibular triggers ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)). Under the resolved boolean from `src/lib/motion/useReducedMotion.ts` the context is **never created** — the `src/components/rewards/Confetti.tsx:36` pattern, checked before the dynamic import starts.

## 4. Where they go

| Surface | Verdict | Why |
|---|---|---|
| `/login`, cinematic palette | **Yes**, settle-and-freeze | One-purpose screen, no code, no reading load |
| `/course/[code]` hero band | **Yes**, confined to the hero box | Tiles and path map below stay on solid `--card` |
| `/derot` hub | **Yes**, same component | R7.4 already grants Playground decorative motion |
| `/dashboard` | **No** | Working surface with live counters; §2 rule 10 |
| `/lesson/[cloId]` | **No** | §10.5: *"No looping motion anywhere — this is a reading surface."* |
| `/exercise/[id]` | **No** | Competes with the editor for GPU and attention during composition |
| Celebrations | **No WebGL** | `canvas-confetti` (~6 KB gzip, ISC) is already dynamic-imported and honours `disableForReducedMotion`. Spend the 600–900 ms budget on GSAP transform/opacity and `--celebration` / `--glow` |
| Playground `breathe` | **No WebGL** | `Breathe.tsx` is transform-only (`scaleFor`) with a textual pacer under reduced motion. A static `radial-gradient` aura on that same transform gets ~90% of it for 0 KB |
| Playground `follow-the-dot` | **No, emphatically** | A visual-tracking task; a moving field behind a moving target degrades task and score |
| Lockdown, integrity, account status | **Never** | §2 rule 11 |

**Distraction:** **[taste]** only if it moves while code is on screen. The freeze rule plus this table mean no learner sees a live shader and an editor in one frame.

## 5. CSS is the floor, not the fallback

The always-painted layer under the canvas is CSS: two `radial-gradient`s plus a `conic-gradient` in `--background`/`--glow` token space, optionally shaped by `mask-image` (**97.03%**, `-webkit-` still wanted for older Safari — [caniuse](https://caniuse.com/css-masks)). `backdrop-filter` is **96.36%** ([caniuse](https://caniuse.com/css-backdrop-filter)) but is a blur, and *"anything that involves a blur… takes longer to paint than drawing a red box"* ([web.dev](https://web.dev/articles/animations-guide)) — fine on small static chrome, forbidden full-viewport. That guide also says *"restrict animations to `opacity` and `transform`"*, so the CSS layer is **static**. `OffscreenCanvas` in a worker (Baseline since March 2023, [MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)) is not worth a worker chunk to move <0.1 ms/frame.

## 6. `ShaderSurface` — code shape

```tsx
// src/components/visual/ShaderSurface.tsx — cheap, always safe wrapper.
'use client'
import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'

// ssr:false + null loader: GLSL and GL code ride this chunk alone and never appear
// in a route's page_client-reference-manifest.js (§5.7 gate 1).
const ShaderField = dynamic(() => import('./ShaderField'), { ssr: false, loading: () => null })

export function ShaderSurface({ preset = 'aurora', motionPref, className }: ShaderSurfaceProps) {
  const reduced = useReducedMotion(motionPref)          // resolved boolean, checked BEFORE import
  const { resolvedTheme } = useTheme()                  // unconditional: hooks before branching
  const live = !reduced && resolvedTheme === 'cinematic'
  return (
    <div aria-hidden="true" data-shader-surface={preset}
         className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div className="absolute inset-0 bg-[--shader-fallback]" />  {/* always painted */}
      {live ? <ShaderField preset={preset} /> : null}
    </div>
  )
}
```

```ts
// src/components/visual/ShaderField.tsx — the lazy chunk (load-bearing parts).
const SETTLE_MS = 4500     // WCAG 2.2.2: motion stops inside five seconds
const RENDER_SCALE = 0.5   // MDN: smaller back buffer, upscaled by CSS
const FPS_CAP = 30         // half the frames, half the fragments

const gl = canvas.getContext('webgl2', {
  alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
  preserveDrawingBuffer: true,        // the frozen last frame must survive rAF stopping
  powerPreference: 'low-power',
  failIfMajorPerformanceCaveat: true, // fail over to CSS rather than software-rasterise
})
if (!gl) return                        // -> CSS layer is the final look; no layout branch

// Tints read from CSS custom properties (--shader-tint-a/b/c) at init, never GLSL literals.
// Loop: rAF capped to FPS_CAP, gated on IntersectionObserver + visibilityState.
// At SETTLE_MS: stop, then ctx2d.drawImage(canvas,0,0) and
//   gl.getExtension('WEBGL_lose_context')?.loseContext()   // MDN: "Lose contexts eagerly"
// so pixels stay and the ~16-context cap can never be hit by route churn.
// Bail before creating anything if navigator.connection?.saveData is true.
```

Canvas starts `opacity: 0`, transitions to 1 over `--duration-slow` on first drawn frame — a failed context, a slow compile and a reduced-motion learner all yield the same result with no flash and no CLS.

## 7. Contrast

`src/lib/theme/contrast.test.ts` verifies token *pairs*; R8.3 requires APCA `Lc ≥ 75` for body text. Live pixels behind text invalidate every tested pair. **No text, icon or control ever sits over live shader pixels** — the shader stays behind `--card` or a `--background` scrim at ≥ 0.92 alpha, or in regions with no text.

Adjacent, not this lane's to fix: Integral CF is a retail face (Connary Fagen, sold via [Fontfabric](https://www.fontfabric.com/help/licensing/) / [MyFonts](https://www.myfonts.com/collections/integral-cf-font-connary-fagen) under a per-use EULA), so its webfonts cannot enter an MIT repo or tracked `public/`. A shader is not a substitute for a display face **[taste]**.

## Recommendations

1. **No 3D library ships** — no `three`, `ogl`, `@paper-design/shaders-react`. *Test:* dependency diff empty.
2. **One `ShaderSurface` mounted app-wide**, enforced by a module counter returning null on a second mount. *Test:* mount two, assert one `<canvas>`.
3. **Shaders only on `/login`, the `/course/[code]` hero band, and `/derot`.** *Test:* `[data-shader-surface]` absent on `/dashboard`, `/lesson/*`, `/exercise/*` and every lockdown surface.
4. **Motion stops at 4500 ms**, restarting only on route or palette change. *Test:* spy `requestAnimationFrame`; call count flat from t=6 s to t=12 s.
5. **After freeze, snapshot to 2D then `loseContext()`.** *Test:* `gl.isContextLost()` true at t=6 s, surface still visibly non-uniform.
6. **Context attributes exactly as §6.** *Test:* assert the object against a fake `getContext`.
7. **Render at 0.5× CSS pixels, 30 fps cap, `devicePixelRatio` ignored.** *Test:* `canvas.width === Math.round(cssWidth * 0.5)` after a `ResizeObserver` tick.
8. **Reduced motion checked before the dynamic import**, via `useReducedMotion(prefs.motion)`. *Test:* with `reduce` emulated, no canvas and no shader chunk in the network log.
9. **CSS layer always painted, always static** — no animated `background-position`, no full-viewport `backdrop-filter`. *Test:* screenshot with WebGL disabled shows a finished background.
10. **No live shader pixel behind text.** *Test:* `contrast.test.ts` asserts the cinematic scrim alpha ≥ 0.92.
11. **Shader colour comes only from CSS custom properties read at init.** *Test:* grep the GLSL for `vec3(` colour literals; zero hits.
12. **`perf:bundle` asserts the shader chunk is in no route manifest** and tracked `public/` stays 1,374,356 bytes. *Test:* one added assertion in `scripts/check-bundle-budget.mjs`.
13. **Celebrations keep `canvas-confetti`** — no WebGL particles, no second context. *Test:* `Confetti.tsx` unchanged beyond token colours.
14. **Playground stays DOM/CSS.** *Test:* `play-games.test.tsx` passes unchanged; no `getContext` in `Breathe.tsx` or `FollowTheDot.tsx`.
