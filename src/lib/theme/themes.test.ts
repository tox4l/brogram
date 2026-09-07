import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedInitialTheme, THEME_SEED_MARKER_KEY, THEME_STORAGE_KEY } from './themes'

/**
 * G2 (W2FIX-G fix round, wave 2 review section 6): `seedInitialTheme` writes
 * an OS-derived guess into the same storage key an explicit choice uses,
 * with no marker -- `useThemeSync` could not tell "the OS guessed this"
 * apart from "the learner chose this," so the very first sign-in wrote the
 * seed to `wellness.prefs.theme` as though it were a decision. These pin the
 * marker `seedInitialTheme` now writes alongside the seed itself
 * (`useThemeSync.test.tsx` pins the read side: a local theme still equal to
 * this mark never round-trips).
 */
function installMatchMedia(overrides: Partial<Record<string, boolean>> = {}) {
  window.matchMedia = ((query: string) => ({
    matches: overrides[query] ?? false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  installMatchMedia()
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('seedInitialTheme', () => {
  it('on an empty store, seeds midnight by default and marks it as a seed under the same key', () => {
    seedInitialTheme(THEME_STORAGE_KEY)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('midnight')
    expect(window.localStorage.getItem(THEME_SEED_MARKER_KEY)).toBe('midnight')
  })

  it('on a light-OS, no-contrast machine, seeds paper and marks paper as the seed', () => {
    installMatchMedia({ '(prefers-color-scheme: light)': true })
    seedInitialTheme(THEME_STORAGE_KEY)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('paper')
    expect(window.localStorage.getItem(THEME_SEED_MARKER_KEY)).toBe('paper')
  })

  it('on a high-contrast machine, seeds arcade and marks arcade as the seed', () => {
    installMatchMedia({ '(prefers-contrast: more)': true })
    seedInitialTheme(THEME_STORAGE_KEY)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('arcade')
    expect(window.localStorage.getItem(THEME_SEED_MARKER_KEY)).toBe('arcade')
  })

  it('never overwrites an existing stored value, and never touches the seed marker either', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'amber')
    seedInitialTheme(THEME_STORAGE_KEY)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('amber')
    expect(window.localStorage.getItem(THEME_SEED_MARKER_KEY)).toBeNull()
  })
})
