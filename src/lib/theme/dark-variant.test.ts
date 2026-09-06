// C1 (review of commit 31e2e30): deleting `@custom-variant dark
// (&:is(.dark *));` without also stripping every `dark:` utility left the
// shadcn primitives (button, badge, input, tabs) falling back to Tailwind
// 4's *default* `dark` variant -- `@media (prefers-color-scheme: dark)`.
// A Paper user on a dark OS (or a Midnight user on a light OS) got a
// half-themed component set decided by the OS, not by `data-theme`, and
// `contrast.test.ts` could not see it: it only ever parses `globals.css`
// source text, never the compiled CSS, and the `dark:` utilities live in
// `.tsx` files it never reads.
//
// This is the "or that `globals.css` declares `@custom-variant dark` for as
// long as `dark:` matches anywhere under `src/`" guard the review names as
// an acceptable alternative to compiling the real stylesheet: it scans the
// actual source tree for `dark:` usage (so it stays true if new components
// pick up the pattern, and would fail loudly if every last one were
// removed and this became dead weight) and asserts the variant is bound to
// the theme attribute, never to `.dark` or left undefined.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const GLOBALS_CSS_PATH = join(SRC_DIR, 'app', 'globals.css')
const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')

const SKIP_DIRS = new Set(['node_modules', '.next'])

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(name.name)) continue
    const full = join(dir, name.name)
    if (name.isDirectory()) walk(full, out)
    else if (/\.(tsx?|css)$/.test(name.name)) out.push(full)
  }
}

function findDarkUtilityUsages(): { file: string; sample: string }[] {
  const files: string[] = []
  walk(SRC_DIR, files)
  const hits: { file: string; sample: string }[] = []
  const usageRe = /\bdark:[\w[\]/:.%-]+/
  for (const file of files) {
    if (file === GLOBALS_CSS_PATH) continue
    const text = readFileSync(file, 'utf8')
    const match = usageRe.exec(text)
    if (match) hits.push({ file, sample: match[0] })
  }
  return hits
}

describe('C1: the `dark:` variant follows the active theme, not the OS', () => {
  it('at least one component under src/ still uses a `dark:` utility (sanity: this guard is testing something real)', () => {
    const hits = findDarkUtilityUsages()
    expect(hits.length, 'no `dark:` utility found anywhere under src/ -- if that is intentional, this guard can be retired').toBeGreaterThan(0)
  })

  it('globals.css declares @custom-variant dark, bound to the dark themes by attribute', () => {
    const match = /@custom-variant\s+dark\s*\(([^;]*)\);/.exec(css)
    expect(match, 'no @custom-variant dark declaration found in globals.css -- every `dark:` utility now falls back to Tailwind\'s default @media (prefers-color-scheme: dark)').not.toBeNull()

    const body = match![1]
    expect(body).toContain('[data-theme="midnight"]')
    expect(body).toContain('[data-theme="amber"]')
    expect(body).toContain('[data-theme="arcade"]')
    // Paper is the one light theme -- `dark:` utilities must never match it.
    expect(body).not.toContain('[data-theme="paper"]')
    // The old binary must not have crept back in alongside the new one.
    expect(body).not.toMatch(/\.dark\b/)
  })
})
