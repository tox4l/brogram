import { act, cleanup, render, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DUR, STAGGER } from '@/lib/motion/tokens'

// Model: src/components/rewards/rewards.test.tsx -- a partial `gsap` mock
// keeping everything else real so gsap's own plugin registration (run
// inside `loadGsap()`, W4FIX-B) still works; only the tween-creating calls
// this suite needs to assert against become spies.
const gsapMocks = vi.hoisted(() => ({
  to: vi.fn(),
  set: vi.fn(),
  from: vi.fn(),
  fromTo: vi.fn(),
  killTweensOf: vi.fn(),
}))

vi.mock('gsap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gsap')>()
  return {
    ...actual,
    gsap: { ...actual.gsap, to: gsapMocks.to, set: gsapMocks.set, from: gsapMocks.from, fromTo: gsapMocks.fromTo, killTweensOf: gsapMocks.killTweensOf },
  }
})

// jsdom has no layout, so SplitText -- which measures real line boxes -- is
// mocked and asserted on call shape only (research lane, "Testing").
const splitTextMocks = vi.hoisted(() => ({
  create: vi.fn(),
  revert: vi.fn(),
}))

vi.mock('gsap/SplitText', () => ({
  SplitText: { create: splitTextMocks.create },
}))

beforeEach(() => {
  splitTextMocks.create.mockReset()
  splitTextMocks.revert.mockReset()
  splitTextMocks.create.mockImplementation(() => ({ revert: splitTextMocks.revert, lines: [], words: [], chars: [] }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// W4FIX-B: gsap now loads lazily, from inside Reveal's own effect
// (`loadGsap()`, `src/lib/motion/eases.ts`), instead of being registered
// synchronously via `useGSAP` at module scope. Every assertion that used to
// read straight off `splitTextMocks`/`gsapMocks` right after `render(...)`
// now waits for that load to resolve first, via testing-library's
// `waitFor` -- the component's own `.then()` fires once the cached
// `loadGsap()` promise resolves, which is not synchronous with mount.

describe('Reveal', () => {
  it('under reduced motion never calls SplitText.create or any gsap tween method, and textContent is unchanged', async () => {
    const { Reveal } = await import('./Reveal')
    const { container } = render(<Reveal mode="lines" reduced>Hold focus.</Reveal>)
    // Give any stray microtask a chance to run before asserting the negative
    // -- if the component wrongly called loadGsap() under reduced motion,
    // this is enough ticks for its .then() to have fired.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(splitTextMocks.create).not.toHaveBeenCalled()
    expect(gsapMocks.from).not.toHaveBeenCalled()
    expect(gsapMocks.fromTo).not.toHaveBeenCalled()
    expect(gsapMocks.killTweensOf).not.toHaveBeenCalled()
    expect(container.textContent).toBe('Hold focus.')
  })

  it('under reduced motion, mode="fade" does not tween either', async () => {
    const { Reveal } = await import('./Reveal')
    render(<Reveal mode="fade" reduced>Hold focus.</Reveal>)
    await act(async () => {
      await Promise.resolve()
    })
    expect(gsapMocks.fromTo).not.toHaveBeenCalled()
  })

  it('mode="lines", not reduced: resolves the loader, then splits with mask lines, aria auto, autoSplit, and renders the same text', async () => {
    const { Reveal } = await import('./Reveal')
    const { container } = render(<Reveal mode="lines" reduced={false}>Two lines of hook copy.</Reveal>)
    await waitFor(() => expect(splitTextMocks.create).toHaveBeenCalledTimes(1))
    const [target, vars] = splitTextMocks.create.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(target).toBeInstanceOf(HTMLElement)
    expect(vars).toMatchObject({ type: 'lines', mask: 'lines', aria: 'auto', autoSplit: true })
    expect(typeof vars.onSplit).toBe('function')
    expect(container.textContent).toBe('Two lines of hook copy.')
  })

  it('mode="words" passes type: "words" to SplitText.create once the loader resolves', async () => {
    const { Reveal } = await import('./Reveal')
    render(<Reveal mode="words" reduced={false}>Course title</Reveal>)
    await waitFor(() => expect(splitTextMocks.create).toHaveBeenCalledTimes(1))
    const [, vars] = splitTextMocks.create.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(vars.type).toBe('words')
  })

  it('the "lines" onSplit tween uses the enter ease, DUR.slow, and yPercent 110 -> 0 (no opacity change)', async () => {
    const { Reveal } = await import('./Reveal')
    render(<Reveal mode="lines" reduced={false}>One. Two. Three.</Reveal>)
    await waitFor(() => expect(splitTextMocks.create).toHaveBeenCalledTimes(1))
    const [, vars] = splitTextMocks.create.mock.calls[0] as [HTMLElement, { onSplit: (self: unknown) => unknown }]
    const fakeLines = [{}, {}, {}]
    vars.onSplit({ lines: fakeLines, words: [], chars: [] })

    expect(gsapMocks.from).toHaveBeenCalledTimes(1)
    const [targets, tweenVars] = gsapMocks.from.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(targets).toBe(fakeLines)
    expect(tweenVars).not.toHaveProperty('opacity')
    expect(tweenVars).toMatchObject({ yPercent: 110, duration: DUR.slow / 1000, ease: 'enter' })
  })

  it('the "words" onSplit tween carries opacity + yPercent at DUR.base with the enter ease', async () => {
    const { Reveal } = await import('./Reveal')
    render(<Reveal mode="words" reduced={false}>Course title</Reveal>)
    await waitFor(() => expect(splitTextMocks.create).toHaveBeenCalledTimes(1))
    const [, vars] = splitTextMocks.create.mock.calls[0] as [HTMLElement, { onSplit: (self: unknown) => unknown }]
    const fakeWords = [{}, {}]
    vars.onSplit({ lines: [], words: fakeWords, chars: [] })

    const [targets, tweenVars] = gsapMocks.from.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(targets).toBe(fakeWords)
    expect(tweenVars).toMatchObject({ opacity: 0, duration: DUR.base / 1000, ease: 'enter' })
  })

  it('caps the stagger so a long split never exceeds the 300ms total (W4 §5.1 ration)', async () => {
    const { Reveal } = await import('./Reveal')
    render(<Reveal mode="words" reduced={false}>Course title</Reveal>)
    await waitFor(() => expect(splitTextMocks.create).toHaveBeenCalledTimes(1))
    const [, vars] = splitTextMocks.create.mock.calls[0] as [HTMLElement, { onSplit: (self: unknown) => unknown }]
    const manyWords = Array.from({ length: 20 }, () => ({}))
    vars.onSplit({ lines: [], words: manyWords, chars: [] })

    const [, tweenVars] = gsapMocks.from.mock.calls[0] as [unknown, { stagger: number }]
    expect(tweenVars.stagger).toBeLessThanOrEqual(STAGGER.max / 1000 / manyWords.length)
    expect(tweenVars.stagger * manyWords.length).toBeLessThanOrEqual(STAGGER.max / 1000 + 1e-9)
  })

  it('mode="chars" throws without a licensed surface (W4.14)', async () => {
    const { Reveal } = await import('./Reveal')
    expect(() => render(<Reveal mode="chars" reduced={false}>Hey.</Reveal>)).toThrow(/onboarding-hook|level-up/)
  })

  it('mode="chars" is allowed on the onboarding-hook surface', async () => {
    const { Reveal } = await import('./Reveal')
    expect(() =>
      render(
        <Reveal mode="chars" reduced={false} surface="onboarding-hook">
          Hey.
        </Reveal>,
      ),
    ).not.toThrow()
    await waitFor(() => expect(splitTextMocks.create).toHaveBeenCalledTimes(1))
    const [, vars] = splitTextMocks.create.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(vars.type).toBe('chars')
  })

  it('I2: the initial (server) markup ships hidden -- pending + visibility:hidden -- when not reduced, and skips both entirely under reduced motion', async () => {
    const { Reveal } = await import('./Reveal')
    const markup = renderToStaticMarkup(<Reveal mode="lines" reduced={false}>Hold focus.</Reveal>)
    expect(markup).toContain('data-reveal="pending"')
    expect(markup).toMatch(/visibility:\s*hidden/)

    const reducedMarkup = renderToStaticMarkup(
      <Reveal mode="lines" reduced>
        Hold focus.
      </Reveal>,
    )
    expect(reducedMarkup).not.toContain('data-reveal')
    expect(reducedMarkup).not.toMatch(/visibility:\s*hidden/)
  })

  it('I2: clears data-reveal and the hidden inline style on mount, in both the motion-on and reduced branches -- synchronously, before the gsap load resolves', async () => {
    const { Reveal } = await import('./Reveal')

    const { container } = render(<Reveal mode="lines" reduced={false}>Hold focus.</Reveal>)
    const span = container.querySelector('span') as HTMLSpanElement
    expect(span.hasAttribute('data-reveal')).toBe(false)
    expect(span.style.visibility).not.toBe('hidden')
    cleanup()

    const { container: reducedContainer } = render(
      <Reveal mode="lines" reduced>
        Hold focus.
      </Reveal>,
    )
    const reducedSpan = reducedContainer.querySelector('span') as HTMLSpanElement
    expect(reducedSpan.hasAttribute('data-reveal')).toBe(false)
    expect(reducedSpan.style.visibility).not.toBe('hidden')
  })

  it('mode="chars" is allowed on the level-up surface', async () => {
    const { Reveal } = await import('./Reveal')
    expect(() =>
      render(
        <Reveal mode="chars" reduced={false} surface="level-up">
          Level 6.
        </Reveal>,
      ),
    ).not.toThrow()
  })

  // W4FIX-B acceptance: "a test per surface that resolves the loader and
  // asserts the animation runs; and one that asserts nothing loads under
  // reduced motion" (the reduced-motion half is covered by the first two
  // tests above; this is the "resolves and animates" half for Reveal).
  it('W4FIX-B: once the lazy loader resolves, mode="fade" actually tweens the element (not reduced)', async () => {
    const { Reveal } = await import('./Reveal')
    const { container } = render(<Reveal mode="fade" reduced={false}>Loaded.</Reveal>)
    await waitFor(() => expect(gsapMocks.fromTo).toHaveBeenCalledTimes(1))
    const [target, from, to] = gsapMocks.fromTo.mock.calls[0] as [HTMLElement, Record<string, unknown>, Record<string, unknown>]
    expect(target).toBe(container.querySelector('span'))
    expect(from).toMatchObject({ opacity: 0 })
    expect(to).toMatchObject({ opacity: 1, ease: 'enter' })
  })

  it('W4FIX-B: a burst of Reveal mounts in the same paint shares one loadGsap() call', async () => {
    const { Reveal } = await import('./Reveal')
    const { loadGsap } = await import('@/lib/motion/eases')
    render(
      <>
        <Reveal mode="fade" reduced={false}>One</Reveal>
        <Reveal mode="fade" reduced={false}>Two</Reveal>
      </>,
    )
    await waitFor(() => expect(gsapMocks.fromTo).toHaveBeenCalledTimes(2))
    // Both mounts resolve against the identical cached promise.
    expect(loadGsap()).toBe(loadGsap())
  })
})
