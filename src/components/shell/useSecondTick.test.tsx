import { act, cleanup, renderHook } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTickReady, nowOrNull, useSecondTick } from './useSecondTick'

function Probe() {
  return <span>{useSecondTick()}</span>
}

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

  it('renders a stable sentinel on the server, never a stale module-eval clock', () => {
    // No live clock exists on the server: `getServerSnapshot` must return the
    // same constant every time, not `Date.now()` frozen at module load,
    // which would drift stale on a warm server and mismatch on hydration.
    vi.setSystemTime(new Date(Date.now() + 60_000))
    const first = renderToStaticMarkup(<Probe />)
    vi.setSystemTime(new Date(Date.now() + 60_000))
    const second = renderToStaticMarkup(<Probe />)

    expect(first).toBe(second)
    expect(first).toContain('>0<')
  })
})

describe('isTickReady / nowOrNull', () => {
  it('treats the sentinel (0) as not ready', () => {
    expect(isTickReady(0)).toBe(false)
    expect(nowOrNull(0)).toBeNull()
  })

  it('treats any real tick as ready', () => {
    expect(isTickReady(1)).toBe(true)
    expect(isTickReady(1_778_000_000_000)).toBe(true)
    expect(nowOrNull(1_778_000_000_000)).toBe(1_778_000_000_000)
  })
})
