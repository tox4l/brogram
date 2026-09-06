# Sound and motion research for BroGram

Research date: 2026-09-06. Scope: how to add sound effects and rewarding motion to a web app well, and a concrete sound-and-motion system design for BroGram. This document does not re-litigate the onboarding-walkthrough, optimistic-UI/caching, or wellness-rail-position complaints from the 2026-09-06 product owner verdict except where they intersect directly with sound/motion (skeletons, the paste-block toast, the PrintScreen overlay) — those are separate research threads.

## 0. Grounding: what is already in the repo

Checked directly before researching, so the design below builds on what exists instead of relitigating it:

- **Already installed:** `gsap@^3.15.0`, `@gsap/react@^2.1.2`, `motion@^13.2.0` (the renamed Framer Motion), `sonner@^2.0.8` (toasts), `next-themes@^0.4.6`, `lucide-react`, `tw-animate-css`, `zustand@^5.0.15`, Tailwind 4, Next.js `16.3.4`. No animation library needs to be added.
- **Not installed, needed for this design:** `howler` (audio playback/sprites) and `canvas-confetti` (celebration bursts). Both are small, both are the right choice (justified below).
- **No sound system exists at all.** No `Howler`/`AudioContext` reference anywhere in `src/`, no `public/sounds/`. `public/` currently holds only `sql-wasm.wasm`.
- **No `prefers-reduced-motion` handling exists anywhere in `src/`.** This is a real gap, not a nice-to-have — see §7.
- **The paste-block toast** the product owner flagged as personality-free lives at `src/hooks/useLockdown.ts:87`: `setPasteMessage("Type it. That's the whole point.")`. It is a plain `sonner`-style string with a 3.5s timeout (`useLockdown.ts:88-89`) and no sound, no motion beyond whatever `sonner` does by default.
- **The PrintScreen "theatre" overlay** the product owner flagged is the `printscreen` boolean set at `useLockdown.ts:131-141`: a `keyup` listener that flips state for a flat 2-second window and best-effort clears the clipboard. The overlay itself is rendered by the consumer (exercise page), driven by this boolean — currently no motion or sound is attached to the transition in or out.
- **The wellness rail** (`src/components/wellness/Rail.tsx`, mounted via `src/components/shell/WellnessSlot.tsx`) has no position/collapse state at all today — `WellnessSlot` only toggles a `compact` boolean by route. That is a layout-architecture fix, not a sound/motion one, and is out of scope here.
- **The hard architecture rule that constrains everything below:** per `docs/superpowers/specs/2026-09-05-brogram-design.md` and the project's agent-cost rule, an agent call fires only on seven named triggers, and "a call on a keystroke, timer, or page load is a bug." Sound and motion must stay purely presentational client-side code — nothing in this design may become a new trigger source. The same spec already states the intended motion philosophy: "Dark-first, one accent, generous spacing, motion that explains state changes and nothing else. No decorative animation on the exercise screen; the editor is the hero there." The design below extends that rule rather than overriding it — it adds sound/motion at *state-change* moments (submit result, streak, level-up, hints, lockdown events) and deliberately keeps the editor and idle states quiet.

## 1. Audio engine: Web Audio API vs `<audio>`/HTMLAudioElement vs Howler.js

### 1.1 Web Audio API vs HTMLAudioElement

The two are not competitors so much as different tools. `<audio>`/`HTMLAudioElement` is simple and fine for background music or a single long-running track, but many browsers give it "poor implementations... which result in audio glitches and high latency," and it gives little control over precisely when and how a clip plays. The Web Audio API instead gives "a low-latency precise-timing model," lets you schedule and overlap clips exactly, and is the standard recommendation for anything game-like: "for games, use the incredibly powerful Web Audio API, as it loads sounds reliably, lets you play multiple sounds at the same time, and gives you precise playback control." For BroGram's UI blips (button clicks, pass/fail chimes, streak ignition, XP ticks), several of these can legitimately overlap in a fast exercise-attempt loop, so Web Audio's overlap and timing precision matters more than `<audio>`'s simplicity. (Sources: [Josh On Design — Audio Element vs WebAudio](https://joshondesign.com/p/books/canvasdeepdive/chapter12.html), [web.dev — Developing game audio with the Web Audio API](https://web.dev/articles/webaudio-games), [MDN — Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API).)

### 1.2 Howler.js

Rather than hand-rolling `AudioContext` management, BroGram should use **Howler.js**, which wraps Web Audio API with an HTML5-Audio fallback and handles the cross-browser edge cases directly relevant here.

