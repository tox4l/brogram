import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// W4FIX-B2 re-check (M2): nothing in the suite asserted `AppEffects` is
// actually mounted under (app) -- `(app)/providers.tsx` had no test of its
// own, and `<AppEffects />` is referenced nowhere but one line in
// `layout.tsx`. Deleting that line kept the suite fully green while the
// sound manager never armed anywhere in the app and `data-motion` lost the
// learner's stored preference on every route -- the mirror image of the
// regression W4FIX-B2 itself fixed, guarded only on the removal side.
//
// Two checks close that gap: a source scan (does `layout.tsx` still import
// and render `AppEffects`?) and a render test (does `AppEffects` itself
// still arm the sound manager and return `MotionAttribute`?).

const LAYOUT_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'layout.tsx'), 'utf8')

const soundMocks = vi.hoisted(() => ({ initSoundOnFirstGesture: vi.fn() }))
vi.mock('@/lib/sound/manager', () => ({ initSoundOnFirstGesture: soundMocks.initSoundOnFirstGesture }))

// `MotionAttribute` needs a QueryClientProvider and a Supabase client
// (its own header comment explains why) -- neither is this test's concern,
// so it is mocked to a bare marker component. What matters here is only
// that `AppEffects` renders it at all.
vi.mock('@/components/motion/MotionAttribute', () => ({
  MotionAttribute: () => <div data-testid="motion-attribute-stub" />,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('(app)/layout.tsx mounts AppEffects (M2, W4FIX-B2 re-check)', () => {
  it("imports AppEffects from './providers' and renders it", () => {
    expect(/^\s*import\s*\{[^}]*\bAppEffects\b[^}]*\}\s*from\s*['"]\.\/providers['"]/m.test(LAYOUT_SOURCE)).toBe(true)
    expect(/<AppEffects\s*\/>/.test(LAYOUT_SOURCE)).toBe(true)
  })
})

describe('AppEffects', () => {
  it('arms the sound manager on first gesture exactly once', async () => {
    const { AppEffects } = await import('./providers')
    render(<AppEffects />)
    expect(soundMocks.initSoundOnFirstGesture).toHaveBeenCalledTimes(1)
  })

  it('renders MotionAttribute', async () => {
    const { AppEffects } = await import('./providers')
    const { getByTestId } = render(<AppEffects />)
    expect(getByTestId('motion-attribute-stub')).toBeTruthy()
  })
})
