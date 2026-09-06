# Theming, Typography & the BroGram Voice — v2 Research

Scope: multi-theme system for Tailwind CSS 4 + shadcn/ui, a Geist-based type scale, design tokens for radius/elevation/motion/sound, a BroGram "bro" voice guide (50 strings), and an honest anti-cheat copy set. This answers the theming/voice/anti-cheat slice of the 2026-09-06 product-owner verdict. Onboarding re-runs, bank latency, caching and walkthrough *mechanics* are separate tracks — this doc only supplies the copy and visual system those tracks should render.

Every recommendation is grounded either in a live source (linked inline and in **Sources**) or in the current BroGram code (file:line cited) — the two are never blended without saying which is which. Palette numbers below are a **starting point for a contrast tool, not a verified final palette** — nothing in this document was run through an actual contrast checker; see §2.4.

---

## 0. What v1 actually has today

Checked directly against the repo so recommendations build on fact, not assumption:

- **One theme, grayscale only.** `src/app/globals.css` defines shadcn's default OKLCH tokens on `:root` (light values) and a `.dark` class override. No hue anywhere — every token's OKLCH chroma is `0`. This is the "plain, no personality" the product owner named.
- **A latent bug worth fixing while touching this file.** `:root` sets `color-scheme: dark` (line 8) directly above `--background: oklch(1 0 0)` — a *light* background value. The browser is told to render native form controls/scrollbars in dark style on top of a light-token root. Each new theme block must set its own matching `color-scheme`.
- **`next-themes@0.4.6` is already a dependency** but is only imported once, inside `src/components/ui/sonner.tsx`, to theme toast styling. There is no `ThemeProvider` in the app — the multi-theme system is being built from a cold start, not extended.
- **The wellness rail has no placement control at all.** `src/components/wellness/Rail.tsx` and `src/components/shell/WellnessSlot.tsx` take a `compact` boolean (exercise screen vs. not) and nothing else — no `side`, no collapse state, no persisted placement. Wherever the shell's CSS puts it is where it lives. This confirms the complaint literally: there is no code path today that could honor "left/right/top/dock/hidden."
- **The wellness sync pipeline already exists and is reusable.** `Rail.tsx` reads/writes `wellness.prefs` (jsonb) via a small `mergePrefs` / `updatePrefs` / `persist` pattern (lines 22–28, 160–177). Extending `WellnessPrefs` (`src/lib/contracts.ts:499`) with placement, theme, and sound fields reuses this exact pipeline instead of inventing a new one — see §2.9.
- **The PrintScreen overlay is provably theatre, not just "feels like" theatre.** `src/components/exercise/LockdownOverlay.tsx:17` shows "Keep your work here" / "Your exercise will return in a moment" as a full-screen opaque cover, triggered on `keyup` (`src/hooks/useLockdown.ts:132-136`). By the time `keyup` fires, the OS has already rasterized the screen — covering the DOM afterward blocks nothing that wasn't already captured, and does nothing at all against a phone camera or an OS screen-recorder, neither of which touches the keyboard. See §5.2 for the fix.
- **The escalation math is already real and specific** (`src/lib/contracts.ts:210-230`): `paste-blocked` and `copy-blocked` weight 2, `printscreen` weight 3, `blur` weight 1, `contextmenu-blocked` and `idle` weight 0 (idle is logged, never scored). Over a 7-day window: score ≥10 → `warned`, ≥20 → `restricted` 24h, ≥40 → `banned`; 5 paste attempts inside one exercise → instant 24h restriction regardless of score. The honest copy in §5 quotes these numbers back to the user rather than inventing new ones.
- **The current paste-blocked message is a single static string** — `"Type it. That's the whole point."` (`src/hooks/useLockdown.ts:87`) — which is why it reads flat on repeat viewing. §4 and §5 give a rotating set.

---

## 1. Theme system spec

### 1.1 Token architecture

Two layers, same shape the codebase already has — just widened from one theme to four:

1. **Primitive tokens** — raw OKLCH values, private to one `[data-theme="…"]` block. Never referenced by components directly.
2. **Semantic tokens** — the role names shadcn components already consume (`--background`, `--primary`, `--border`, …). Every theme block redefines the *same* semantic names. **No component ever branches on which theme is active** — that is the entire point of the indirection, and it's why this is additive to v1 rather than a rewrite.

Tailwind CSS 4 formalizes exactly this pattern with its `@theme` directive: tokens are plain CSS custom properties in a namespaced form (`--color-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--ease-*`, `--animate-*`), and a single `@theme` block turns each one into a matching utility class automatically. shadcn's own Tailwind v4 setup already layers this as `@theme inline` mapping `--color-background: var(--background)` etc., which is precisely the block already sitting in `globals.css:43-85` — it does not need to change shape, only gain more theme blocks feeding it. [Tailwind: functions and directives](https://tailwindcss.com/docs/functions-and-directives) · [shadcn: Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)

### 1.2 Four themes, not a light/dark toggle

The product owner asked for four *named* looks, not a light/dark binary with a "brand" layered on top. Two of the four are dark. Modeling them as one axis (`data-theme="midnight|amber|paper|arcade"`) is simpler to build and QA than a light/dark × brand matrix, and matches the literal ask. Each theme sets its own `color-scheme` (native form controls/scrollbars follow it) instead of relying on a separate `.dark` class.

