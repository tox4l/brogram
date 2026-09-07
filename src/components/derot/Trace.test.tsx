import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DrillItem } from '@/lib/contracts'
import { Trace } from './Trace'

const item: DrillItem = {
  id: 'trace-001',
  kind: 'trace',
  language: 'python',
  difficulty: 1,
  timeLimitS: 45,
  payload: {
    language: 'python',
    snippet: 'total = 0\ncount = 0\nfor i in range(1, 6):\n    total += i\n    count += 1',
    stepIndex: 2,
    variables: ['i', 'total', 'count'],
    expected: { i: '2', total: '3', count: '2' },
  },
  lane: 'arcade',
}

function fillIn(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(name), { target: { value } })
  }
}

describe('Trace', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders one input per variable', () => {
    render(<Trace item={item} onResult={() => {}} />)
    expect(screen.getByLabelText('i')).toBeTruthy()
    expect(screen.getByLabelText('total')).toBeTruthy()
    expect(screen.getByLabelText('count')).toBeTruthy()
  })

  it('is correct only when every cell matches exactly (trimmed)', () => {
    const onResult = vi.fn()
    render(<Trace item={item} onResult={onResult} now={() => 0} />)

    fillIn({ i: ' 2 ', total: '3', count: '2' })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ drillId: 'trace-001', kind: 'trace', correct: true })
  })

  it('is incorrect when any single cell is wrong, and shows the expected values', () => {
    const onResult = vi.fn()
    render(<Trace item={item} onResult={onResult} now={() => 0} />)

    fillIn({ i: '2', total: '4', count: '2' })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
    expect(screen.getByText('3')).toBeTruthy() // expected total revealed
  })

  it('submits once on timeout with whatever was filled in', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<Trace item={item} onResult={onResult} now={now} />)

    fillIn({ i: '2', total: '3' })
    t = 45000
    vi.advanceTimersByTime(45000)

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false }) // count left blank

    t = 90000
    vi.advanceTimersByTime(45000)
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('autofocuses the first variable input so a fresh item is immediately usable by keyboard (fix round 1, I4)', () => {
    render(<Trace item={item} onResult={() => {}} now={() => 0} />)
    expect(document.activeElement).toBe(screen.getByLabelText('i'))
  })

  it('while paused, time does not expire and no auto-submit happens (fix round 1, I3)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<Trace item={item} onResult={onResult} now={now} paused />)

    t = 45000
    vi.advanceTimersByTime(45000)
    expect(onResult).not.toHaveBeenCalled()
  })

  it('excludes the paused span from the submitted timeMs and score (fix round 2, N1)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    const { rerender } = render(<Trace item={item} onResult={onResult} now={now} paused={false} />)

    t = 2000
    vi.advanceTimersByTime(2000)

    rerender(<Trace item={item} onResult={onResult} now={now} paused />)
    t = 14000 // 12s hidden
    vi.advanceTimersByTime(12000)

    rerender(<Trace item={item} onResult={onResult} now={now} paused={false} />)
    fillIn({ i: '2', total: '3', count: '2' })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: true, timeMs: 2000 })
    expect(onResult.mock.calls[0][0].score).toBeGreaterThanOrEqual(95)
  })
})
