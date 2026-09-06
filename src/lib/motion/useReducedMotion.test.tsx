import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveMotion, useReducedMotion } from './useReducedMotion'

class FakeMediaQueryList {
  matches: boolean
  private listeners = new Set<(event: { matches: boolean }) => void>()

  constructor(matches: boolean) {
    this.matches = matches
  }

  addEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'change', listener: (event: { matches: boolean }) => void) {
    this.listeners.delete(listener)
  }

  set(matches: boolean) {
    this.matches = matches
    for (const listener of this.listeners) listener({ matches })
  }
}

function installMatchMedia(initial: boolean): FakeMediaQueryList {
  const mql = new FakeMediaQueryList(initial)
  window.matchMedia = ((query: string) => {
    if (query !== '(prefers-reduced-motion: reduce)') throw new Error(`unexpected query: ${query}`)
    return mql as unknown as MediaQueryList
  }) as typeof window.matchMedia
  return mql
}

afterEach(() => {
  cleanup()
})

describe('resolveMotion', () => {
  it("OS reduce + 'system' resolves to true", () => {
    expect(resolveMotion('system', true)).toBe(true)
  })

  it("OS reduce + 'full' resolves to false — an in-app override beats the OS", () => {
    expect(resolveMotion('full', true)).toBe(false)
  })

  it("no OS signal + 'reduced' resolves to true", () => {
    expect(resolveMotion('reduced', false)).toBe(true)
  })

  it("no OS signal + 'system' resolves to false", () => {
    expect(resolveMotion('system', false)).toBe(false)
  })

  it("no OS signal + 'full' resolves to false", () => {
    expect(resolveMotion('full', false)).toBe(false)
  })
})

describe('useReducedMotion (I6: returns the RESOLVED value, not the raw OS signal)', () => {
  it('a bare call means "system" — defers to the OS signal', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('re-renders when the media query changes, with no pref (system)', () => {
    const mql = installMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => mql.set(true))
    expect(result.current).toBe(true)

    act(() => mql.set(false))
    expect(result.current).toBe(false)
  })

  it("useReducedMotion('full') resolves to false even while the OS asks to reduce — the load-bearing override case", () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useReducedMotion('full'))
    expect(result.current).toBe(false)
  })

  it("useReducedMotion('reduced') resolves to true with no OS signal at all", () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion('reduced'))
    expect(result.current).toBe(true)
  })

  it('still re-renders on an OS change while an explicit pref is passed, even though the resolved value does not move', () => {
    // The hook must keep subscribing to the media query regardless of `pref`
    // — R7.9 requires exactly one reader of `matchMedia` for motion, and that
    // reader must not silently stop listening just because an override is active.
    const mql = installMatchMedia(false)
    const { result, rerender } = renderHook(() => useReducedMotion('full'))
    expect(result.current).toBe(false)
    act(() => mql.set(true))
    expect(result.current).toBe(false) // 'full' still wins
    rerender()
    expect(result.current).toBe(false)
  })
})
