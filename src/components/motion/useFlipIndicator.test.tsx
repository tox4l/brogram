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
          if (el) setRect(el, { left: 0, top: 0, width: 40, height: 24 })
        }}
      />
      <div
        data-flip-key="b"
        ref={(el) => {
          if (el) setRect(el, { left: 60, top: 0, width: 40, height: 24 })
        }}
      />
      <div data-flip-indicator />
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
  it('under reduced motion, positions with one gsap.set and never calls Flip.from', () => {
    render(<Harness activeKey="a" reduced />)
    expect(flipMocks.from).not.toHaveBeenCalled()
    expect(gsapMocks.set).toHaveBeenCalledTimes(1)
    const [target, vars] = gsapMocks.set.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(target.hasAttribute('data-flip-indicator')).toBe(true)
    expect(vars).toMatchObject({ x: 0, y: 0, width: 40, height: 24 })
  })

  it('with motion on, captures Flip.getState before repositioning, then calls Flip.from with duration DUR.guide/1000, ease "move", scale and absolute', () => {
    render(<Harness activeKey="b" reduced={false} />)
    expect(flipMocks.getState).toHaveBeenCalledTimes(1)
    expect(gsapMocks.set).toHaveBeenCalledTimes(1)
    const [, setVars] = gsapMocks.set.mock.calls[0] as [HTMLElement, Record<string, unknown>]
    expect(setVars).toMatchObject({ x: 60, y: 0, width: 40, height: 24 })

    expect(flipMocks.from).toHaveBeenCalledTimes(1)
    const [state, vars] = flipMocks.from.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(state).toEqual({ id: 'fake-flip-state' })
    expect(vars).toMatchObject({ duration: DUR.guide / 1000, ease: 'move', scale: true, absolute: true })
  })

  it('kills any tween on the indicator before starting a new Flip', () => {
    render(<Harness activeKey="a" reduced={false} />)
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
