import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DrillItem } from '@/lib/contracts'
import { PredictOutput } from './PredictOutput'

const item: DrillItem = {
  id: 'predict-output-001',
  kind: 'predict-output',
  language: 'python',
  difficulty: 1,
  timeLimitS: 20,
  payload: {
    language: 'python',
    snippet: 'x = 5\ny = 2\nprint(x // y)\nprint(x % y)',
    expectedOutput: '2\n1',
  },
  lane: 'arcade',
}

describe('PredictOutput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders the snippet', () => {
    render(<PredictOutput item={item} onResult={() => {}} />)
    expect(screen.getByText(/print\(x % y\)/)).toBeTruthy()
  })

  it('calls onResult once with correct: true for a matching answer', () => {
    const onResult = vi.fn()
    let t = 0
    render(<PredictOutput item={item} onResult={onResult} now={() => t} />)

    const textarea = screen.getByPlaceholderText(/type the exact output/i)
    fireEvent.change(textarea, { target: { value: '2\n1' } })
    t = 4000
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult).toHaveBeenCalledTimes(1)
    const result = onResult.mock.calls[0][0]
    expect(result).toMatchObject({ drillId: 'predict-output-001', kind: 'predict-output', correct: true, timeMs: 4000 })
    expect(result.score).toBeGreaterThanOrEqual(50)
    expect(typeof result.at).toBe('string')
  })

  it('calls onResult once with correct: false for a wrong answer and shows the expected output', () => {
    const onResult = vi.fn()
    render(<PredictOutput item={item} onResult={onResult} now={() => 0} />)

    const textarea = screen.getByPlaceholderText(/type the exact output/i)
    fireEvent.change(textarea, { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
    // testing-library normalizes whitespace (including newlines) when matching text content
    expect(screen.getByText('2 1')).toBeTruthy()
  })

  it('submits automatically on timeout with whatever was typed, exactly once', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<PredictOutput item={item} onResult={onResult} now={now} />)

    const textarea = screen.getByPlaceholderText(/type the exact output/i)
    fireEvent.change(textarea, { target: { value: '2\n1' } })

    t = 20000
    vi.advanceTimersByTime(20000)

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: true })

    // further timer advances must not call onResult again
    t = 40000
    vi.advanceTimersByTime(20000)
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('disables the input after submit', () => {
    const onResult = vi.fn()
    render(<PredictOutput item={item} onResult={onResult} now={() => 0} />)
    const textarea = screen.getByPlaceholderText(/type the exact output/i) as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(textarea.disabled).toBe(true)
  })

  it('autofocuses the answer field so a fresh item is immediately typeable (fix round 1, I4)', () => {
    render(<PredictOutput item={item} onResult={() => {}} now={() => 0} />)
    const textarea = screen.getByPlaceholderText(/type the exact output/i)
    expect(document.activeElement).toBe(textarea)
  })

  it('while paused, time does not expire and no auto-submit happens (fix round 1, I3 -- the tab-hidden clock)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    const { rerender } = render(<PredictOutput item={item} onResult={onResult} now={now} paused />)

    t = 20000 // past the 20s time limit
    vi.advanceTimersByTime(20000)
    expect(onResult).not.toHaveBeenCalled()

    // Resuming does NOT auto-expire (fix round 2, N1): zero active time has actually
    // elapsed -- the whole 20s wall-clock gap above happened while paused.
    rerender(<PredictOutput item={item} onResult={onResult} now={now} paused={false} />)
    vi.advanceTimersByTime(200)
    expect(onResult).not.toHaveBeenCalled()
  })

  it('excludes the paused span from both the countdown and the submitted timeMs (fix round 2, N1)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    const { rerender } = render(<PredictOutput item={item} onResult={onResult} now={now} paused={false} />)

    // 3s of active reading/typing time.
    t = 3000
    vi.advanceTimersByTime(3000)

    // Hide for twelve seconds mid-item.
    rerender(<PredictOutput item={item} onResult={onResult} now={now} paused />)
    t = 15000
    vi.advanceTimersByTime(12000)
    expect(onResult).not.toHaveBeenCalled()

    // Resume and answer correctly after 2 more active seconds.
    rerender(<PredictOutput item={item} onResult={onResult} now={now} paused={false} />)
    const textarea = screen.getByPlaceholderText(/type the exact output/i)
    fireEvent.change(textarea, { target: { value: '2\n1' } })
    t = 17000
    vi.advanceTimersByTime(2000)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult).toHaveBeenCalledTimes(1)
    // 3s before the pause + 2s after resume = 5s -- the 12s hidden span never counted,
    // even though 17s of wall-clock time passed since mount.
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: true, timeMs: 5000 })
  })

  it('does not auto-expire the instant it resumes from a pause that exceeded the time limit in wall-clock terms (fix round 2, N1)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    const { rerender } = render(<PredictOutput item={item} onResult={onResult} now={now} paused />)

    t = 30000 // past the 20s limit in wall-clock terms, but zero active time has elapsed
    vi.advanceTimersByTime(30000)
    expect(onResult).not.toHaveBeenCalled()

    rerender(<PredictOutput item={item} onResult={onResult} now={now} paused={false} />)
    vi.advanceTimersByTime(200)
    expect(onResult).not.toHaveBeenCalled() // the full 20s is still available -- nothing expired on resume
  })
})
