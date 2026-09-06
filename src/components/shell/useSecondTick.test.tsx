import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSecondTick } from './useSecondTick'

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  setHidden(false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setHidden(false)
})

describe('useSecondTick', () => {
  it('creates exactly one shared interval for three subscribers', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const a = renderHook(() => useSecondTick())
    const b = renderHook(() => useSecondTick())
    const c = renderHook(() => useSecondTick())

    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    a.unmount()
    b.unmount()
    c.unmount()
  })

  it('clears the interval only once the last subscriber unsubscribes', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
    const a = renderHook(() => useSecondTick())
    const b = renderHook(() => useSecondTick())
    const c = renderHook(() => useSecondTick())

    a.unmount()
    expect(clearIntervalSpy).not.toHaveBeenCalled()
    b.unmount()
    expect(clearIntervalSpy).not.toHaveBeenCalled()
    c.unmount()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('ticks forward once per second for a subscriber', () => {
    const { result, unmount } = renderHook(() => useSecondTick())
    const before = result.current

    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBeGreaterThan(before)

    unmount()
  })

  it('does not tick while document.hidden', () => {
    const { result, unmount } = renderHook(() => useSecondTick())
    act(() => {
      setHidden(true)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const whenHidden = result.current

    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(whenHidden)

    unmount()
  })

  it('resyncs immediately on visibilitychange when a hidden tab returns', () => {
    const { result, unmount } = renderHook(() => useSecondTick())
    act(() => {
      setHidden(true)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const whenHidden = result.current

    // Time passes while backgrounded -- no interval fires, but the clock
    // itself has moved on, and the returning tab should show that instantly.
    vi.setSystemTime(new Date(whenHidden + 5000))
    act(() => {
      setHidden(false)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(whenHidden + 5000)

    // The interval resumes for the remaining subscriber.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe(whenHidden + 6000)

    unmount()
  })
})
