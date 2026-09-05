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
})
