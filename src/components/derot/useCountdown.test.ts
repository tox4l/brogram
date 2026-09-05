import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCountdown } from './useCountdown'

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at 100 percent remaining', () => {
    const { result } = renderHook(() => useCountdown({ timeLimitS: 30, now: Date.now }))
    expect(result.current.percentRemaining).toBe(100)
    expect(result.current.remainingMs).toBe(30000)
    expect(result.current.expired).toBe(false)
  })

  it('counts down as time passes', () => {
    let t = 0
    const now = () => t
    const { result } = renderHook(() => useCountdown({ timeLimitS: 10, now }))

    t = 5000
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.remainingMs).toBe(5000)
    expect(result.current.percentRemaining).toBe(50)
  })

  it('calls onExpire exactly once when the limit is reached, even if timers keep advancing', () => {
    let t = 0
    const now = () => t
    const onExpire = vi.fn()
    renderHook(() => useCountdown({ timeLimitS: 10, now, onExpire }))

    t = 10000
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(onExpire).toHaveBeenCalledTimes(1)

    t = 20000
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('reports expired and clamps remainingMs at 0 past the limit', () => {
    let t = 0
    const now = () => t
    const { result } = renderHook(() => useCountdown({ timeLimitS: 5, now }))

    t = 8000
    act(() => {
      vi.advanceTimersByTime(8000)
    })

    expect(result.current.remainingMs).toBe(0)
    expect(result.current.percentRemaining).toBe(0)
    expect(result.current.expired).toBe(true)
  })

  it('does not tick or expire while inactive', () => {
    let t = 0
    const now = () => t
    const onExpire = vi.fn()
    const { result } = renderHook(({ active }) => useCountdown({ timeLimitS: 5, now, active, onExpire }), {
      initialProps: { active: false },
    })

    t = 10000
    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(onExpire).not.toHaveBeenCalled()
    expect(result.current.remainingMs).toBe(5000)
  })

  it('exposes getElapsedMs computed fresh from the injected clock', () => {
    let t = 1000
    const now = () => t
    const { result } = renderHook(() => useCountdown({ timeLimitS: 30, now }))

    t = 1000 + 4321
    expect(result.current.getElapsedMs()).toBe(4321)
  })
})
