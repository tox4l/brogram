import type { ThemeName } from '@/lib/contracts'

/**
 * The four personalities on next-themes' one axis (R8.1). Order here is
 * the order they render in `ThemeQuickSwitch`. Swatch triples are
 * [background, primary, accent] -- copied by hand from `globals.css`'s
 * `oklch(...)` values.
 *
 * I5 (review): these literals are pinned against the real tokens by a
 * dedicated assertion in `contrast.test.ts` ("swatches stay pinned to the
 * real tokens"), which parses `globals.css` and compares. That assertion,
 * not the key-set-parity check (a different, unrelated guarantee -- it only
 * confirms the four `[data-theme]` blocks define the same property
 * *names*), is what keeps a palette retune from silently leaving a stale
 * dot in the picker.
 */
export const THEMES: readonly { id: ThemeName; name: string; blurb: string; swatch: [string, string, string] }[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Confident, cool. The developer’s 2am default.',
    swatch: ['oklch(0.16 0.014 260)', 'oklch(0.78 0.16 264)', 'oklch(0.74 0.14 200)'],
  },
  {
    id: 'amber',
    name: 'Amber',
    blurb: 'Cozy, warm dark. A lamp-lit desk at midnight.',
    swatch: ['oklch(0.17 0.02 55)', 'oklch(0.78 0.16 55)', 'oklch(0.80 0.13 35)'],
  },
  {
    id: 'paper',
    name: 'Paper',
    blurb: 'Daytime, notebook, unhurried.',
    swatch: ['oklch(0.97 0.008 85)', 'oklch(0.42 0.11 220)', 'oklch(0.55 0.14 35)'],
  },
  {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Cabinet glow. Maximum legibility.',
    swatch: ['oklch(0.12 0 0)', 'oklch(0.85 0.16 195)', 'oklch(0.84 0.22 350)'],
  },
] as const

export const THEME_STORAGE_KEY = 'brogram:theme'

/**
 * §8.2 (critic addendum): the empty-storage accessibility seed. Runs as a
 * plain function so it reads like real code (and can be unit-tested by
 * calling it directly), then is serialized via `.toString()` into an inline
 * `<script>` in `layout.tsx` -- the same trick `next-themes` itself uses
 * internally for its own pre-hydration script. It must run and finish
 * *before* that script (next-themes only ever reads storage-or-default; it
 * has no hook for a first-run accessibility fallback), which is why
 * `layout.tsx` renders this script before `<Providers>`.
 *
 * Only acts when storage is empty -- an explicit choice is never
 * overridden, and `enableSystem` stays `false` on the provider: this seeds
 * the *stored* value once, it does not make the app follow the OS ongoing.
 */
export function seedInitialTheme(storageKey: string): void {
  try {
    if (window.localStorage.getItem(storageKey)) return
    let next = 'midnight'
    if (window.matchMedia('(prefers-contrast: more)').matches) next = 'arcade'
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) next = 'paper'
    window.localStorage.setItem(storageKey, next)
  } catch {
    // No storage access (locked-down browser, disabled cookies): next-themes'
    // own script falls back to `defaultTheme="midnight"` either way.
  }
}

/** Serialized for the inline pre-hydration `<script>` in `layout.tsx`. */
export const THEME_SEED_SCRIPT = `(${seedInitialTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)})`
