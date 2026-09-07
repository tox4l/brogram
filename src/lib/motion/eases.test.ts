import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EASE } from './tokens'
import { loadGsap, registerEases } from './eases'

// Spec: docs/superpowers/specs/2026-09-07-brogram-wave4-premium.md §5.1
// "GSAP cannot read a CSS cubic-bezier() string" -- registerEases() creates
// one CustomEase per EASE token so a GSAP tween and a CSS transition on the
// same named motion read the identical curve.
//
// W4FIX-B: `registerEases`/`loadGsap` now dynamic-import gsap instead of
// importing it at this test file's top level too -- these tests import
// `gsap` themselves (fine: a test file is never bundled into the app) only
// to read back what the lazy loader registered, via the resolved `gsap`
// instance `loadGsap()` itself hands back (Node's module cache means a
// dynamic `import('gsap')` and this file's own `await import('gsap')`
// resolve to the identical singleton, so registration is visible either way).

describe('registerEases / loadGsap', () => {
  it("registers 'enter' so gsap.parseEase matches the CSS cubic-bezier(0.22, 1, 0.36, 1) curve at t=0.25 within 0.001", async () => {
    const { gsap } = await registerEases()
    const fn = gsap.parseEase('enter')
    expect(Math.abs(fn(0.25) - 0.765)).toBeLessThan(0.001)
  })

  it('registers all four EASE tokens as callable GSAP eases', async () => {
    const { gsap } = await loadGsap()
    for (const name of Object.keys(EASE)) {
      const fn = gsap.parseEase(name)
      expect(typeof fn).toBe('function')
      // Every curve here decelerates into its endpoint (never an ease-in):
      // t=0 must map to (approximately) 0 and t=1 to (approximately) 1.
      expect(fn(0)).toBeCloseTo(0, 1)
      expect(fn(1)).toBeCloseTo(1, 1)
    }
  })

  it('is idempotent -- calling it twice does not throw, and returns the same gsap instance', async () => {
    const first = await loadGsap()
    const second = await loadGsap()
    expect(first.gsap).toBe(second.gsap)
  })

  it('caches the load -- concurrent callers share one promise', () => {
    expect(loadGsap()).toBe(loadGsap())
  })
})

// Ruling W4.13: "no raw GSAP ease name outside src/lib/motion/. Every
// `ease:` in the app is 'enter' | 'move' | 'drawer' | 'standard'." Enforced
// here as a source scan rather than by touching every offending file --
// this task (T4.2) owns only src/lib/motion/** and src/components/motion/**;
// every allowlist entry below names the task that owns (and must clear) it.
describe('ease name discipline (W4.13)', () => {
  const ROOT = path.resolve(__dirname, '..', '..', '..')
  const SRC = path.join(ROOT, 'src')
  const RAW_EASE = /ease:\s*['"](power\d?|back|elastic)/

  // Pre-existing reward/derot "juice" tweens that predate this ruling.
  // Owned by T4.8 (src/components/rewards/**, src/components/derot/**) --
  // clearing these is that task's job, not this one's.
  const ALLOWLIST = new Set(
    [
      'components/derot/RunSummary.tsx',
      'components/rewards/Celebration.tsx',
      'components/rewards/GoalRing.tsx',
      'components/rewards/LevelBadge.tsx',
      'components/rewards/Sparks.tsx',
      'components/rewards/StreakFlame.tsx',
      'components/rewards/XpCounter.tsx',
    ].map((p) => path.normalize(p)),
  )

  const EXCLUDED_DIRS = new Set(['lib/motion', 'components/motion', 'app/preview'])

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(SRC, full)
      if (entry.isDirectory()) {
        if ([...EXCLUDED_DIRS].some((excluded) => rel === path.normalize(excluded))) continue
        walk(full, out)
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        out.push(full)
      }
    }
    return out
  }

  it('finds no raw power/back/elastic ease outside src/lib/motion/, except the T4.8 allowlist', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      const relToSrc = path.normalize(path.relative(SRC, file))
      if (ALLOWLIST.has(relToSrc)) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (RAW_EASE.test(line)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