shadcn's own docs stop at light/dark, but the community pattern for N named themes on top of shadcn is well established — `data-*` attribute selectors driven by `next-themes`, exactly as `tweakcn`'s theme-picker package does for 42+ themes. [next-themes README](https://github.com/pacocoursey/next-themes) · [tweakcn-theme-picker](https://github.com/BankkRoll/tweakcn-theme-picker)

`next-themes` (confirmed current version **0.4.6** via the npm registry — same version already installed) supports this directly:

```tsx
// app/providers.tsx — client component, per next-themes' App Router requirement
<ThemeProvider
  attribute="data-theme"
  themes={['midnight', 'amber', 'paper', 'arcade']}
  defaultTheme="midnight"
  enableSystem={false}
  storageKey="brogram:theme"
>
  {children}
</ThemeProvider>
```

```tsx
// app/layout.tsx
<html lang="en" suppressHydrationWarning>
```

- `enableSystem={false}` is deliberate: `next-themes`' system-detection keys off two poles named `light`/`dark`; with four discrete personalities that don't reduce to a binary, forcing system-matching either fights the API or requires a bespoke first-visit script. **Default everyone to `midnight`** (the PO's literal words: "a dark default") and make the picker impossible to miss (§1.8) — this also means *zero* first-visit flash risk, which a system-seeded default would reintroduce for light-OS users. If a system-aware first visit is wanted later, it's a one-line addition (read `matchMedia('(prefers-color-scheme: light)')` once, before the first paint, only when `localStorage['brogram:theme']` is empty) — flagged here as a deliberate deferral, not an oversight.
- The injected anti-flash script runs before hydration and covers "forced themes, system theme, multiple themes, and incognito" per the library's own description — no custom `noflash.js` needed. `suppressHydrationWarning` on `<html>` is required because the attribute value is set by that pre-hydration script, not by the first server render. [next-themes README](https://github.com/pacocoursey/next-themes)

### 1.3 Color science: OKLCH + a two-checker rule

The current file already uses OKLCH — keep it, and use it correctly across four themes instead of one:

- **OKLCH's `L` channel is why it's the right space for this job.** Two OKLCH colors at the same `L` read as equally bright *regardless of hue*, so a palette can hold background/text pairs at fixed lightness anchors and swap hue per theme without re-deriving contrast by eye each time. [accessibility.build: OKLCH + APCA color systems](https://accessibility.build/guides/oklch-apca-color-systems)
- **Check every pairing against both WCAG 2.2 and APCA.** WCAG 2.1/2.2's ratio-based contrast is still the legal/compliance baseline everywhere in 2026; APCA is the perceptually-accurate successor slated for WCAG 3 and already the more honest predictor of real readability, especially at small sizes or thin weights where a WCAG-passing pair can still read as blurry. Passing both is the safe target. [Capellic: Accessible Colors, WCAG to APCA](https://capellic.com/insights/accessible-colors) · [APCA Contrast Calculator](https://apcacontrast.com/)
- **APCA `Lc` targets to hold, by use:**

| Use | Minimum `Lc` |
|---|---|
| Body text, fluent reading | 75 |
| Body text, preferred | 90 |
| Large text (24px+/18.66px bold) | 60 |
| UI components (buttons, inputs) | 60 |
| Focus rings, dividers, icons | 45 |

  [accessibility.build: OKLCH + APCA color systems](https://accessibility.build/guides/oklch-apca-color-systems)

- **Don't invert to make dark mode; assign separately.** The same guide's clearest warning: don't take the light theme and flip lightness — dark surfaces want their *own* mid-range anchor (roughly stops 400–500 for primary surfaces) with foregrounds pulled from the far light end, checked independently, or you get "a dark mode that looks correct in marketing screenshots but fails real reading sessions." Every theme below was built as its own pair, not a flip of another. [accessibility.build: OKLCH + APCA color systems](https://accessibility.build/guides/oklch-apca-color-systems)
- **Verify before shipping, don't trust this document's numbers as final.** Run every theme through [tweakcn.com](https://tweakcn.com/) or [DesignRevision's OKLCH generator](https://designrevision.com/tools/shadcn-theme-generator) (both contrast-check live shadcn components) and cross-check the borderline pairs at [apcacontrast.com](https://apcacontrast.com/). The `L` values below are the load-bearing part of each recommendation; hue and chroma are adjustable to taste.

### 1.4 The four themes

Each theme fills the **same** semantic slots (§1.5), so component code never changes. Names are BroGram-flavored, not generic ("Light"/"Dark").

| Theme | Personality | Base | Text | Hero accent | Support accent | Radius |
|---|---|---|---|---|---|---|
| **Midnight** (dark default) | Confident, cool, "the developer's 2am default" | near-black, faint blue-violet | near-white | indigo/violet-blue | cool cyan | 10px (current shadcn default) |
| **Amber** (warm dark) | Cozy, late-night, lamp-lit desk | near-black, warm umber | warm off-white | amber/orange | terracotta | 14px |
| **Paper** (light paper) | Daytime, notebook, unhurried | warm cream, never stark white | warm ink near-black | deep ink-blue | terracotta | 12px |
| **Arcade** (high-contrast / fun) | Cabinet glow, maximum legibility | true near-black, neutral | nearly-pure white | electric cyan | hot magenta (sparingly) | 4px |

Starting OKLCH anchors (`L C H`) — **run through a contrast tool before shipping**, per §1.3:

```css
/* Midnight — dark default */
[data-theme="midnight"] {
  color-scheme: dark;
  --background: oklch(0.16 0.014 260);
  --foreground: oklch(0.96 0.005 260);
  --card: oklch(0.20 0.016 260);
  --card-foreground: var(--foreground);
  --primary: oklch(0.72 0.19 264);
  --primary-foreground: oklch(0.15 0.02 264);
  --secondary: oklch(0.27 0.014 260);
  --muted: oklch(0.27 0.014 260);
  --muted-foreground: oklch(0.66 0.02 260);
  --accent: oklch(0.74 0.14 200);
  --destructive: oklch(0.65 0.21 25);
  --success: oklch(0.75 0.16 150);
  --warning: oklch(0.80 0.15 85);
  --celebration: oklch(0.80 0.19 95);
  --border: oklch(1 0 0 / 10%);
  --ring: oklch(0.72 0.19 264 / 0.6);
  --radius: 0.625rem;
}

/* Amber — warm dark */
[data-theme="amber"] {
  color-scheme: dark;
  --background: oklch(0.17 0.02 55);
  --foreground: oklch(0.95 0.01 70);
  --card: oklch(0.21 0.024 55);
  --card-foreground: var(--foreground);
  --primary: oklch(0.74 0.16 55);
  --primary-foreground: oklch(0.16 0.02 55);
  --secondary: oklch(0.28 0.02 55);
  --muted: oklch(0.28 0.02 55);
  --muted-foreground: oklch(0.68 0.02 60);
  --accent: oklch(0.72 0.13 35);
  --destructive: oklch(0.65 0.22 25);
  --success: oklch(0.73 0.15 140);
  --warning: oklch(0.80 0.16 85);
  --celebration: oklch(0.82 0.17 80);
  --border: oklch(0.9 0.02 60 / 12%);
  --ring: oklch(0.74 0.16 55 / 0.6);
  --radius: 0.875rem;
}

/* Paper — light paper */
[data-theme="paper"] {
  color-scheme: light;
  --background: oklch(0.97 0.008 85);
  --foreground: oklch(0.22 0.015 55);
  --card: oklch(0.99 0.006 85);
  --card-foreground: var(--foreground);
  --primary: oklch(0.42 0.11 220);
  --primary-foreground: oklch(0.98 0.005 85);
  --secondary: oklch(0.93 0.012 85);
  --muted: oklch(0.93 0.012 85);
  --muted-foreground: oklch(0.45 0.02 70);
  --accent: oklch(0.55 0.14 35);
  --destructive: oklch(0.55 0.20 25);
  --success: oklch(0.45 0.12 150);
  --warning: oklch(0.62 0.15 80);
  --celebration: oklch(0.60 0.16 70);
  --border: oklch(0.85 0.01 85);
  --ring: oklch(0.42 0.11 220 / 0.5);
  --radius: 0.75rem;
}

/* Arcade — high-contrast / fun */
[data-theme="arcade"] {
  color-scheme: dark;
  --background: oklch(0.12 0 0);
  --foreground: oklch(0.99 0 0);
  --card: oklch(0.16 0 0);
  --card-foreground: var(--foreground);
  --primary: oklch(0.85 0.16 195);
  --primary-foreground: oklch(0.12 0 0);
  --secondary: oklch(0.24 0 0);
  --muted: oklch(0.24 0 0);
  --muted-foreground: oklch(0.75 0 0);
  --accent: oklch(0.75 0.22 350);
  --destructive: oklch(0.70 0.22 25);
  --success: oklch(0.82 0.19 145);
  --warning: oklch(0.85 0.17 95);
  --celebration: oklch(0.85 0.18 90);
  --border: oklch(1 0 0 / 18%);
  --ring: oklch(0.85 0.16 195 / 0.7);
  --radius: 0.25rem;
}
```

Design notes behind the choices:

- **Arcade stays hue-neutral on background/secondary/muted on purpose.** Neon research is unanimous that the effect comes from restraint — "one hero neon, one support neon, and a stable neutral" reads as polished; two or three competing saturated hues on a saturated background is the failure mode ("optical vibration," eye strain, and it stops being legible as a *high-contrast accessibility theme* the moment it does that). Cyan carries `primary`/interactive state, magenta is reserved for `accent` (used sparingly — celebrations, active indicators), and everything structural (`background`, `card`, `secondary`, `muted`) stays neutral gray so the two neons still pop. [Kittl: neon color palettes](https://www.kittl.com/blogs/neon-colors-for-your-design-asp) · [DevPalettes: neon palettes](https://devpalettes.com/neon-color-palettes/)
- **Amber and Paper both use warm, not pure, neutrals.** Warm dark-mode guidance is explicit that pure black/white reads as harsh and that a deep, desaturated warm base ("sepia instead of pure black for shadows... adds an organic, analog feel") is the more comfortable choice for long reading/coding sessions; the same logic runs the other direction for Paper, where a cream base beats stark white for the same reason (less glare, feels like an actual notebook page). [Vev: dark mode palettes](https://www.vev.design/blog/dark-mode-website-color-palette/) · [ColorUX Lab: sepia](https://coloruxlab.com/colors/sepia-color)
- **`--celebration` is a new token**, not a repaint of `--primary` or `--warning` — it exists so a streak/level-up burst always reads as *the same* golden/bright accent regardless of which theme is active, distinct from the theme's own primary hue. See §1.5 for the full new-token list.

### 1.5 New semantic tokens (additive — nothing existing is renamed)

The current `globals.css` is missing pairs the gamification/status UI needs. All of these are additive; no existing component-facing name changes:

| Token | Why it doesn't exist yet but should | Used for |
|---|---|---|
| `--destructive-foreground` | Missing today; text-on-destructive currently relies on assumption, not a token, and that assumption won't hold across four different destructive hues | Text/icon on a destructive button or badge |
| `--success` / `--success-foreground` | No success color exists at all today — pass states currently borrow ad hoc `text-emerald-*` utility classes (see `Rail.tsx:217`) instead of a theme token | Pass banners, green checks, "verified" badges |
| `--warning` / `--warning-foreground` | Same gap | Restricted-state banners, low-time warnings |
| `--celebration` / `--celebration-foreground` | New concept, not a repaint of primary (§1.4) | Streak flame, level-up burst, XP counter highlight |
| `--glow` | Dark/Arcade themes communicate elevation and "this is interactive" with light, not shadow (§1.6) — Paper and the current grayscale system have no equivalent because flat shadows work fine there | Focus/active glow on Arcade and Midnight, confetti-adjacent highlight |

### 1.6 Elevation: shadow tokens per theme, not one shadow scale for all

A single `--shadow-md` value cannot serve both Paper and Arcade well, because they communicate depth through opposite mechanisms:

- **Paper (light):** a conventional soft shadow works — `box-shadow: 0 4px 12px oklch(0.4 0.02 70 / 0.10)` and larger.
- **Midnight / Amber (dark):** a black shadow on a near-black background is nearly invisible. The well-established dark-theme answer (Material's dark-theme elevation model) is to communicate elevation by **lightening the surface itself** at higher elevation rather than by shadow depth — an increasing white-overlay percentage on the surface color as elevation rises (roughly 5% at the lowest raised surface up to ~16% at the highest), plus a thin light top edge, not a heavier shadow. This is why `--card` above sits measurably lighter than `--background` in every dark theme, and why raising that gap further (a `--popover`/`--dialog` token even lighter than `--card`) is the right lever for a modal or dropdown rather than a bigger shadow.
- **Arcade:** elevation *and* "this is interactive" both read through a **colored glow**, not a shadow — layered box-shadow at two radii using the theme's own hero/accent color at low opacity (e.g., `0 0 8px oklch(0.85 0.16 195 / 0.35), 0 0 24px oklch(0.85 0.16 195 / 0.2)`), which is the documented technique for making a UI element look like it emits light against a dark backdrop; never as a `text-shadow` (that degrades legibility), only as a `box-shadow` around the element. [Kittl: neon palettes](https://www.kittl.com/blogs/neon-colors-for-your-design-asp) · [designsystems.surf: elevation patterns](https://designsystems.surf/articles/depth-with-purpose-how-elevation-adds-realism-and-hierarchy)

Implement as a `--shadow-*` namespace per `@theme`, four flat sizes (`xs/sm/md/lg`) each redefined per theme block, exactly like `--radius-*` already is in the current file (`globals.css:78-84`).

### 1.7 Motion tokens

Baseline stays what's already proven in shadcn/Tailwind ecosystems — `150ms` at `cubic-bezier(0.4, 0, 0.2, 1)` is the de facto standard for ordinary state changes — and extends outward for entrances and celebration:

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | 100ms | Button press, checkbox tick |
| `--duration-fast` | 150ms | Hover, small state changes (shadcn's existing default) |
| `--duration-base` | 200ms | Panel/tab transitions |
| `--duration-slow` | 320ms | Modal/drawer open, theme-switch cross-fade |
| `--duration-celebration` | 600–900ms | Streak burst, level-up — the *only* tier allowed to run this long, and only for positive moments, never functional UI |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Default for everything (keep shadcn's existing value) |
| `--ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | Entrances — snappier start, matches Material 3's "emphasized" easing family |
| celebration motion | a real spring (`type: 'spring', stiffness: 300, damping: 20`), not a faked cubic-bezier overshoot | Level-up pop, XP counter tick — the `motion` package (`motion@13.2.0`, already a dependency) supports true spring physics natively, which interrupts and resumes far more naturally than a keyframed bounce when the user acts again mid-animation |

Sources for the scale and easing-family shape: shadcn's documented `150ms` / `cubic-bezier(0.4,0,0.2,1)` convention, Material 3's short/medium/long/extra-long duration tiers and "emphasized vs. standard" easing split, and `motion`'s (formerly Framer Motion) native spring support post-rename. [designsystems.surf: elevation & tokens](https://designsystems.surf/articles/depth-with-purpose-how-elevation-adds-realism-and-hierarchy) · [Material 3: easing and duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) · [motion.dev](https://motion.dev/)

**`prefers-reduced-motion` contract:** collapse `--duration-celebration` to `--duration-fast` and drop to an opacity/scale cross-fade — no spring, no particle motion. Do not delete the feedback entirely: accessibility guidance is specific that *essential* feedback should reduce, not vanish, while only *decorative* motion should be cut outright. A level-up must still show the "Level 4" label and (if sound is on) play its cue even with all motion suppressed — the animation is one of three channels (visual, numeric, audio), never the only one. [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) · [Pope Tech: accessible animation](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)

**Nice-to-have, not launch-blocking:** the View Transitions API (`document.startViewTransition()`) can turn the theme-switch moment itself into a one-line animated reveal (a circular wipe from the picker button is the common pattern) instead of a hard cut. It's broadly supported in 2026 but still marked experimental for some multi-page-app cases — treat as progressive enhancement (`if (document.startViewTransition)`), and it must itself respect `prefers-reduced-motion`. [MDN: View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) · [theme-toggle.rdsx.dev](https://theme-toggle.rdsx.dev/)

### 1.8 Sound

No audio library exists in `package.json` today. Recommendation: **Howler.js**, ~7KB gzipped, dependency-free, with built-in **sprites** — every UI cue lives as one named slice inside a single audio file, so the whole sound system is one network request and every `play('level-up')` call has zero added latency. [howlerjs.com](https://howlerjs.com/) · [Tone.js vs Howler.js](https://supadark.com/notes/tone-js-vs-howler-js)

Rules that follow directly from browser policy and from the tone-dial in §2:

- **No sound before a genuine user gesture.** Chrome/Firefox/Safari have all blocked unmuted autoplay since 2017–2019; a `Howler`/`AudioContext` created on page load sits `suspended` until the user's first click/keypress on the page. Initialize the sound engine lazily on the first `pointerdown`/`keydown`, not on mount — otherwise the very first cue silently drops and logs a console warning. [MDN: Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) · [Chromium: Autoplay](https://www.chromium.org/audio-video/autoplay/)
- **Sound is reserved for positive/neutral product moments only** — pass, streak, level up, hint arriving, toast confirmation. **Never** for lockdown/integrity events (blur, idle, paste-blocked, printscreen, restricted, banned) — those stay silent and text-only. A jaunty sound effect on a ban notice reads as mockery, not honesty, and directly undercuts the "real-talk" tone those moments need (§2.3).
- Mute and volume are persisted next to theme (§1.9) and live in the same picker surface — sound and theme are sibling "make it feel alive" controls, not buried in two different settings pages.
- Budget the whole sprite to stay small enough to be ready before it's needed (a rough target: keep the combined file under ~150KB) — this is an engineering guideline, not a verified benchmark from a source.

### 1.9 Persistence: instant-local, synced-durable

Two tiers, matching what `Rail.tsx` already does for wellness prefs — no new pattern, just a wider one:

1. **`next-themes`' own `localStorage` (`storageKey: "brogram:theme"`)** is the source of truth for first paint — its pre-hydration script reads it before React mounts, which is the entire no-flash mechanism (§1.2). This *must* stay device-local and instant; it should never wait on a network round trip.
2. **`wellness.prefs` (existing jsonb column)** carries the cross-device copy. Extend `WellnessPrefs` (`src/lib/contracts.ts:499`) — a **contracts change, so it goes through the project's existing contracts-PR rule**, not a special exception:

   ```ts
   export interface WellnessPrefs {
     // ...existing fields unchanged...
     theme: 'midnight' | 'amber' | 'paper' | 'arcade'
     railPlacement: 'left' | 'right' | 'top' | 'dock' | 'hidden'
     railCollapsed: boolean
     soundEnabled: boolean
     soundVolume: number // 0–1
   }
   ```

   On login, reconcile: if `wellness.prefs.theme` exists and differs from the local value, the synced value wins and overwrites `localStorage` (so a returning user's other device's choice travels with them); if the local value was set before any server value existed (a fresh, unauthenticated visit), the local choice becomes the first `persist()` write once the user signs in — the same "local first, sync once authenticated" shape `Rail.tsx` already implements for water/pomodoro logs (`Rail.tsx:124-144, 160-177`).

### 1.10 Fixing the wellness rail placement complaint directly

Concretely, on top of the `WellnessPrefs` extension above:

- `Rail.tsx` and `WellnessSlot.tsx` gain a `placement` prop read from `wellness.prefs.railPlacement`, driving which flex/grid slot of the shell layout renders the rail — `left`/`right` as flanking columns, `top` as a header strip (reusing the existing `compact` layout, which already renders the rail as a horizontal `flex-wrap` row for exercise screens — `Rail.tsx:195-204` — so "top/dock" is largely "use the compact renderer outside the exercise route too"), `dock` as a floating collapsible corner tab, `hidden` rendering nothing but leaving a small always-visible re-open affordance (never a dead end with no way back).
- A collapse toggle (persisted as `railCollapsed`) is a plain icon button in the rail's own header — shadcn's `Sidebar` primitive already models exactly this shape natively (`side: 'left' | 'right'` plus a `collapsible: 'offcanvas' | 'icon' | 'none'` prop), so this is a known, off-the-shelf composition rather than a bespoke layout problem. [shadcn: Sidebar](https://ui.shadcn.com/docs/components/base/sidebar)
- Placement and collapse controls live in the same settings surface as theme/sound (§1.8) — one "make this yours" panel, not three scattered toggles.

### 1.11 Theme picker UX

- **Not a segmented control.** Segmented controls read best at 2–3 options in a single row; four full personalities (not "light/dark/system") are better represented as a small grid of swatch previews — each option shows a live miniature (background + primary + accent dots) plus its name ("Midnight," "Amber," "Paper," "Arcade"), in a popover reachable from one persistent icon in the shell header. [UX Collective: segmented control ambiguity](https://uxdesign.cc/reducing-ambiguity-on-the-segmented-control-design-a5a1feef54f0) · precedent for the icon-triggered popover pattern: [shadcn dropdown-menu theme selector](https://www.shadcn.io/examples/dropdown-menu-theme-selector)
- **Discoverability was the actual complaint** ("no themes and no personality") — put the trigger where it's seen on every screen (shell header, not buried in a settings sub-page), and consider a single one-time spotlight/tooltip on first load after this ships ("New: pick your look") so returning users notice it exists.
- Use `role="radiogroup"` / `role="radio"` semantics (one theme is ever "checked") so it's keyboard- and screen-reader-navigable, not just click-only swatches.

---

## 2. Typography

Geist Sans (UI/body) and Geist Mono (code) are already wired as `--font-sans` / `--font-mono` in `globals.css:46-47` — keep both, do not introduce Inter (explicitly forbidden). Vercel's own published scale is Figma-token-based and doesn't expose raw pixel values publicly, so the table below is BroGram's **own scale**, built from Geist's two documented, load-bearing traits rather than copied from an unavailable source:

- Body copy defaults to **14px**, and letter-spacing **tightens as size increases** (documented range: roughly `-2.4px` at 48px down to normal-tracking at 14px) — headlines feel deliberately compressed rather than merely "bigger body text." [Vercel: Geist Typography](https://vercel.com/geist/typography)
- Geist Mono is reserved for **numerals and code**, not general headings — "sharp monospaced numerals" is called out as the signature trait of the Geist-driven dev-tool aesthetic. [Vercel: Geist Typography](https://vercel.com/geist/typography) · [Vercel: Geist](https://vercel.com/geist/introduction)

| Role | Size / line-height | Letter-spacing | Weight | Font |
|---|---|---|---|---|
| Display (level-up, hero numbers) | 48 / 56px | −0.02em | 600 | Geist Sans |
| H1 | 32 / 40px | −0.015em | 600 | Geist Sans |
| H2 | 24 / 32px | −0.01em | 600 | Geist Sans |
| H3 | 20 / 28px | −0.005em | 600 | Geist Sans |
| H4 / large label | 16 / 24px | 0 | 600 | Geist Sans |
| Body (base) | 14 / 22px | 0 | 400 | Geist Sans |
| Body small / caption | 13 / 20px | 0 | 400 | Geist Sans |
| Micro / meta (uppercase allowed only here) | 12 / 16px | +0.01em | 500 | Geist Sans |
| Code / editor | 13 / 20px | 0 | 400 | Geist Mono |

**One concrete polish point:** apply `font-variant-numeric: tabular-nums` to every counter that ticks live — streak day count, XP, hint countdown, timer. Digits then hold fixed width as they change, so a counter animating upward never jitters the surrounding layout. This follows directly from Geist Mono's documented "sharp monospaced numerals" role even where the surrounding label stays in Geist Sans. [Vercel: Geist Typography](https://vercel.com/geist/typography)

---

## 3. The BroGram voice guide

### 3.1 Voice vs. tone — the one principle every source agrees on

Every brand-voice guide researched draws the identical line, in different words: **voice is constant, tone is situational.** Mailchimp states it most plainly — "you have the same voice all the time, but your tone changes" with context and the reader's emotional state. Duolingo's writing guidelines put it the same way: the voice is "always uniquely Duolingo," but tone "is all about reading the room," dialing exuberance up for a streak and down for something that isn't actually fun. [Mailchimp: Voice and Tone](https://styleguide.mailchimp.com/voice-and-tone/) · [Tonelab: Duolingo](https://www.tonelab.so/brand/duolingo)

This is the design rule for BroGram's ban/restriction copy in particular: **the voice doesn't switch off, the tone does.** BroGram is still your bro when the news is bad — supportive, not cold — but a bro delivering a suspension does not crack jokes about it. Slack frames the same discipline as "confident, never cocky; witty, but never silly" — the personality never overwhelms what actually needs to be understood. [Slack: Voice and Tone](https://api.slack.com/best-practices/voice-and-tone) · [Slack Design: 5 principles](https://slack.design/articles/thevoiceofthebrand-5principles/)

### 3.2 BroGram voice pillars

Synthesized from the same four sources' shape (Mailchimp's plainspoken/genuine/dry-humor, Duolingo's expressive/playful/embracing/worldly, Discord's playful/reliable/original/relatable, Slack's confident/witty/conversational/helpful), translated into BroGram's specific "the program with a b" identity:

1. **Plain, not corporate.** Short sentences, active voice, zero filler ("leverage," "seamless," "empower"). Say the actual thing.
2. **On your side, out loud.** BroGram roots for the user by default — the assumption is always "we're figuring this out together," even when the news is a failed test.
3. **Bro is a flavor, not a tic.** "Bro" and its register (yo, nailed it, let's go) show up in openers and celebrations. It never appears in an error's technical detail, never in security/integrity copy, and never twice in one short message — Mailchimp's own warning against forced humor applies directly: funny when it comes naturally, never forced. [Mailchimp: Voice and Tone](https://styleguide.mailchimp.com/voice-and-tone/)
4. **Honest before hype.** When something is broken, slow, or a consequence of the user's own actions, BroGram says so plainly before it says anything encouraging. This is the direct answer to "no more theatre" (§4) and it is a voice rule, not just an anti-cheat rule.

### 3.3 The tone dial

One axis, from hype to real-talk. Every situation in the app sits somewhere on it — nothing is ever pure sarcasm-free corporate-speak, and nothing is ever jokey about something serious:

```
HYPE ──────────────────────────────────────────────── REAL-TALK
streak · level up · pass          hint · fail · empty bank · offline          blur · idle · paste-blocked          restricted · banned
```

### 3.4 Fifty example strings

No emoji (sound and animation carry the celebratory register instead), no institution names, English only. Paste-blocked, blur, idle, restricted, and banned strings are written to rotate (never show the same one twice from the same trigger in a row) — this is also the direct fix for the flat, single static paste-block string called out in the verdict.

**Welcome**
1. "Yo. Welcome to BroGram — the program with a B. Let's get your hands dirty."
2. "You made it. No fluff, no lectures — just code, from line one."
3. "First rule of BroGram: we don't just watch you code. We ride with you."
4. "Alright, you're in. Pick a course and let's see what you've got."

**First lesson / walkthrough**
5. "New here? Follow the highlights — we'll point at exactly what to click first."
6. "This one's a walkthrough, not a test. Type along, nothing's graded yet."
7. "Take the guided lap once. After this, you're driving solo."
8. "No pressure on lesson one. We're just showing you where everything lives."

**Pass**
9. "Nailed it. Tests are green, you're good to move."
10. "That's a pass. Onto the next one before you get comfortable."
11. "Clean run. Whatever you just learned, it stuck."
12. "Green across the board. That's how it's done."

**Fail**
13. "Not this time. Let's see what broke and fix it together."
14. "Red on a couple tests — happens to everyone. Check the diff."
15. "Close, but the tests disagree. Take another pass."
16. "That one didn't land. No shame in it — that's literally what this is for."

**Hint**
17. "Stuck? Here's a nudge, not the answer."
18. "One hint, coming up. You've still got to write the code."
19. "Here's a push in the right direction. Rest is on you."
20. "This hint costs nothing but pride. Use it."

**Streak**
21. "Day 7 straight. You're not stopping now, are you?"
22. "Streak's alive. Show up tomorrow and keep it that way."
23. "That's three days in a row. Momentum's a real thing — ride it."
24. "Streak's on the line today. One exercise keeps it going."

**Level up**
25. "Level up. You just outgrew where you started."
26. "New tier unlocked. The exercises get sharper from here."
27. "That's a level. Look back at lesson one — you'd crush it now."
28. "You leveled up. Go flex on the next CLO."

**Paste blocked** *(rotate; replaces the single static string at `useLockdown.ts:87`)*
29. "Typed, not pasted. That's the deal — your fingers do the learning."
30. "Paste is off in here on purpose. Type it out, it's how this sticks."
31. "No paste. Not because we don't trust you — because typing is the rep."
32. "Copy-paste won't build the muscle. Type it yourself."

**Blur**
33. "Work's paused — you clicked away. Come back to pick it up."
34. "Lost focus for a second. Click back in whenever you're ready."
35. "Paused while you were elsewhere. Nothing lost, just come back."

**Idle**
36. "You've been quiet a while. Still there?"
37. "Paused for inactivity. Type something to keep going."
38. "No input in a bit, so we paused it. Pick up right where you left off."

**Restricted**
39. "Your account's restricted for now — some patterns tripped our checks. Full access is back at [time]."
40. "We flagged some activity on your account. You can still work; a few things are limited until [time]."
41. "Restricted, not banned. Here's exactly what triggered it, and when it lifts."

**Banned**
42. "Your account's banned. The activity log that caused it is below — this isn't a guess."
43. "This account is banned for repeated integrity violations. If you think we got it wrong, here's how to appeal."
44. "Banned. We don't do this lightly — check the events below for exactly why."

**Empty bank**
45. "We're out of fresh exercises for this exact pattern. Generating one now — hang tight."
46. "Nothing queued yet for this spot. Give us a second to build one."
47. "You've cleared what we had ready. One more is being written for you right now."

**Offline**
48. "No connection. Whatever you've got open still runs — we just can't grade it yet."
49. "You're offline. Keep coding; we'll sync the second you're back."
50. "Lost the connection. Your code's safe locally — reconnect to submit."

### 3.5 Quick do/don't

| Do | Don't |
|---|---|
| "Bro" as an opener or celebration flavor, once per message at most | "Bro" stacked into every sentence, or anywhere in security/ban copy |
| Name the actual cause ("a few patterns tripped our checks") | Vague blame ("suspicious activity detected") |
| Offer the next step in the same sentence as the setback | Leave a failure/restriction with no stated way forward |
| Keep celebration copy under ~8 words — it's a burst, not a paragraph | Write a level-up toast like a marketing email |

---

## 4. Honest lockdown copy set

### 4.1 The honesty principle: say what's actually true about each mechanism

The verdict's core complaint — "the PrintScreen overlay is theatre" — is a specific, correct technical claim, and the fix is to make the copy match reality per mechanism instead of presenting all three as equally "protected":

| Mechanism | What's actually true | Source |
|---|---|---|
| **Paste/copy/cut/context-menu blocking** | Reliable. `preventDefault()` on the clipboard events has been supported across all major browsers since 2015 and genuinely stops the paste before content lands in the editor. This is the one enforcement claim BroGram can make without hedging. | [MDN: Element paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event) |
| **PrintScreen key detection** | Best-effort only, and only against that one specific key. By the time a `keyup` fires, the OS has already rasterized the frame — there is nothing left to prevent. It catches nothing from a phone camera, an OS screen-recorder, a second computer's camera, or (on some OS/browser combinations) `PrintScreen` itself, which can fire no reliable `keydown` at all (Firefox is a known case, already handled via the `keyCode === 44` fallback at `useLockdown.ts:132`). | [LockLizard: stop-screenshots](https://www.locklizard.com/stop-screenshots-grabbers/) · [Alyaman Alhayek: do websites know when you screenshot](https://alyamanalhayekdesign.com/blog/do-websites-know-when-you-screenshot/) |
| **Screenshots/screen recording in general** | Not preventable by any web technology, full stop. HTML/CSS/JS cannot reach the OS layer where a screenshot happens; the only products that meaningfully restrict it (Netflix, Hulu) use OS/DRM-level hooks unavailable to an ordinary web app, and even those are bypassable. | [LockLizard: stop-screenshots](https://www.locklizard.com/stop-screenshots-grabbers/) |
| **Blur / tab-away detection** | A genuine, standard signal (`visibilitychange` / `blur`), but a soft one — a real browser extension exists specifically to spoof the Page Visibility API and defeat it, so it is evidence, never proof. | [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) |

The honest framing that follows from this table, and that the copy below is built on: **BroGram enforces the one thing it actually can (paste), watches the things that are decent signals but not proof (blur, PrintScreen attempts), is upfront that it cannot stop screenshots at all, and never pretends otherwise.** This mirrors what the academic-proctoring literature independently converges on: transparent, in-advance communication about exactly what's monitored and why measurably reduces user anxiety and makes the system feel fair, compared to unexplained blocking. [UTSA: strategies for academic integrity in online proctoring](https://utsa.screenstepslive.com/a/1953027-strategies-for-academic-integrity-in-online-proctoring)

### 4.2 Fix: retire the PrintScreen blackout, don't just reword it

`LockdownOverlay.tsx:17` currently shows a full-screen cover ("Keep your work here" / "Your exercise will return in a moment") for two seconds after every PrintScreen `keyup`. Given §4.1, this should change in kind, not just in words:

- **Stop covering the screen for PrintScreen.** The cover happens *after* the capture is already done — it inconveniences a student who hit PrintScreen for an unrelated reason (a bug report, a note to themselves) and protects nothing. Log the event silently (already happens via `logIntegrity('printscreen')`, `useLockdown.ts:134`) and let the student keep working uninterrupted.
- **Reserve any visible acknowledgment for a pattern, not a single keypress.** A single PrintScreen is ambiguous and common; only after it recurs is a one-line, honest, non-blocking toast worth showing — something like: *"Heads up — we can't block screenshots (no one actually can), but we do log the attempt, and it's part of your integrity record."* Said once as a pattern emerges, never as a modal, never repeated on every subsequent press.
- **Keep the blur and idle overlays** — those cover genuinely paused work for a genuinely useful reason (the student stepped away; there's nothing to protect against, just state to preserve) and the current copy for both is already close to honest. §3.4's blur/idle strings are drop-in replacements/rotations for the same component.

### 4.3 Paste-blocked: rotate the message, add the "why"

Replace the single static string at `useLockdown.ts:87` with the four-item rotating set from §3.4 (#29–32), chosen at random per block event rather than always showing the same one. Add a small, optional "why" affordance next to the toast (a `?` or "why" link) that on demand shows the one honest sentence behind the rule — this is the concrete difference between *asserting* a rule and *explaining* it:

> "Paste is off in the editor because typing is the whole point of the exercise — and because it's the one thing browsers actually let us enforce, so we do."

### 4.4 Restricted / banned: show the real numbers, not a euphemism

The escalation math is already specific and real (`contracts.ts:210-230`) — the honest move is to show the student their *own* numbers rather than a vague "some activity was flagged." A restricted or banned screen should read as an itemized receipt, not a verdict from nowhere:

**Restricted screen**
> "You're restricted for the next 24 hours. Here's why: your integrity score crossed 20 in the last 7 days.
>
> — Screenshot attempts (×3, weight 3 each) = 9
> — Paste blocked (×4, weight 2 each) = 8
> — Tab-away (×3, weight 1 each) = 3
> **Total: 20**
>
> Dashboard and de-rot drills are still open. Exercises come back at [restricted_until]. If a lot of this is screenshot attempts and you weren't trying to get around anything, know that we log every PrintScreen press the same way regardless of intent — see 'why we track this' below."

**Banned screen**
> "This account is banned. Score crossed 40 in the last 7 days from the events below — same weights, same math as everyone else's.
>
> [itemized event list, same shape as above]
>
> If you think this is wrong, reply to [contact] with your account email and we'll look at the actual log, not just the number."

**Instant-restrict variant** (5 paste attempts in one exercise, regardless of score — `INTEGRITY_THRESHOLDS.instantRestrictPasteCount`):
> "Paste got blocked 5 times in this one exercise, so it's restricted for 24 hours — that's an automatic rule, not a judgment call, and it fires the same way for every student at exactly 5."

### 4.5 An "Integrity, explained" panel — the full honest policy, in voice

A single always-reachable panel (linked from the restricted/banned screens and from Settings) that says the whole thing plainly, once, so nothing above needs to re-explain itself:

> "Here's the actual deal. We block paste, copy, and cut in the editor — browsers let us enforce that one for real, so typing it yourself is the whole rep.
>
> We notice when you leave the tab, go quiet, or hit PrintScreen — because those are decent signals, not because we can prove anything from them alone. Straight talk: nobody can stop a screenshot. Not us, not anyone. If you want one badly enough, your phone camera doesn't even ask permission. So we don't pretend to block it — we just log it, same as everything else, and weigh it over time.
>
> One flag doesn't touch your account. A pattern might. It's the same math for every student, every time — score crosses 10, you get a heads-up; crosses 20, a 24-hour pause; crosses 40, you're out. You can see your own score and every event that built it, always, right here.
>
> The real backstop isn't any of this anyway — it's that your exercises aren't the same as anyone else's, so someone else's answer was never going to fit your problem."

The closing line quotes the design spec's own framing directly ("The real wall is per-student variant exercises," `2026-09-05-brogram-design.md:225`) — it's an honest thing to tell students, and it undercuts the temptation to over-invest in more detection theatre later.

---

## 5. Recommendations summary

1. Wire `next-themes` for real (it's installed, unused) — `attribute="data-theme"`, four named themes, `defaultTheme="midnight"`, `enableSystem={false}`; fix the `color-scheme: dark` on a light `:root` bug while touching this file (§0, §1.2).
2. Build the four themes as flat, independently-checked token sets (not a light/dark × brand matrix) — Midnight, Amber, Paper, Arcade — using the OKLCH anchors in §1.4 as a *starting* palette, verified against WCAG 2.2 and APCA with tweakcn/DesignRevision/apcacontrast.com before ship (§1.3).
3. Add the missing semantic tokens (`--destructive-foreground`, `--success`, `--warning`, `--celebration`, `--glow`) additively — no existing token renamed (§1.5).
4. Give dark themes elevation via lighter surfaces (Material's dark-elevation model), Arcade elevation via colored glow shadows, Paper elevation via conventional soft shadow — one `--shadow-*` scale is not enough here (§1.6).
5. Adopt a small motion-token scale (100/150/200/320ms + a real spring for celebrations), and make `prefers-reduced-motion` degrade celebration to a fast cross-fade — never to silence, since sound/number readouts still carry the moment (§1.7).
6. Add Howler.js (7KB, sprite-based) for sound; gate first playback behind the user's first real gesture; keep sound exclusively on positive moments, never on lockdown events (§1.8).
7. Extend `WellnessPrefs` (a contracts-PR change) with `theme`, `railPlacement`, `railCollapsed`, `soundEnabled`, `soundVolume`, reusing `Rail.tsx`'s existing local-then-synced persistence pattern rather than inventing a new one (§1.9).
8. Give the wellness rail an actual `placement` prop (left/right/top/dock/hidden) and a collapse toggle — shadcn's `Sidebar` primitive already models this shape (`side` + `collapsible`) (§1.10).
9. Put the theme (and sound) picker behind one persistent, discoverable icon in the shell header as a swatch-preview popover, not a segmented control and not buried in settings (§1.11).
10. Adopt the BroGram type scale in §2, keep Geist Mono for numerals specifically, and apply `tabular-nums` to every live counter.
11. Ship the 50-string voice set in §3.4 as the literal copy for these components, rotating the paste/blur/idle/restricted/banned variants rather than showing one static string.
12. Retire the PrintScreen full-screen cover entirely — log silently, surface an honest one-line note only once a pattern emerges, never a modal (§4.2). This is the direct fix for "the PrintScreen overlay is theatre."
13. Rewrite restricted/banned screens as itemized receipts using the real `INTEGRITY_WEIGHTS`/`INTEGRITY_THRESHOLDS` numbers already in `contracts.ts`, plus a permanent "Integrity, explained" panel that states plainly what's enforceable (paste), what's a signal (blur/PrintScreen), and what's simply impossible to prevent (screenshots) (§4.4–4.5).

---

## Sources

**Tailwind CSS 4 / shadcn theming**
- [Tailwind CSS: Functions and directives (`@theme`)](https://tailwindcss.com/docs/functions-and-directives)
- [shadcn/ui: Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)
- [Theming Shadcn with Tailwind v4 and CSS Variables (Medium)](https://medium.com/@joseph.goins/theming-shadcn-with-tailwind-v4-and-css-variables-d602f6b3c258)
- [How to theme shadcn/ui with CSS Variables (shadcndesign)](https://www.shadcndesign.com/blog/how-to-theme-shadcn-ui-with-css-variables)
- [tweakcn — shadcn/ui theme editor & generator](https://tweakcn.com/)
- [DesignRevision: shadcn theme generator](https://designrevision.com/tools/shadcn-theme-generator)
- [Lunchbox: shadcn/ui theme editor](https://lunchboxhands.com/tools/theme-editor/)
- [BankkRoll/tweakcn-theme-picker (GitHub)](https://github.com/BankkRoll/tweakcn-theme-picker)
- [shadcn.io: dropdown-menu theme selector example](https://www.shadcn.io/examples/dropdown-menu-theme-selector)
- [shadcn/ui: Sidebar component](https://ui.shadcn.com/docs/components/base/sidebar)
- [UX Collective: reducing ambiguity on segmented controls](https://uxdesign.cc/reducing-ambiguity-on-the-segmented-control-design-a5a1feef54f0)

**next-themes / App Router**
- [pacocoursey/next-themes (GitHub)](https://github.com/pacocoursey/next-themes)
- [next-themes on npm](https://www.npmjs.com/package/next-themes)
- [next-themes latest version — npm registry API](https://registry.npmjs.org/next-themes/latest)
- [Dave Gray: Light & Dark Mode in Next.js App Router + Tailwind with No Flicker](https://www.davegray.codes/posts/light-dark-mode-nextjs-app-router-tailwind)

**OKLCH / accessible color**
- [accessibility.build: OKLCH + APCA color systems](https://accessibility.build/guides/oklch-apca-color-systems)
- [Capellic: Accessible Colors — From WCAG to APCA](https://capellic.com/insights/accessible-colors)
- [APCA Contrast Calculator](https://apcacontrast.com/)

**Typography**
- [Vercel: Geist Typography](https://vercel.com/geist/typography)
- [Vercel: Geist introduction](https://vercel.com/geist/introduction)

**Design tokens — elevation, motion**
- [designsystems.surf: Elevation Design Patterns — Tokens, Shadows, and Roles](https://designsystems.surf/articles/depth-with-purpose-how-elevation-adds-realism-and-hierarchy)
- [Material Design 3: Easing and duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
- [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [Pope Tech: Design accessible animation and movement](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)
- [Tatiana Mac: prefers-reduced-motion, a no-motion-first approach](https://www.tatianamac.com/posts/prefers-reduced-motion)
- [MDN: View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)
- [theme-toggle.rdsx.dev — View Transitions theme toggle demo](https://theme-toggle.rdsx.dev/)
- [motion.dev (formerly Framer Motion)](https://motion.dev/)

**Palettes — warm dark, paper, neon/arcade**
- [Vev: Dark Mode Website Color Palette Ideas](https://www.vev.design/blog/dark-mode-website-color-palette/)
- [ColorUX Lab: Sepia Color](https://coloruxlab.com/colors/sepia-color)
- [DevPalettes: Dark Color Palettes](https://devpalettes.com/dark-color-palettes/)
- [Kittl: 30 Neon Color Palettes](https://www.kittl.com/blogs/neon-colors-for-your-design-asp)
- [DevPalettes: Neon Color Palettes](https://devpalettes.com/neon-color-palettes/)

**Sound**
- [Howler.js](https://howlerjs.com/)
- [Tone.js vs Howler.js (2026)](https://supadark.com/notes/tone-js-vs-howler-js)
- [MDN: Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [Chromium: Autoplay policy](https://www.chromium.org/audio-video/autoplay/)

**Voice and tone**
- [Mailchimp Content Style Guide: Voice and Tone](https://styleguide.mailchimp.com/voice-and-tone/)
- [Mailchimp Content Style Guide (home)](https://styleguide.mailchimp.com/)
- [design.duolingo.com/writing/voice](https://design.duolingo.com/writing/voice)
- [Tonelab: Duolingo tone of voice](https://www.tonelab.so/brand/duolingo)
- [Orizon: Duolingo's Gamification Secrets](https://www.orizon.co/blog/duolingos-gamification-secrets)
- [Discord: Branding Guidelines](https://docs.discord.com/developers/discord-social-sdk/design-guidelines/branding-guidelines)
- [Frictionless: Discord Brand Guide](https://frictionlesshq.com/brand-guide/discord/)
- [Slack: Voice and tone — communicating for clarity](https://api.slack.com/best-practices/voice-and-tone)
- [Slack: Choosing the right voice and tone for your app](https://api.slack.com/start/designing/voice-tone)
- [Slack Design: The voice of the brand — 5 principles](https://slack.design/articles/thevoiceofthebrand-5principles/)

**Gamification / rewards**
- [Medium: Gamification in UX — why it makes sense](https://medium.com/@camilabarros/gamification-in-ux-why-turning-your-digital-experience-into-a-game-makes-perfect-sense-a655bf7f8b19)
- [CodeTheorem: From Boring to Fun — Gamification in UX](https://codetheorem.co/blogs/gamification-in-design/)

**Empty states / error microcopy**
- [137Foundry: How to Design Error Messages and Empty States for UX](https://137foundry.com/articles/how-to-design-error-messages-empty-states-ux)
- [Carbon Design System: Empty states pattern](https://carbondesignsystem.com/patterns/empty-states-pattern/)
- [Parallel: 10 UX Writing Principles](https://www.parallelhq.com/blog/ux-writing-best-practices)
- [Leancode: Offline Mobile App Design](https://leancode.co/blog/offline-mobile-app-design)
- [web.dev: Offline UX design guidelines](https://web.dev/articles/offline-ux-design-guidelines)

**Anti-cheat / honest lockdown UX**
- [LockLizard: Disable print screen, stop screen capture & prevent PDF screenshots](https://www.locklizard.com/stop-screenshots-grabbers/)
- [Alyaman Alhayek Design: Do Websites Know When You Screenshot?](https://alyamanalhayekdesign.com/blog/do-websites-know-when-you-screenshot/)
- [MDN: Element paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event)
- [MDN: ClipboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent)
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [David Walsh: Page Visibility API](https://davidwalsh.name/page-visibility)
- [UTSA: Strategies for Academic Integrity in Online Proctoring](https://utsa.screenstepslive.com/a/1953027-strategies-for-academic-integrity-in-online-proctoring)
- [Medium: UX Writing for Agents — Phrasing That Builds Trust](https://medium.com/@connect.hashblock/ux-writing-for-agents-phrasing-that-builds-trust-deff7b986a1a)

**Repo evidence cited (not web sources)**
- `src/app/globals.css` — current single-theme token set, the `color-scheme` inconsistency
- `src/hooks/useLockdown.ts` — PrintScreen keyup handling, static paste message
- `src/components/exercise/LockdownOverlay.tsx` — the PrintScreen blackout copy
- `src/lib/contracts.ts` — `WellnessPrefs`, `INTEGRITY_WEIGHTS`, `INTEGRITY_THRESHOLDS`
- `src/components/wellness/Rail.tsx`, `src/components/shell/WellnessSlot.tsx` — current rail persistence and lack of placement control
- `docs/superpowers/specs/2026-09-05-brogram-design.md` — escalation table, "the real wall is per-student variants"