- **Current version: 2.2.4** on npm (`howler`), 318,465 bytes unpacked across 9 files — confirmed directly against the npm registry. ([npm registry](https://www.npmjs.com/package/howler), [GitHub](https://github.com/goldfire/howler.js/))
- **Fallback strategy:** Howler "defaults to Web Audio API and falls back to HTML5 Audio," so it degrades gracefully on constrained browsers without code changes.
- **Sprite support:** first-class. A sprite is defined as `sprite: { key: [offsetMs, durationMs, loop?] }` against one combined file, and playback is `sound.play('key')`. This is exactly the shape BroGram's UI-sound sprite needs (§2).
- **Autoplay unlock:** Howler "attempts to silently unlock audio playback by playing an empty buffer on the first `touchend` event" automatically — this is `Howler.autoUnlock` (default `true`). It also emits an `unlock` event you can listen for, and a `play`/`load`/`loaderror` event set generally, so a "sound didn't fire because the page hasn't been touched yet" state is observable and can be queued rather than silently dropped or thrown.
- **Format guidance (from the project's own README):** "your best bet is to default to `webm` and fallback to `mp3`" — webm/opus gives strong compression with now-broad coverage, mp3 covers everything else. (See §2.3 for the one caveat: Safari's `webm`/`ogg` support is newer than people assume.)

(Sources: [GitHub — goldfire/howler.js README](https://github.com/goldfire/howler.js/), [npm — howler](https://www.npmjs.com/package/howler), [howler.js sprite example](https://github.com/goldfire/howler.js/tree/master/examples/sprite).)

### 1.3 Recommendation

Add `howler` (2.2.4) as the single audio dependency. Do not hand-roll `AudioContext` unlock logic — Howler's `autoUnlock` already does the standard "silent buffer on first gesture" trick, and reimplementing it is a common source of bugs (double-unlock races, Safari-specific quirks). Load it only on the client (`'use client'`, and keep the whole sound module out of any server-rendered path) since it touches `window`/`Audio` at import time.

## 2. Sound sprites: generation, formats, sizes, and the autoplay-unlock problem

### 2.1 Why a sprite, not N files

Combining all short UI sounds into one sprite sheet avoids per-sound HTTP/decode overhead and lets Howler manage a single `Howl` instance with a single decoded buffer, playing named offsets from it (`sound.play('attempt-pass')`) instead of juggling a dozen `Howl` instances. This is standard practice for UI/game audio, mirroring the CSS-sprite idea: combine many small assets into one file plus an offset map ([web.dev — audio sprites via `AudioBufferSourceNode.start(when, offset, duration)`](https://web.dev/articles/webaudio-games)).

### 2.2 Generating one

Use **[`audiosprite`](https://github.com/tonistiigi/audiosprite)** (npm, ffmpeg-backed) as a one-time build script, not a runtime dependency: it takes N short source clips and emits a combined `mp3`/`ogg`/`webm`/`m4a` set plus a Howler-compatible JSON offset map, automatically padding a silent gap between clips (aligned to whole seconds, minimum 1s apart) so playback never bleeds into the neighboring clip. Browser-based alternatives exist (e.g. a Howler-targeted online sprite generator) for one-off manual builds, but a checked-in Node script under `scripts/build-sound-sprite.mjs` that runs `audiosprite` against `assets/sounds-src/*.wav` is more reproducible and keeps the pipeline auditable, which matters here because every source clip also carries a license that needs to be tracked (§3). (Sources: [audiosprite on GitHub](https://github.com/tonistiigi/audiosprite), [audiosprite on npm](https://www.npmjs.com/package/audiosprite).)

### 2.3 Sizes and formats

- Keep every source one-shot **well under one second**, mono, 44.1kHz — UI blips do not need stereo or music-grade sample rates. At that length, per-clip footprint is a few KB; the whole sprite of ~15-20 BroGram UI sounds should land in the tens of KB per format, not hundreds.
- Emit **mp3 + webm** (Howler's own recommendation), or add `ogg` if the sprite pipeline produces it for free — mp3 as the universal fallback, webm/opus as the primary for its better compression-to-quality ratio.
- **Caveat worth being precise about:** Safari did not support Ogg Vorbis or a WebM container with Opus/Vorbis audio until **Safari 18.4** (macOS Sequoia 15.4 / iOS 18.4 / iPadOS 18.4, shipped March 2025). Before that, Safari needed mp3 or AAC. Since BroGram has no minimum-Safari-version constraint documented, ship both formats and let Howler's format-detection fall back automatically — the mp3 fallback is what protects pre-18.4 Safari, not a nice-to-have.
- For anything longer than a one-shot (there should not be much — see the "no decorative/looping motion on the exercise screen" rule in §0), general web-audio guidance is Opus at 128–192kbps stereo for music-length material and 64–96kbps mono for speech-length material; that scale simply should not come up for BroGram's UI-sound layer.

(Sources: [GitHub — howler.js README](https://github.com/goldfire/howler.js/), [web.dev — game audio](https://web.dev/articles/webaudio-games), [MDN/community — Ogg Vorbis Safari support](https://www.testmuai.com/web-technologies/ogg-vorbis-safari/), [github.com/mdn/content#35773 discussion of Safari WebM/Vorbis](https://github.com/mdn/content/issues/35773).)

### 2.4 Autoplay policy across browsers, and the unlock gesture

The rule that matters in practice: **assume nothing plays — video, `<audio>`, or Web Audio — until the user has interacted with the page.**

- **Chrome:** muted autoplay is always allowed; unmuted autoplay requires either a prior user interaction with the origin, a sufficiently high **Media Engagement Index** (a per-origin score Chrome computes from past playback, desktop only), or the site being installed as a PWA/home-screen app. For the Web Audio API specifically, Chrome has enforced this since Chrome 71: an `AudioContext` created before a gesture starts in the `suspended` state, and the standard fix is `context.resume()` inside a click/keydown handler.
- **Safari:** the strictest of the three — iOS Safari blocks all autoplay with sound outright (muted video autoplay is fine, sound is not), evaluating a mix of gesture history and per-domain interaction rather than Chrome's MEI model.
- **Firefox:** similar gesture-gated model; the practical fix is identical across all three — create or resume the `AudioContext` inside a genuine user-gesture event handler.

The universal workaround, and exactly what Howler's `autoUnlock` automates, is: **on the very first `touchend`/`click`/`keydown` anywhere on the page, play a silent buffer (or call `context.resume()`) to flip the AudioContext from `suspended` to `running`, once, for the session.** BroGram already has a natural first gesture for every route that matters (clicking into an exercise, clicking a dashboard card, answering the first onboarding question), so no dedicated "tap to enable sound" splash screen is needed — just make sure the sound manager's `init()` is wired to fire on whatever the app's first interactive element is, and treat any `play()` call before unlock as a no-op-and-queue rather than a thrown error (§8.3).

(Sources: [Chrome for Developers — Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay), [Chromium — Autoplay Policy Design Rationale](https://www.chromium.org/audio-video/autoplay/autoplay-policy-design-rationale/), [Bitmovin — Safari 14/Chrome 64 autoplay policies](https://bitmovin.com/blog/autoplay-policies-safari-14-chrome-64/), [GitHub — howler.js README](https://github.com/goldfire/howler.js/).)

## 3. Where to get sounds: a licensing survey for an MIT project

BroGram is MIT-licensed and public on GitHub. That is a stricter bar than "free to use in a finished video" — it means **the raw audio file itself sits in a public repository that anyone can clone, fork, and extract standalone.** Several popular "free sound effect" sites explicitly prohibit exactly that, so this section is deliberately more careful than a typical "here are some free SFX sites" list.

### 3.1 Kenney — recommended, primary source

[Kenney.nl](https://kenney.nl/) publishes game-asset packs (audio included) under **CC0** — full public domain dedication, no attribution required, no redistribution restriction of any kind. This is the cleanest possible fit for an MIT repo: CC0 assets can be committed to the public tree with zero legal ambiguity, same as the code around them.

Relevant packs (counts as listed on kenney.nl at time of writing):

| Pack | Count | Fit for BroGram |
|---|---|---|
| [UI Audio](https://kenney.nl/assets/ui-audio) | 50 sounds | clicks, switches, generic confirm/cancel |
| [Interface Sounds](https://kenney.nl/assets/interface-sounds) | 100 sounds | broader hover/select/confirm/error variety |
| [Impact Sounds](https://kenney.nl/assets/impact-sounds) | 130 sounds | a punchier "pass" thump, a soft "fail" thud |
| [Digital Audio](https://kenney.nl/assets/digital-audio) | 60 sounds | retro blips/registers — fits a coding-tool "bro" tone |

Credit to Kenney is optional under CC0 but appreciated; a one-line mention in `public/sounds/CREDITS.md` (§3.5) costs nothing and is good practice. (Sources: [kenney.nl/assets/ui-audio](https://kenney.nl/assets/ui-audio), [kenney.nl/assets/interface-sounds](https://kenney.nl/assets/interface-sounds), [kenney.nl/assets/impact-sounds](https://kenney.nl/assets/impact-sounds), [kenney.nl/assets/digital-audio](https://kenney.nl/assets/digital-audio), [CC0 confirmation via Calinou/kenney-ui-audio LICENSE.txt](https://github.com/Calinou/kenney-ui-audio/blob/master/LICENSE.txt).)

### 3.2 Freesound.org — recommended, secondary source

[Freesound](https://freesound.org/) is a large (700,000+ sound) community library where every upload carries an explicit Creative Commons license, and the search/API can be filtered to **CC0 only** (`license:"Creative Commons 0"` in APIv2, or the CC0 tag/filter in the web UI). Use this for anything the Kenney packs don't cover well — e.g. a distinctive flame-ignite whoosh for the streak beat, a layered fanfare for level-up, a short comedic "uh-uh" blip for the paste-block moment.

- **Access:** APIv2 supports simple token authentication (request a key, attach it to requests) for read-only search/download, or full OAuth2 if you ever need write actions (uploading, rating) — token auth is all BroGram needs.
- **Rate limits:** published per-token daily/per-minute quotas apply to free accounts (on the order of dozens of requests per minute); this only matters for a one-time asset-fetch script, not runtime, so it is a non-issue in practice.
- **Process recommendation:** don't hand-download files by clicking around the site — write a small one-time `scripts/fetch-sounds.mjs` against the APIv2 token endpoint that pulls a pinned list of sound IDs. This makes the provenance of every file reproducible and auditable (sound ID, uploader, license, URL all captured in one place) rather than "someone downloaded a zip once."
- If a non-CC0 (CC-BY) Freesound sound is ever worth using because nothing CC0 fits, that's fine — CC-BY is fully MIT-compatible — but the attribution (author name, title, source URL, license URL) then **must** be preserved in `public/sounds/CREDITS.md` for as long as the file ships.

(Sources: [Freesound API authentication docs](https://freesound.org/docs/api/authentication.html), [Freesound API resources docs](https://freesound.org/docs/api/resources_apiv2.html), [Freesound FAQ](https://freesound.org/help/faq/), [Creative Commons — An Introduction to Freesound](https://opensource.creativecommons.org/blog/entries/freesound-intro/).)

### 3.3 Mixkit — avoid for files committed to the public repo

Mixkit's Sound Effects Free License permits commercial and personal use with **no attribution required**, which sounds ideal, but its terms explicitly restrict **redistributing or reselling items "as standalone sound assets or in their original form"** without first altering them "by applying human skill and effort" — the license is written for creators who *embed* a Mixkit sound inside a finished video/app/game deliverable, not for handing out the raw file itself. A public MIT git repository is precisely "the original file, standalone, extractable by anyone who clones it." That's a real fit problem, not a technicality: **do not commit raw Mixkit audio files to the BroGram repo.** Mixkit is fine to browse for inspiration/reference sounds you then recreate or source elsewhere. (Sources: [Mixkit Terms](https://mixkit.co/terms/), [Mixkit — official info page](https://mixkit.co/llm-info/), [Mixkit free sound effects](https://mixkit.co/free-sound-effects/).)

### 3.4 Pixabay — avoid for files committed to the public repo

Same shape of problem, more explicitly worded. Pixabay's Content License grants broad commercial-use rights with no attribution required, but directly states: **"You cannot sell or distribute the Content (either in digital or physical form) on a Standalone basis,"** defining Standalone as content where "no creative effort has been applied to the Content and it remains in substantially the same form." A `.mp3` sitting in `public/sounds/` in a public MIT repo is exactly that. **Do not commit raw Pixabay audio files to the repo** for the same reason as Mixkit — this is a direct quote from Pixabay's own Terms of Service, not an inference. (Source: [Pixabay Terms of Service](https://pixabay.com/service/terms/).)

### 3.5 The attribution ledger

Regardless of source, add `public/sounds/CREDITS.md` the moment the first sound file lands, with one row per file: filename, source (Kenney pack name / Freesound sound ID), author, license, and source URL. CC0 files need no attribution to function legally, but the ledger is what lets a future contributor (or an MIT-license auditor) verify at a glance that nothing in `public/sounds/` violates the "no Standalone redistribution" clauses above. This is cheap insurance for an open-source project whose whole pitch is being freely forkable.

## 4. Motion: GSAP 3.15 and Motion 13 — division of labor

Both libraries are already dependencies. Shipping a third would be pure bloat, so the design question is not "which one" but **which one owns which kind of animation.**

### 4.1 GSAP is now fully free — worth knowing for BroGram's MIT status

As of April 30, 2025, Webflow made **all of GSAP free, including every formerly-paid Club GreenSock plugin** (SplitText, MorphSVG, and the rest) — "the standard license has also been expanded to cover commercial use," for everyone, not just Webflow customers. This matters for an MIT project: there is no license-tier trap where a plugin BroGram wants (e.g. `SplitText` for a level-up number reveal) turns out to require a paid seat. GSAP's currently published version is **3.15.0** (April 13, 2026), which is what's already pinned in `package.json`; recent changelog items include adaptive directional easing (`easeReverse`, replacing the deprecated `yoyoEase`) and a `SplitText` fix for splitting inside iframes. (Sources: [Webflow — GSAP becomes free](https://webflow.com/updates/gsap-becomes-free), [CSS-Tricks — GSAP is now completely free](https://css-tricks.com/gsap-is-now-completely-free-even-for-commercial-use/), [GSAP 3.15.0 changelog discussion via GitHub](https://github.com/greensock/GSAP/commit/master?diff=split).)

### 4.2 Recommended split

- **GSAP owns:** anything sequenced, timed, or numeric — timelines (`gsap.timeline()`), the XP-counter number tween (§4.3), the streak-flame flicker, and any multi-step celebration choreography. GSAP's imperative timeline API is the right tool once an animation has more than one beat with explicit timing relationships.
- **Motion (`motion/react`) owns:** React-idiomatic mount/unmount and layout animation — a hint panel expanding into view, a buddy chat bubble sliding in, a badge's enter/exit via `AnimatePresence`. Motion's declarative `initial`/`animate`/`exit` props map directly onto component state, which is a better fit than manually timing a GSAP tween to a React re-render.
- Both must be scoped and cleaned up on unmount. GSAP: use the already-installed `@gsap/react`'s `useGSAP()` hook (context-scoped, auto-reverts on unmount) rather than bare `gsap.to()` calls in `useEffect`. Motion: `AnimatePresence` already handles the exit-before-unmount lifecycle correctly by design.

Motion's own naming history is worth noting only so nobody is confused mid-project: **Framer Motion was renamed to Motion in 2025** and became an independent (non-Framer-owned) project; `framer-motion` still works as a re-export, but new code should `import { motion } from 'motion/react'`. `package.json` already has `motion@^13.2.0`, so this is already handled correctly.

### 4.3 Celebration, level-up, streak-flame, and XP-counter patterns

**Number/XP counter (GSAP "odometer" technique):** tween a plain JS object's numeric field and write it into `el.textContent` on every frame, snapped to whole numbers:

```js
const state = { xp: fromValue }
gsap.to(state, {
  xp: toValue,
  duration: 0.6,
  ease: 'power1.out',
  snap: { xp: 1 },
  onUpdate: () => { el.textContent = state.xp.toLocaleString() },
})
```

This is the standard community pattern for GSAP number counters — animate a proxy object, snap to integers, format on `onUpdate` (add comma formatting there too if the number gets large). (Sources: [GreenSock forum — number counter + decimal separators](https://greensock.com/forums/topic/26886-number-counter-animation-in-gsap-3x-and-adding-decimal-separators-to-the-number/), [GreenSock forum — odometer animation](https://gsap.com/community/forums/topic/42433-odometer-animation/).)

**Reduced-motion gating, centrally:** GSAP's built-in `gsap.matchMedia()` is designed exactly for this — code registered inside a matched-media callback auto-reverts when the query stops matching, and `gsap.matchMediaRefresh()` lets a live in-app "reduce motion" toggle (§7) re-evaluate immediately without a reload. (Source: [GSAP docs — gsap.matchMedia()](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/), [Anne Bovelett — GSAP animations and accessibility](https://annebovelett.eu/gsap-and-accessibility-yes-you-can-have-both/).)

**Motion spring/stagger (for panel and badge entrances):** Motion animates transform-like properties (`x`, `scale`) with spring physics by default, and staggers a list of children via a `stagger()` helper fed into `delayChildren`:

```jsx
<motion.ul
  initial="hidden" animate="visible"
  variants={{ visible: { transition: { delayChildren: stagger(0.08) } } }}
>
```

and exit animations run through `AnimatePresence` keeping the element mounted until its `exit` variant finishes. (Source: [motion.dev — React animation docs](https://motion.dev/docs/react-animation).)

## 5. Confetti

**[canvas-confetti](https://github.com/catdad/canvas-confetti)** is the right pick: ISC license (fully MIT-compatible), **~6kB gzipped, zero dependencies**, used in production by GitHub and Linear among many others, and — critically for this project — it ships a first-class accessibility escape hatch: a **`disableForReducedMotion` boolean option** that, when true, checks `prefers-reduced-motion` via `matchMedia` and resolves the returned promise immediately instead of animating. That is exactly the guardrail §7 requires, built into the library rather than something to bolt on. A thin React wrapper (`react-canvas-confetti`) additionally ships ready-made "fireworks" and "realistic" presets if a richer look is wanted for the level-up moment specifically, though the base library's `confetti({...})` call is enough for the everyday attempt-passed burst. (Sources: [GitHub — catdad/canvas-confetti](https://github.com/catdad/canvas-confetti), [canvas-confetti on npm](https://www.npmjs.com/package/canvas-confetti), [Bundlephobia — canvas-confetti size](https://bundlephobia.com/package/canvas-confetti), [reduced-motion option discussion, issue #228](https://github.com/catdad/canvas-confetti/issues/228), [react-canvas-confetti presets](https://github.com/ulitcos/react-canvas-confetti).)

## 6. Page/state transitions and perceived performance

### 6.1 View Transitions in Next.js 16 App Router

This is directly current for BroGram's exact installed version. Next's own docs (version-stamped `16.3.4`, last updated 2026-08-25 — matching what's in `package.json` today) state plainly: **"View transitions work in the App Router with no configuration."** No `next.config` flag is needed (older Next 16.2-era blog posts describing an experimental config flag are out of date for 16.3.x). The mechanism is React's own `<ViewTransition>` component, imported directly from `'react'`, bundled via the React canary release Next 16's App Router already runs on:

```tsx
import { ViewTransition } from 'react'

<ViewTransition name={`item-${id}`}>
  <Thumbnail />
</ViewTransition>
```

Matching `name` props on two pages let the browser morph one element into the other across a navigation; `<Suspense>` fallback/content pairs can each get their own enter/exit animation for loading-state reveals; and a `transitionTypes` prop on `<Link>` lets forward/back navigations carry directional slide animations. **Browser support:** Chromium 125+ and recent Safari/Firefox for the newer transition-types/`view-transition-class` features this integration relies on — on unsupported browsers "your application works normally; the transitions do not animate," i.e. it degrades to an instant swap, never breakage.

**Reduced motion is explicitly addressed by Next's own guide**, with the recommended pattern being exactly the kind of blanket override this project needs everywhere:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*),
  ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
```

**Where to use it in BroGram, and where not to:** dashboard, reports, onboarding, and de-rot navigations are good candidates for a subtle crossfade/slide. The exercise route should **not** get a directional page transition — per the existing spec rule ("no decorative animation on the exercise screen"), and because remounting the editor/runtime worker mid-transition risks a visible flash or, worse, a runtime re-initialization cost that undercuts the "sluggish" complaint rather than fixing it. (Source: [Next.js docs — Designing view transitions](https://nextjs.org/docs/app/guides/view-transitions), fetched directly, version-matched to the repo's installed `16.3.4`.)

### 6.2 Skeletons and shimmer

Skeleton placeholders (rather than a blank screen or a bare spinner) are the standard technique for perceived-performance during data fetch, and they are the visual half of what the product owner's "sluggish, no optimistic UI" complaint is asking for (the caching/optimistic-update half is a separate, non-motion engineering thread). Commonly converged-on guidance across production examples (GitHub, Linear, Notion, Stripe-style dashboards): a shimmer sweep cycling around **1200–1500ms** reads as calm; much faster reads as anxious/frenetic, much slower reads as broken/stalled. Use `linear` easing for the shimmer sweep itself (a metronome, not an ease-in/out wobble) and, if using a pulse-opacity variant instead of a sweep, `cubic-bezier(0.4, 0, 0.6, 1)`. **Reduced-motion guard:** swap the animated shimmer/pulse for a static, slightly-lighter-than-background block under `prefers-reduced-motion: reduce` — the loading state should stay visually distinct without the animation. (Sources aggregated from: [Mat Simon — Simple but Effective Skeleton Loaders](https://www.matsimon.dev/blog/simple-skeleton-loaders), [freefrontend — CSS Skeleton Loadings](https://freefrontend.com/css-skeleton-loadings/), [CodePen — pure CSS skeleton shimmer](https://codepen.io/maoberlehner/pen/bQGZYB).)

## 7. The accessibility layer: reduced motion, reduced transparency, mute, haptics — and the rule that sits above all of them

### 7.1 `prefers-reduced-motion`

A standard CSS media feature with two values: `no-preference` (false) and `reduce` (true) — the user has told their OS they get motion sickness / vestibular discomfort from non-essential animation, most commonly large-scale scaling or panning. MDN's own recommended pattern is not "turn animation off" but "swap it for a calmer alternative" — e.g. replace a scaling pulse with an opacity-only dissolve, so state-change feedback is preserved without the vestibular trigger:

```css
@media (prefers-reduced-motion: reduce) {
  .animation { animation: dissolve 4s linear infinite both; }
}
```

BroGram currently has **zero** `prefers-reduced-motion` handling anywhere in `src/` — this needs to be added as part of this work, not layered on afterward, precisely because every new sound/motion feature in this design needs to check it from day one. (Source: [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).)

### 7.2 `prefers-reduced-transparency`

Newer and much less broadly supported: available from **Chrome 118** (CSS Media Queries Level 5), with other engines still catching up as of this writing — treat it strictly as **progressive enhancement**, not a load-bearing accessibility mechanism on its own. Where BroGram uses any glass/blur/translucent surface (a modal backdrop, a frosted panel), pair it with a plain, opaque fallback under this query:

```css
@media (prefers-reduced-transparency: reduce) {
  .glass-panel { backdrop-filter: none; background: var(--surface-solid); }
}
```

(Sources: [MDN — prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency), [Chrome for Developers — CSS prefers-reduced-transparency](https://developer.chrome.com/en/blog/css-prefers-reduced-transparency), [caniuse tracking issue](https://github.com/Fyrd/caniuse/issues/7017).)

### 7.3 Mute toggle

A persistent, single, always-reachable mute control (not buried in a settings page) is standard practice for anything that plays UI sound — pair it with the same `zustand` store pattern already used for session state (§8.3), persisted to `localStorage` so the preference survives reloads. Default it **on**: nothing can play before the first gesture anyway (§2.4), so defaulting on costs nothing and matches the product owner's explicit ask for a livelier, more "fun" default experience; the toggle exists for the user who decides afterward that they don't want it.

### 7.4 Haptics: `navigator.vibrate`

Treat this as a pure bonus layer, feature-detected, never load-bearing:

- **Requires a genuine user gesture** ("sticky user activation") — cannot fire from a timer or a network response completing on its own.
- **Chromium/Android:** supported, single-engine feature.
- **Firefox:** **removed** support in Firefox 129 (August 6, 2024) — it used to work, it does not now.
- **iOS/Safari (WebKit):** **never shipped, and formally opposed.** WebKit's own standards-positions repository states it has not implemented the Vibration API and cites device independence, unclear use cases, power consumption, abuse/annoyance potential, and integration infeasibility on Apple hardware as reasons. (One isolated bug report from March 2026 claimed it "works on iOS Safari now"; it is not corroborated by WebKit's own stated position or by other compatibility testing, so it should not be relied on.)

Net effect: `navigator.vibrate` reaches, realistically, only Chromium-on-Android users today. Wrap every call in a feature check and a `try/catch`, and never let it be the only feedback for anything:

```js
function buzz(pattern = 15) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try { navigator.vibrate(pattern) } catch { /* not our business why it failed */ }
}
```

(Sources: [MDN — Navigator.vibrate()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate), [caniuse — Vibration API](https://caniuse.com/vibration), [WebKit standards-positions — Vibration API issue #267](https://github.com/WebKit/standards-positions/issues/267), [TestMu — Vibration API browser support (Firefox 129 removal)](https://www.testmuai.com/learning-hub/vibration-api-browser-support/).)

### 7.5 The rule that governs everything above: never sound-only, never haptics-only

This is both a WCAG requirement and simple good practice. **WCAG 1.4.2 (Audio Control, Level A)** requires that any audio autoplaying longer than 3 seconds be independently pausable/stoppable/volume-controllable from within the page, not just via system controls — BroGram's sounds are all short one-shots, not autoplaying background audio, so this specific clause rarely triggers directly, but the spirit of it (the user must always be able to shut audio off without leaving the page) is exactly what the mute toggle in §7.3 exists to satisfy. More generally, accessibility guidance is explicit that **no feedback should rely solely on sound, shape, size, or position** — every sound-carrying event in BroGram's table (§8.1) must already have a non-audio channel doing the same signaling job (a color change, an icon, a copy string, a motion cue) with sound and haptics layered on top as a bonus, never as the only channel. Concretely: the paste-block toast already shows text and will keep doing so; adding a sound to it is additive, not a replacement for the visible message. (Sources: [W3C — Understanding SC 1.4.2](https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-dis-audio.html), [WCAG.com — 1.4.2 Audio Control](https://www.wcag.com/designers/1-4-2-audio-control/), [AAArdvark — WCAG 1.4.2 plain English](https://aaardvarkaccessibility.com/wcag-plain-english/1-4-2-audio-control/).)

## 8. BroGram sound and motion system design

Design philosophy, informed by the research above and by how Duolingo (the most-studied precedent for this exact genre — a learning app that plays a "bro," not a teacher) times its own reward loop: a correct answer gets "a satisfying chime or applause," a streak continuation gets its own distinct celebratory sound tied to loss-aversion psychology (streaks "increase commitment by 60%" per commonly cited case-study figures), and the mascot's own micro-interactions carry personality rather than neutrality. BroGram's version of this needs the same shape — bigger reward for bigger moments, near-silence on the exercise screen itself per the existing spec rule, and warmth (not shame) on failure. (Sources, treated as directional case-study evidence rather than first-party Duolingo statements: [Medium — Duolingo micro-interactions](https://medium.com/@Bundu/little-touches-big-impact-the-micro-interactions-on-duolingo-d8377876f682), [Medium — Duolingo streak system breakdown](https://medium.com/@salamprem49/duolingo-streak-system-detailed-breakdown-design-flow-886f591c953f), [StriveCloud — Duolingo gamification](https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo), [Orizon — Duolingo streaks & XP](https://www.orizon.co/blog/duolingos-gamification-secrets).)

### 8.1 Event → sound → animation table

| Event | Trigger | Sound | Motion | Notes |
|---|---|---|---|---|
| First interaction anywhere in the app | any first click/keydown/touchend | none (silent unlock buffer) | none | Fires `Howler.autoUnlock`; not a user-visible moment |
| Route navigation (dashboard/reports/onboarding/de-rot) | App Router `<Link>` | none | `<ViewTransition>` crossfade or directional slide (§6.1) | Never on the exercise route |
| Run clicked (free run, ungraded) | Run button | quiet neutral click | button press scale 0.97→1 (Motion) | Deliberately lower-key than Submit — it's not the graded moment |
| Submit clicked (graded run) | Submit button | soft whoosh (anticipation) | progress indicator only | No result yet — don't spend the celebration budget here |
| Attempt passed | `attempt-passed` | rising 2-3 note success chime | GSAP timeline: checkmark draw + XP tween (§4.3) + small `canvas-confetti` burst anchored to the result panel (not full-viewport) + streak-flame flicker if it's the day's first pass | The core dopamine moment — must feel distinct from a generic toast |
| Attempt failed | `attempt-failed` | soft neutral thud — never a harsh buzzer | 4px/150ms shake on the failing test row only, not the whole screen | BroGram is a bro, not a scold — no punitive tone |
| Hint requested/revealed | `hint-requested` | gentle single tone (e.g. a soft "page turn") | Motion height-auto + fade-in panel | |
| Streak continues (first pass of the day) | derived from pass event + date check | flame ignite whoosh | GSAP flame icon scale+glow pulse, brief spark particles | Loss-aversion pattern (§8 intro) |
| Streak lost | streak reset detected | one somber, low, optional-mute tone — never louder than the pass chime | flame dims to ember; explicitly no confetti | Keep gentle — reassurance, not punishment |
| Level up / mastery tier reached | planner/mastery grid update | short layered fanfare (bigger budget — this is rare) | fuller GSAP timeline: badge entrance + XP tween + edge glow, always skippable/dismissable | Rare event, so a slightly bigger sound/motion budget than the routine pass chime is fine |
| XP counter increments | any XP gain, including inside the pass timeline | omit, or one very quiet tick on the final settled value only | GSAP `innerText`/proxy-object snap tween (§4.3) | Do not tick per-frame — one blip when it lands is enough |
| Paste blocked | clipboard guard (`useLockdown.ts`) | short, light comedic blip — on-brand, not alarming | toast micro-shake + icon bounce | Direct fix for the product owner's "personality-free" complaint on this exact toast (`useLockdown.ts:87`) — keep the visible copy (per §7.5), add sound+motion on top, and it's a good place to make the copy itself funnier too |
| PrintScreen pressed | key guard (`useLockdown.ts:131-141`) | short glitch/static blip | replace the flat overlay with a brief scanline/glitch-flash transition in and out of the 2s window | Direct fix for the "PrintScreen overlay is theatre" complaint — the goal is for it to read as *something actually happened* rather than a decorative pause |
| Idle/blur lockdown cover engages | `useLockdown` blur/idle state | **none — silence is correct here** | fade to cover, blur increases | This is a "step away" moment, not a reward moment; do not add sound |
| Buddy message arrives | buddy agent reply | soft notification pop | chat bubble slide-in + typing-dots stagger (Motion) | |
| Wellness reminder (pomodoro/prayer/water) | wellness timers | gentle, low-volume notification tone, never autoplay-loud | rail badge pulse | Must stay easily interruptible/mutable — this is the closest thing BroGram has to "notification audio" and should be the most conservative sound in the whole table |
| De-rot drill answered correctly | drill submit | quick, light positive blip | inline checkmark animation | Lower stakes than a full exercise pass — lighter effect budget |
| Integrity escalation (warn/restrict/ban) shown to the learner | weighted auto-escalation | firm, neutral tone — not celebratory, not harsh-punitive | plain modal, explicitly **no confetti, no playful sound** | Tone boundary: the "bro" personality does not apply to enforcement moments; this must read as serious and fair |
| Skeleton loading (dashboard/exercise-list/report fetch) | route/data fetch pending | none | shimmer sweep, ~1400ms cycle, linear easing (§6.2) | Addresses the visual half of the "sluggish" complaint |
| Report/PDF generation finishes | report ready | short single ding | download button pulse | |

### 8.2 Asset list

| Asset need | Recommended source | License | Notes |
|---|---|---|---|
| UI click/confirm/cancel | Kenney — [UI Audio](https://kenney.nl/assets/ui-audio) (50 sounds) | CC0 | primary source for the bulk of one-shots |
| Hover/select variety | Kenney — [Interface Sounds](https://kenney.nl/assets/interface-sounds) (100 sounds) | CC0 | |
| Pass thump / fail thud | Kenney — [Impact Sounds](https://kenney.nl/assets/impact-sounds) (130 sounds) | CC0 | |
| Retro blips (level-up register, XP tick) | Kenney — [Digital Audio](https://kenney.nl/assets/digital-audio) (60 sounds) | CC0 | fits a coding-tool "bro" tone |
| Streak ignite whoosh, layered fanfare, comedic paste-block blip, buddy notification pop | [Freesound.org](https://freesound.org/), CC0-filtered search via APIv2 token | CC0 (or CC-BY, attributed) | fetch via a pinned-ID script (§3.2), not manual download |
| Confetti (code, not audio) | [canvas-confetti](https://github.com/catdad/canvas-confetti) | ISC | ~6kB gzip, zero deps, ships `disableForReducedMotion` |
| Audio playback engine (code) | [howler](https://www.npmjs.com/package/howler) v2.2.4 | MIT | not yet installed — add it |
| Do not use for committed repo assets | Mixkit, Pixabay | their own terms restrict "Standalone"/"original form" redistribution | fine as inspiration only, never as a committed file (§3.3, §3.4) |

Every file that lands in `public/sounds/` gets one row in `public/sounds/CREDITS.md`: filename, source, author, license, URL (§3.5).

### 8.3 Manager API

New modules, all client-only:

```ts
// src/lib/sound/manager.ts
'use client'
import { Howl, Howler } from 'howler'

export type SoundEventId =
  | 'ui.click' | 'run.start' | 'submit.whoosh'
  | 'attempt.pass' | 'attempt.fail' | 'hint.reveal'
  | 'streak.ignite' | 'streak.lost' | 'levelup.fanfare'
  | 'xp.settle' | 'paste.blocked' | 'printscreen.glitch'
  | 'buddy.pop' | 'wellness.chime' | 'drill.correct' | 'report.ready'

class SoundManager {
  private howl: Howl | null = null
  private enabled = true
  private pending: SoundEventId[] = []

  /** Called once, high in the tree, after the sprite JSON is fetched. */
  load(src: string[], sprite: Record<string, [number, number]>) {
    this.howl = new Howl({ src, sprite })
    this.howl.once('load', () => {
      this.pending.splice(0).forEach(id => this.howl!.play(id))
    })
  }

  setEnabled(on: boolean) {
    this.enabled = on
    Howler.mute(!on)
  }

  /** Safe to call before load() finishes or before the first user gesture — never throws. */
  play(id: SoundEventId) {
    if (!this.enabled) return
    if (!this.howl) { this.pending.push(id); return }
    this.howl.play(id)
  }
}

export const soundManager = new SoundManager()
```

```ts
// src/hooks/useSound.ts
'use client'
import { useCallback, useEffect } from 'react'
import { soundManager, type SoundEventId } from '@/lib/sound/manager'
import { usePreferences } from '@/store/preferences'

export function useSound() {
  const enabled = usePreferences(s => s.soundEnabled)
  useEffect(() => { soundManager.setEnabled(enabled) }, [enabled])
  return useCallback((id: SoundEventId) => soundManager.play(id), [])
}
```

```ts
// src/lib/motion/celebrate.ts
'use client'
import gsap from 'gsap'
import confetti from 'canvas-confetti'

let lastBurst = 0

export function celebrateAttemptPass(panel: HTMLElement, reducedMotion: boolean) {
  if (reducedMotion) {
    gsap.fromTo(panel, { opacity: 0.6 }, { opacity: 1, duration: 0.2 })
    return
  }
  gsap.timeline()
    .to(panel, { scale: 1.03, duration: 0.18, ease: 'back.out(2)' })
    .to(panel, { scale: 1, duration: 0.22 })

  const now = Date.now()
  if (now - lastBurst < 1200) return // cooldown: never stack bursts from rapid-fire events
  lastBurst = now
  const rect = panel.getBoundingClientRect()
  confetti({
    particleCount: 60,
    spread: 55,
    origin: { x: (rect.left + rect.width / 2) / window.innerWidth, y: rect.top / window.innerHeight },
    disableForReducedMotion: true,
  })
}

export function tweenXp(el: HTMLElement, from: number, to: number) {
  const proxy = { val: from }
  gsap.to(proxy, {
    val: to,
    duration: 0.6,
    ease: 'power1.out',
    snap: { val: 1 },
    onUpdate: () => { el.textContent = proxy.val.toLocaleString() },
  })
}
```

```ts
// src/lib/motion/haptics.ts
export function buzz(pattern: number | number[] = 15) {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  try { navigator.vibrate(pattern) } catch { /* enhancement only */ }
}
```

```ts
// src/hooks/useMediaPreference.ts
'use client'
import { useSyncExternalStore } from 'react'

function subscribe(query: string, cb: () => void) {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    cb => subscribe('(prefers-reduced-motion: reduce)', cb),
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
}

export function usePrefersReducedTransparency() {
  // Chrome 118+ only today — progressive enhancement, never load-bearing (§7.2)
  return useSyncExternalStore(
    cb => subscribe('(prefers-reduced-transparency: reduce)', cb),
    () => window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
    () => false,
  )
}
```

```ts
// src/store/preferences.ts — new zustand slice, alongside the existing src/store/session.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PreferencesState {
  soundEnabled: boolean
  reducedMotion: 'system' | 'on' | 'off' // layered on top of the OS signal, per §7.1
  toggleSound: () => void
  setReducedMotion: (v: PreferencesState['reducedMotion']) => void
}

export const usePreferences = create<PreferencesState>()(
  persist(
    set => ({
      soundEnabled: true,
      reducedMotion: 'system',
      toggleSound: () => set(s => ({ soundEnabled: !s.soundEnabled })),
      setReducedMotion: v => set({ reducedMotion: v }),
    }),
    { name: 'brogram:preferences' },
  ),
)
```

A single combined hook resolves the effective reduced-motion flag (OS signal + in-app override) for every celebration call site to consume:

```ts
// src/hooks/useReducedMotion.ts
export function useReducedMotion() {
  const override = usePreferences(s => s.reducedMotion)
  const osReduced = usePrefersReducedMotion()
  if (override === 'on') return true
  if (override === 'off') return false
  return osReduced
}
```

The mute control itself is one `lucide-react` `Volume2`/`VolumeX` icon button in the app shell header, backed by `usePreferences().toggleSound()` — no settings-page burial.

### 8.4 Performance guardrails

- **Sound assets load lazily, after the first gesture, never on the critical path.** Dynamic-import the sprite JSON + Howl construction from inside the same handler that satisfies the autoplay-unlock requirement (§2.4) — this is free, since that handler has to exist anyway.
- **Sprite size budget:** the full UI sprite (all ~15-20 one-shots) should stay in the tens of KB per format (mp3 + webm) — see §2.3. This is negligible next to the exercise page's existing Pyodide/CodeMirror payload, but it should still never be part of the initial route bundle.
- **Never let sound/motion become a trigger source.** The project's existing hard rule — an agent call fires only on the seven named triggers, never on a keystroke, timer, or page load — extends unmodified to this layer. No sound or animation callback may call `/api/agent`, directly or indirectly.
- **Coalesce rapid-fire events.** `useLockdown.ts` already solves this exact problem for integrity logging (a `lastLogged` map with a 1-second window, `useLockdown.ts:95`) — reuse the same shape for sound triggers so, e.g., fast typing never spams a click sound and rapid failed-attempt retries don't stack thuds.
- **Cap simultaneous confetti bursts** with a cooldown (shown as `lastBurst`/1200ms above) — canvas-confetti itself is cheap, but firing several overlapping bursts from quick successive events reads as chaotic, not celebratory, and costs paint time on the "usable on a 13-inch laptop at 100% zoom" hardware floor the spec already commits to.
- **GSAP timelines and Motion presence must be scoped to their component's lifetime.** Use `useGSAP()` from `@gsap/react` (already installed) instead of bare `useEffect` + `gsap.to()`, so route changes in the App Router can never leave a dangling timeline running against an unmounted node.
- **The exercise screen stays quiet by design**, per the existing spec rule reproduced in §0 — reward beats fire only on the Submit result and on hint-reveal, never as ambient/looping motion, and no page-transition animation wraps the exercise route at all (§6.1) — the editor must never remount or flash mid-attempt.
- **`prefers-reduced-motion` and the in-app override are checked once per call site**, via `useReducedMotion()` (§8.3), not scattered ad hoc — every celebration/animation entry point takes the resolved boolean as a parameter rather than re-querying `matchMedia` itself.
- **Haptics and sound are always additive, never the only channel** (§7.5) — this is a review checklist item, not just a principle: any PR adding a new sound/vibration must point at the existing non-audio feedback it's layered on top of.
- **New dependency cost is small and justified:** `howler` (~20KB min+gzip) + `canvas-confetti` (~6KB gzip) on top of the GSAP/Motion already shipped — no new heavy library needed for this whole system.

### 8.5 What this document does not cover

By design, and matching the scope given for this research: the wellness-rail collapse/position system, the onboarding-walkthrough gap, and the profiler-rerun/optimistic-UI/caching latency complaints are layout, product-flow, and data-fetching problems respectively — real product owner asks, but not sound-or-motion problems, and covered (or awaiting coverage) elsewhere. This design intersects them only where a shared primitive applies directly: the skeleton/shimmer pattern in §6.2 is the motion half of the "sluggish" fix, and the paste-block/PrintScreen entries in §8.1 are the personality fix for those two specifically named-as-theatre moments.

## Sources

- [GitHub — goldfire/howler.js](https://github.com/goldfire/howler.js/)
- [npm — howler](https://www.npmjs.com/package/howler)
- [howler.js sprite example](https://github.com/goldfire/howler.js/tree/master/examples/sprite)
- [Josh On Design — Audio Element vs WebAudio](https://joshondesign.com/p/books/canvasdeepdive/chapter12.html)
- [web.dev — Developing game audio with the Web Audio API](https://web.dev/articles/webaudio-games)
- [MDN — Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MDN — audio for web games (via mdn/content)](https://github.com/mdn/content/blob/main/files/en-us/games/techniques/audio_for_web_games/index.md)
- [Chrome for Developers — Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay)
- [Chromium — Autoplay Policy Design Rationale](https://www.chromium.org/audio-video/autoplay/autoplay-policy-design-rationale/)
- [Bitmovin — Autoplay policies for Safari 14 and Chrome 64](https://bitmovin.com/blog/autoplay-policies-safari-14-chrome-64/)
- [audiosprite on GitHub](https://github.com/tonistiigi/audiosprite)
- [audiosprite on npm](https://www.npmjs.com/package/audiosprite)
- [TestMu — Ogg Vorbis browser support on Safari](https://www.testmuai.com/web-technologies/ogg-vorbis-safari/)
- [GitHub mdn/content #35773 — Vorbis/WebM Safari support discussion](https://github.com/mdn/content/issues/35773)
- [Kenney — UI Audio](https://kenney.nl/assets/ui-audio)
- [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds)
- [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds)
- [Kenney — Digital Audio](https://kenney.nl/assets/digital-audio)
- [GitHub — Calinou/kenney-ui-audio LICENSE.txt (CC0 confirmation)](https://github.com/Calinou/kenney-ui-audio/blob/master/LICENSE.txt)
- [Freesound.org](https://freesound.org/)
- [Freesound API — authentication](https://freesound.org/docs/api/authentication.html)
- [Freesound API — resources](https://freesound.org/docs/api/resources_apiv2.html)
- [Freesound — FAQ](https://freesound.org/help/faq/)
- [Creative Commons — An Introduction to Freesound](https://opensource.creativecommons.org/blog/entries/freesound-intro/)
- [Mixkit — Terms](https://mixkit.co/terms/)
- [Mixkit — official LLM info page](https://mixkit.co/llm-info/)
- [Mixkit — free sound effects](https://mixkit.co/free-sound-effects/)
- [Pixabay — Terms of Service (Content License)](https://pixabay.com/service/terms/)
- [Pixabay — sound effects](https://pixabay.com/sound-effects/)
- [GitHub — catdad/canvas-confetti](https://github.com/catdad/canvas-confetti)
- [npm — canvas-confetti](https://www.npmjs.com/package/canvas-confetti)
- [Bundlephobia — canvas-confetti](https://bundlephobia.com/package/canvas-confetti)
- [canvas-confetti issue #228 — reduced motion](https://github.com/catdad/canvas-confetti/issues/228)
- [GitHub — ulitcos/react-canvas-confetti](https://github.com/ulitcos/react-canvas-confetti)
- [Webflow — GSAP becomes free](https://webflow.com/updates/gsap-becomes-free)
- [CSS-Tricks — GSAP is now completely free](https://css-tricks.com/gsap-is-now-completely-free-even-for-commercial-use/)
- [GSAP docs — gsap.matchMedia()](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/)
- [Anne Bovelett — GSAP animations and accessibility](https://annebovelett.eu/gsap-and-accessibility-yes-you-can-have-both/)
- [GreenSock forum — number counter animation](https://greensock.com/forums/topic/26886-number-counter-animation-in-gsap-3x-and-adding-decimal-separators-to-the-number/)
- [GSAP community forum — odometer animation](https://gsap.com/community/forums/topic/42433-odometer-animation/)
- [GSAP 3.15.0 changelog (via GitHub commit)](https://github.com/greensock/GSAP/commit/master?diff=split)
- [motion.dev](https://motion.dev/)
- [motion.dev — React animation docs](https://motion.dev/docs/react-animation)
- [npm — framer-motion (rename note)](https://www.npmjs.com/package/framer-motion)
- [Next.js docs — Designing view transitions](https://nextjs.org/docs/app/guides/view-transitions)
- [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [MDN — prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency)
- [Chrome for Developers — CSS prefers-reduced-transparency](https://developer.chrome.com/en/blog/css-prefers-reduced-transparency)
- [GitHub Fyrd/caniuse #7017 — prefers-reduced-transparency tracking](https://github.com/Fyrd/caniuse/issues/7017)
- [MDN — Navigator.vibrate()](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate)
- [caniuse — Vibration API](https://caniuse.com/vibration)
- [GitHub WebKit/standards-positions #267 — Vibration API](https://github.com/WebKit/standards-positions/issues/267)
- [TestMu — Vibration API browser support](https://www.testmuai.com/learning-hub/vibration-api-browser-support/)
- [W3C — Understanding SC 1.4.2 Audio Control](https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-dis-audio.html)
- [WCAG.com — 1.4.2 Audio Control](https://www.wcag.com/designers/1-4-2-audio-control/)
- [AAArdvark — WCAG 1.4.2 plain English](https://aaardvarkaccessibility.com/wcag-plain-english/1-4-2-audio-control/)
- [Mat Simon — Simple but Effective Skeleton Loaders](https://www.matsimon.dev/blog/simple-skeleton-loaders)
- [freefrontend — CSS Skeleton Loadings](https://freefrontend.com/css-skeleton-loadings/)
- [CodePen — pure CSS skeleton shimmer](https://codepen.io/maoberlehner/pen/bQGZYB)
- [Medium — Duolingo micro-interactions](https://medium.com/@Bundu/little-touches-big-impact-the-micro-interactions-on-duolingo-d8377876f682)
- [Medium — Duolingo streak system breakdown](https://medium.com/@salamprem49/duolingo-streak-system-detailed-breakdown-design-flow-886f591c953f)
- [StriveCloud — Duolingo gamification](https://www.strivecloud.io/blog/gamification-examples-boost-user-retention-duolingo)
- [Orizon — Duolingo streaks & XP](https://www.orizon.co/blog/duolingos-gamification-secrets)
