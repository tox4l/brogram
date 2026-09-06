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

describe('useReducedMotion', () => {
  it('reads the initial OS signal', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it('re-renders when the media query changes', () => {
    const mql = installMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => mql.set(true))
    expect(result.current).toBe(true)

    act(() => mql.set(false))
    expect(result.current).toBe(false)
  })
})
