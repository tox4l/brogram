import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DrillItem } from '@/lib/contracts'
import { SpeedType } from './SpeedType'

const item: DrillItem = {
  id: 'speed-type-001',
  kind: 'speed-type',
  language: 'python',
  difficulty: 1,
  timeLimitS: 30,
  payload: {
    language: 'python',
    snippet: 'numbers = [1, 2, 3, 4, 5]\ntotal = sum(numbers)\nprint(total)',
  },
}

describe('SpeedType', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders the snippet to type', () => {
    render(<SpeedType item={item} onResult={() => {}} />)
    expect(screen.getByText(/total = sum\(numbers\)/)).toBeTruthy()
  })

  it('is correct at or above 95 percent accuracy', () => {
    const onResult = vi.fn()
    render(<SpeedType item={item} onResult={onResult} now={() => 0} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: item.payload.snippet as string } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ drillId: 'speed-type-001', kind: 'speed-type', correct: true, score: 100 })
  })

  it('is incorrect below 95 percent accuracy', () => {
    const onResult = vi.fn()
    render(<SpeedType item={item} onResult={onResult} now={() => 0} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'totally different text' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false })
  })

  it('prevents paste, copy, cut, contextmenu, and drop on the textarea', () => {
    render(<SpeedType item={item} onResult={() => {}} />)
    const textarea = screen.getByRole('textbox')

    for (const type of ['paste', 'copy', 'cut', 'contextmenu', 'drop']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      const prevented = !textarea.dispatchEvent(event)
      expect(prevented).toBe(true)
    }
  })

  it('submits once on timeout with whatever was typed', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<SpeedType item={item} onResult={onResult} now={now} />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'partial' } })

    t = 30000
    vi.advanceTimersByTime(30000)

    expect(onResult).toHaveBeenCalledTimes(1)

    t = 60000
    vi.advanceTimersByTime(30000)
    expect(onResult).toHaveBeenCalledTimes(1)
  })
})
