import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { clearReminderBadge, resetReminderBadgeForTests, setReminderPending, useReminderBadge } from './reminderBadge'

afterEach(() => {
  cleanup()
  resetReminderBadgeForTests()
})

describe('reminderBadge', () => {
  it('starts with no badge', () => {
    const { result } = renderHook(() => useReminderBadge())
    expect(result.current).toBe(false)
  })

  it('shows a badge once any source reports pending', () => {
    const { result } = renderHook(() => useReminderBadge())
    act(() => setReminderPending('wellness', true))
    expect(result.current).toBe(true)
  })

  it('stays true while at least one source is still pending', () => {
    const { result } = renderHook(() => useReminderBadge())
    act(() => {
      setReminderPending('prayer', true)
      setReminderPending('pomodoro', true)
    })
    act(() => setReminderPending('prayer', false))
    expect(result.current).toBe(true)
    act(() => setReminderPending('pomodoro', false))
    expect(result.current).toBe(false)
  })

  it('clearReminderBadge resets every source at once (acknowledgement)', () => {
    const { result } = renderHook(() => useReminderBadge())
    act(() => {
      setReminderPending('prayer', true)
      setReminderPending('wellness', true)
      setReminderPending('pomodoro', true)
    })
    expect(result.current).toBe(true)
    act(() => clearReminderBadge())
    expect(result.current).toBe(false)
  })

  it('notifies every subscriber', () => {
    const a = renderHook(() => useReminderBadge())
    const b = renderHook(() => useReminderBadge())
    act(() => setReminderPending('prayer', true))
    expect(a.result.current).toBe(true)
    expect(b.result.current).toBe(true)
  })
})
