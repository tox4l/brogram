import { describe, expect, it } from 'vitest'
import { DUR, EASE, SPRING, STAGGER } from './tokens'

// Spec: docs/superpowers/specs/2026-09-06-brogram-v2-bro.md
// §8.6 "Motion tokens" pins exact values for instant/fast/base/slow and a
// 600-900ms band for celebration. The prose timing law a few lines above it
// (§7.7 area, "Timing law, applied everywhere and checked in review") gives
// the wider per-purpose bands each named tier must still sit inside.
const SPEC_BANDS: Record<keyof typeof DUR, [number, number]> = {
  instant: [100, 160], // "button press 100-160ms"
  fast: [125, 200], // "tooltips 125-200ms"
  base: [150, 300], // covers both "dropdowns 150-250ms" and "on-screen movement 200-300ms"
  guide: [200, 300], // W4 §5.1: code guide / dock indicator / tab underline, the movement band
  slow: [200, 350], // "modals and drawers 200-350ms"
  celebration: [600, 900], // "celebrations 600-900ms and only for positive moments"
}

describe('DUR', () => {
  it.each(Object.keys(SPEC_BANDS) as (keyof typeof DUR)[])('%s sits inside its spec band', (tier) => {
    const [min, max] = SPEC_BANDS[tier]
    expect(DUR[tier]).toBeGreaterThanOrEqual(min)
    expect(DUR[tier]).toBeLessThanOrEqual(max)
  })

  it('pins the §8.6 fixed values exactly (instant/fast/base/slow)', () => {
    expect(DUR.instant).toBe(100)
    expect(DUR.fast).toBe(150)
    expect(DUR.base).toBe(200)
    expect(DUR.slow).toBe(320)
  })

  it('pins W4 §5.1: DUR.guide sits between base and slow at exactly 260ms', () => {
    expect(DUR.guide).toBe(260)
  })

  it('is strictly increasing from instant to celebration', () => {
    const values = [DUR.instant, DUR.fast, DUR.base, DUR.guide, DUR.slow, DUR.celebration]
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1])
  })
})

function parseCubicBezier(value: string): [number, number, number, number] {
  const match = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(value)
  if (!match) throw new Error(`not a cubic-bezier(): ${value}`)
  const [, x1, y1, x2, y2] = match
  return [Number(x1), Number(y1), Number(x2), Number(y2)]
}

describe('EASE', () => {
  it('pins the §8.6 curve values exactly', () => {
    expect(EASE.standard).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
    expect(EASE.enter).toBe('cubic-bezier(0.22, 1, 0.36, 1)')
    expect(EASE.move).toBe('cubic-bezier(0.25, 1, 0.5, 1)')
    expect(EASE.drawer).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
  })

  it.each(Object.entries(EASE))('%s is not an ease-in (never "Never ease-in on UI")', (_name, value) => {
    expect(value).not.toBe('ease-in')
    // The defining shape of an ease-in curve (CSS `ease-in` itself is
    // cubic-bezier(0.42, 0, 1, 1)) is that it never decelerates: its second
    // control point sits at, or essentially at, (1, 1). Every curve on this
    // token table decelerates into its endpoint instead — its second
    // control point's x is pulled well short of 1.
    const [, , x2, y2] = parseCubicBezier(value)
    expect(x2 < 0.9 || y2 < 0.9).toBe(true)
  })
})

describe('SPRING', () => {
  it('matches §8.6: a real spring, not a keyframed overshoot', () => {
    expect(SPRING).toEqual({ duration: 0.5, bounce: 0.2 })
  })
})

describe('STAGGER', () => {
  it('step sits inside the 30-50ms band and the total is capped at 300ms', () => {
    expect(STAGGER.step).toBeGreaterThanOrEqual(30)
    expect(STAGGER.step).toBeLessThanOrEqual(50)
    expect(STAGGER.max).toBe(300)
  })
})
