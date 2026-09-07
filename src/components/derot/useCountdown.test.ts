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

  it('freezes remaining time while inactive and resumes from where it left off, excluding the paused span (fix round 2, N1)', () => {
    let t = 0
    const now = () => t
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => useCountdown({ timeLimitS: 60, now, active }), {
      initialProps: { active: true },
    })

    t = 10000
    act(() => { vi.advanceTimersByTime(10000) })
    expect(result.current.remainingMs).toBe(50000)

    // Hide for twelve seconds mid-item.
    rerender({ active: false })
    t = 22000
    act(() => { vi.advanceTimersByTime(12000) })
    expect(result.current.remainingMs).toBe(50000) // frozen -- no time passes while paused
    expect(result.current.getElapsedMs()).toBe(10000)

    // Resume: the countdown picks up exactly where it left off, not from the full wall-clock gap.
    rerender({ active: true })
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current.remainingMs).toBe(50000)
    expect(result.current.getElapsedMs()).toBe(10000)

    t = 27000
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.getElapsedMs()).toBe(15000) // 10s before the pause + 5s after resume
    expect(result.current.remainingMs).toBe(45000)
  })

  it('does not auto-expire the instant it resumes, even after a pause that exceeded the time limit in wall-clock terms', () => {
    let t = 0
    const now = () => t
    const onExpire = vi.fn()
    const { rerender } = renderHook(({ active }: { active: boolean }) => useCountdown({ timeLimitS: 10, now, active, onExpire }), {
      initialProps: { active: true },
    })

    t = 2000
    act(() => { vi.advanceTimersByTime(2000) }) // 2s of active time

    rerender({ active: false })
    t = 20000 // 18 real seconds pass while paused -- more than the whole 10s limit
    act(() => { vi.advanceTimersByTime(18000) })
    expect(onExpire).not.toHaveBeenCalled()

    rerender({ active: true })
    act(() => { vi.advanceTimersByTime(0) })
    expect(onExpire).not.toHaveBeenCalled() // only 2s of active time has elapsed, well under the 10s limit
  })

  it('passes the elapsed active time to onExpire, excluding any earlier paused span', () => {
    let t = 0
    const now = () => t
    const onExpire = vi.fn()
    const { rerender } = renderHook(({ active }: { active: boolean }) => useCountdown({ timeLimitS: 10, now, active, onExpire }), {
      initialProps: { active: true },
    })

    t = 3000
    act(() => { vi.advanceTimersByTime(3000) }) // 3s active

    rerender({ active: false })
    t = 50000 // a long pause -- must not count toward elapsed
    act(() => { vi.advanceTimersByTime(47000) })

    rerender({ active: true })
    t = 50000 + 7000 // 7 more active seconds -- 3 + 7 = 10s, right at the limit
    act(() => { vi.advanceTimersByTime(7000) })

    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith(10000)
  })
})
