import type { ThemeName } from '@/lib/contracts'

/**
 * The five personalities on next-themes' one axis (wave 4 §2.1). Order here
 * is the order they render in `ThemeQuickSwitch` and the Account picker.
 * Swatch triples are [background, primary, accent] -- copied by hand from
 * `globals.css`'s `oklch(...)` values.
 *
 * I5 (review): these literals are pinned against the real tokens by a
 * dedicated assertion in `contrast.test.ts` ("swatches stay pinned to the
 * real tokens"), which parses `globals.css` and compares. That assertion,
 * not the key-set-parity check (a different, unrelated guarantee -- it only
 * confirms the five `[data-theme]` blocks define the same property
 * *names*), is what keeps a palette retune from silently leaving a stale
 * dot in the picker.
 *
 * Ruling W4.1: the `paper` id never changes -- `wellness.prefs.theme` and
 * `localStorage['brogram:theme']` persist it, and `resolveWellnessPrefs`
 * falls back to `midnight` on an id it does not recognise, so a rename
 * would silently reset a stored preference. Only its label moves, to
 * "Folio". Eclipse is new and opt-in; Midnight stays seeded.
 */
export const THEMES: readonly { id: ThemeName; name: string; blurb: string; swatch: [string, string, string] }[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Cool graphite, one indigo through button and ring. The room you already work in at 2am, tidier.',
    swatch: ['oklch(0.16 0.014 260)', 'oklch(0.78 0.11 264)', 'oklch(0.74 0.12 200)'],
  },
  {
    id: 'amber',
    name: 'Amber',
    blurb: 'The only warm dark. A lamp on a desk.',
    swatch: ['oklch(0.17 0.02 55)', 'oklch(0.78 0.148 55)', 'oklch(0.80 0.115 35)'],
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    blurb: 'Almost black, almost colourless, until one violet lights the thing you must look at.',
    swatch: ['oklch(0.09 0.008 285)', 'oklch(0.80 0.126 305)', 'oklch(0.84 0.06 300)'],
  },
  {
    id: 'paper',
    name: 'Folio',
    blurb: 'Warm white ground, ink text, one indigo mark. A printed listing.',
    swatch: ['oklch(0.972 0.006 85)', 'oklch(0.40 0.12 275)', 'oklch(0.92 0.03 275)'],
  },
  {
    id: 'arcade',
    name: 'Arcade',
    blurb: 'Pure black, cyan and magenta at full volume. Loud on purpose, easiest of the five to read.',
    swatch: ['oklch(0.12 0 0)', 'oklch(0.85 0.13 195)', 'oklch(0.84 0.10 350)'],
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
