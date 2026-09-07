import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DUR } from '@/lib/motion/tokens'
import { useFlipIndicator } from './useFlipIndicator'

const gsapMocks = vi.hoisted(() => ({
  to: vi.fn(),
  set: vi.fn(),
  fromTo: vi.fn(),
  killTweensOf: vi.fn(),
}))

vi.mock('gsap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gsap')>()
  return { ...actual, gsap: { ...actual.gsap, to: gsapMocks.to, set: gsapMocks.set, fromTo: gsapMocks.fromTo, killTweensOf: gsapMocks.killTweensOf } }
})

// jsdom has no layout, so Flip -- which measures real rects -- is mocked
// and asserted on call shape only (research lane, "Testing").
const flipMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  from: vi.fn(),
}))

vi.mock('gsap/Flip', () => ({
  Flip: { getState: flipMocks.getState, from: flipMocks.from },
}))

function setRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  Object.defineProperty(el, 'offsetLeft', { value: rect.left, configurable: true })
  Object.defineProperty(el, 'offsetTop', { value: rect.top, configurable: true })
  Object.defineProperty(el, 'offsetWidth', { value: rect.width, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: rect.height, configurable: true })
}

// I4: the indicator itself sits at a non-zero flow position (left: 4, top:
// 2 -- e.g. `absolute inset-y-1 left-1` inside a `p-1` container, the real
// LaneSwitch shape) so a test that only ever gave the indicator offset 0
// could not catch x/y computed as the target's ABSOLUTE offset instead of
// the delta from the indicator's own offset.
const INDICATOR_RECT = { left: 4, top: 2, width: 40, height: 24 }
// Target "a" sits at the same position as the indicator's resting spot
// (delta 0,0); target "b" sits further along the row.
const TARGET_A = { left: 4, top: 2, width: 40, height: 24 }
const TARGET_B = { left: 64, top: 2, width: 40, height: 24 }

// Matches real usage: the component that owns the container ref calls the
// hook itself (never a child component reading the ref as a prop) -- on
// initial mount, React attaches a host node's own ref only after its
// descendants' layout effects have already run, so a hook called from a
// *child* of the ref'd node would see `container.current` still null.
function Harness({ activeKey, reduced }: { activeKey: string; reduced: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFlipIndicator(containerRef, activeKey, reduced)
  return (
    <div ref={containerRef}>
      <div
        data-flip-key="a"
        ref={(el) => {
          if (el) setRect(el, TARGET_A)
        }}
      />
      <div
        data-flip-key="b"
        ref={(el) => {
          if (el) setRect(el, TARGET_B)
        }}
      />
      <div
        data-flip-indicator
        ref={(el) => {
          if (el) setRect(el, INDICATOR_RECT)
        }}
      />
    </div>
  )
}

beforeEach(() => {
  flipMocks.getState.mockReset()
  flipMocks.from.mockReset()
  flipMocks.getState.mockReturnValue({ id: 'fake-flip-state' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useFlipIndicator', () => {
  it('I4: computes x/y as the delta from the indicator\'s own offset, not the target\'s absolute offset', () => {
    // Target "b" is at left 64; the indicator's own resting left is 4 --
    // the correct translate is 60, not 64.
    render(<Harness activeKey="b" reduced />)
    const [, vars] = gsapMocks.set.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(vars).toMatchObject({ x: 60, y: 0, width: 40, height: 24 })
  })

  it('I3: on first mount, positions with one gsap.set and never calls Flip.from, killTweensOf or Flip.getState -- even with motion on', () => {
    render(<Harness activeKey="b" reduced={false} />)
    expect(gsapMocks.set).toHaveBeenCalledTimes(1)
    expect(flipMocks.getState).not.toHaveBeenCalled()
    expect(flipMocks.from).not.toHaveBeenCalled()
    expect(gsapMocks.killTweensOf).not.toHaveBeenCalled()
    const [target, vars] = gsapMocks.set.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(target.hasAttribute('data-flip-indicator')).toBe(true)
    expect(vars).toMatchObject({ x: 60, y: 0, width: 40, height: 24 })
  })

  it('I3: a rerender with a new activeKey (no longer the first run) calls Flip.from with duration DUR.guide/1000, ease "move", scale and absolute', () => {
    const { rerender } = render(<Harness activeKey="a" reduced={false} />)
    gsapMocks.set.mockClear()

    rerender(<Harness activeKey="b" reduced={false} />)

    expect(flipMocks.getState).toHaveBeenCalledTimes(1)
    expect(gsapMocks.set).toHaveBeenCalledTimes(1)
    const [, setVars] = gsapMocks.set.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(setVars).toMatchObject({ x: 60, y: 0, width: 40, height: 24 })

    expect(flipMocks.from).toHaveBeenCalledTimes(1)
    const [state, vars] = flipMocks.from.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(state).toEqual({ id: 'fake-flip-state' })
    expect(vars).toMatchObject({ duration: DUR.guide / 1000, ease: 'move', scale: true, absolute: true })
  })

  it('under reduced motion, positions with one gsap.set and never calls Flip.from, on mount or on a later rerender', () => {
    const { rerender } = render(<Harness activeKey="a" reduced />)
    expect(flipMocks.from).not.toHaveBeenCalled()
    expect(gsapMocks.set).toHaveBeenCalledTimes(1)
    const [target, vars] = gsapMocks.set.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(target.hasAttribute('data-flip-indicator')).toBe(true)
    expect(vars).toMatchObject({ x: 0, y: 0, width: 40, height: 24 })

    rerender(<Harness activeKey="b" reduced />)
    expect(flipMocks.from).not.toHaveBeenCalled()
    expect(gsapMocks.set).toHaveBeenCalledTimes(2)
  })

  it('kills any tween on the indicator before starting a new Flip (on a rerender, not the first run)', () => {
    const { rerender } = render(<Harness activeKey="a" reduced={false} />)
    expect(gsapMocks.killTweensOf).not.toHaveBeenCalled()

    rerender(<Harness activeKey="b" reduced={false} />)
    expect(gsapMocks.killTweensOf).toHaveBeenCalledTimes(1)
    const [target] = gsapMocks.killTweensOf.mock.calls[0] as [HTMLElement]
    expect(target.hasAttribute('data-flip-indicator')).toBe(true)
  })

  it('with no matching data-flip-key element, does nothing', () => {
    render(<Harness activeKey="does-not-exist" reduced={false} />)
    expect(flipMocks.getState).not.toHaveBeenCalled()
    expect(flipMocks.from).not.toHaveBeenCalled()
    expect(gsapMocks.set).not.toHaveBeenCalled()
  })
})
