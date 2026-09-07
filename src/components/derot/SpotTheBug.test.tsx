import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DrillItem } from '@/lib/contracts'
import { SpotTheBug } from './SpotTheBug'

const item: DrillItem = {
  id: 'spot-the-bug-001',
  kind: 'spot-the-bug',
  language: 'python',
  difficulty: 1,
  timeLimitS: 30,
  payload: {
    language: 'python',
    snippet: 'def sum_to_n(n):\n    total = 0\n    for i in range(1, n):\n        total += i\n    return total\nprint(sum_to_n(5))',
    bugLines: [3],
    explanation: 'range(1, n) stops before n, so the loop never adds n itself; it should be range(1, n + 1).',
  },
  lane: 'arcade',
}

describe('SpotTheBug', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders one clickable row per line, numbered from 1', () => {
    render(<SpotTheBug item={item} onResult={() => {}} />)
    expect(screen.getByRole('button', { name: /1.*def sum_to_n\(n\):/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /3.*for i in range/ })).toBeTruthy()
  })

  it('is correct when the clicked line is a bug line, and shows the explanation', () => {
    const onResult = vi.fn()
    render(<SpotTheBug item={item} onResult={onResult} now={() => 0} />)

    fireEvent.click(screen.getByRole('button', { name: /3.*for i in range/ }))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ drillId: 'spot-the-bug-001', kind: 'spot-the-bug', correct: true })
    expect(screen.getByText(/range\(1, n\) stops before n/)).toBeTruthy()
  })

  it('is incorrect for a non-bug line and does not double-submit on further clicks', () => {
    const onResult = vi.fn()
    render(<SpotTheBug item={item} onResult={onResult} now={() => 0} />)

    fireEvent.click(screen.getByRole('button', { name: /1.*def sum_to_n\(n\):/ }))
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })

    fireEvent.click(screen.getByRole('button', { name: /3.*for i in range/ }))
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('submits as incorrect on timeout with no click', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<SpotTheBug item={item} onResult={onResult} now={now} />)

    t = 30000
    vi.advanceTimersByTime(30000)

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
  })

  it('autofocuses the first line so a fresh item is immediately usable by keyboard (fix round 1, I4)', () => {
    render(<SpotTheBug item={item} onResult={() => {}} now={() => 0} />)
    expect(document.activeElement).toBe(screen.getByLabelText(/^Line 1:/))
  })

  it('while paused, time does not expire and no auto-submit happens (fix round 1, I3)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<SpotTheBug item={item} onResult={onResult} now={now} paused />)

    t = 30000
    vi.advanceTimersByTime(30000)
    expect(onResult).not.toHaveBeenCalled()
  })

  it('excludes the paused span from the submitted timeMs and score (fix round 2, N1)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    const { rerender } = render(<SpotTheBug item={item} onResult={onResult} now={now} paused={false} />)

    t = 2000 // 2s active
    vi.advanceTimersByTime(2000)

    rerender(<SpotTheBug item={item} onResult={onResult} now={now} paused />)
    t = 14000 // 12s hidden
    vi.advanceTimersByTime(12000)

    rerender(<SpotTheBug item={item} onResult={onResult} now={now} paused={false} />)
    fireEvent.click(screen.getByLabelText(/^Line 3:/))

    expect(onResult).toHaveBeenCalledTimes(1)
    // Only the 2s of active time counts -- the 12s hidden span is excluded, so
    // the correct answer scores as if answered near-instantly, not after 14s.
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: true, timeMs: 2000 })
    expect(onResult.mock.calls[0][0].score).toBeGreaterThanOrEqual(95)
  })
})
