import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DrillItem } from '@/lib/contracts'
import { HoldFocus } from './HoldFocus'

interface HoldFocusSeedItem {
  id: string
  payload: { passage: string; question: string; options: string[]; answerIndex: number }
}

function longestSeedPassageItem(): HoldFocusSeedItem {
  const seed = JSON.parse(readFileSync('seed/drills/hold-focus.json', 'utf8')) as { items: HoldFocusSeedItem[] }
  return seed.items.reduce((longest, current) =>
    current.payload.passage.length > longest.payload.passage.length ? current : longest
  )
}

const item: DrillItem = {
  id: 'hold-focus-001',
  kind: 'hold-focus',
  language: 'python',
  difficulty: 1,
  timeLimitS: 120,
  payload: {
    passage: 'A variable is a named location in memory. '.repeat(10),
    question: 'What is a variable?',
    options: ['A named memory location.', 'A loop.', 'A function.', 'A class.'],
    answerIndex: 0,
  },
  lane: 'arcade',
}

describe('HoldFocus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders the question and four options', () => {
    render(<HoldFocus item={item} onResult={() => {}} />)
    expect(screen.getByText(item.payload.question as string)).toBeTruthy()
    for (const option of item.payload.options as string[]) {
      expect(screen.getByRole('button', { name: option })).toBeTruthy()
    }
  })

  it('renders the full longest seed passage with no fixed height, only overflow hidden for the void guard', () => {
    const seedItem = longestSeedPassageItem()
    const longItem: DrillItem = {
      id: seedItem.id,
      kind: 'hold-focus',
      difficulty: 1,
      timeLimitS: 180,
      payload: seedItem.payload,
      lane: 'arcade',
    }

    render(<HoldFocus item={longItem} onResult={() => {}} />)

    const passageEl = screen.getByLabelText(/reading passage/i)
    expect(passageEl.textContent).toBe(seedItem.payload.passage)
    expect(passageEl.style.height).toBe('')
    expect(passageEl.style.maxHeight).toBe('')
    expect(passageEl.style.overflow).toBe('hidden')
  })

  it('is correct when the chosen option matches answerIndex', () => {
    const onResult = vi.fn()
    render(<HoldFocus item={item} onResult={onResult} now={() => 0} />)

    fireEvent.click(screen.getByRole('button', { name: 'A named memory location.' }))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ drillId: 'hold-focus-001', kind: 'hold-focus', correct: true })
  })

  it('is incorrect for a wrong option and shows the right one', () => {
    const onResult = vi.fn()
    render(<HoldFocus item={item} onResult={onResult} now={() => 0} />)

    fireEvent.click(screen.getByRole('button', { name: 'A loop.' }))

    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
    expect(screen.getByText(/correct answer/i)).toBeTruthy()
  })

  it('voids the drill on window blur, reporting correct: false and score: 0 immediately', () => {
    const onResult = vi.fn()
    render(<HoldFocus item={item} onResult={onResult} now={() => 5000} />)

    fireEvent(window, new Event('blur'))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
  })

  it('voids the drill when the tab becomes hidden', () => {
    const onResult = vi.fn()
    render(<HoldFocus item={item} onResult={onResult} now={() => 0} />)

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    fireEvent(document, new Event('visibilitychange'))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  })

  it('voids the drill on a wheel event over the passage', () => {
    const onResult = vi.fn()
    render(<HoldFocus item={item} onResult={onResult} now={() => 0} />)

    fireEvent.wheel(screen.getByLabelText(/reading passage/i))

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
  })

  it('does not call onResult a second time after voiding, even if an option is clicked afterward', () => {
    const onResult = vi.fn()
    render(<HoldFocus item={item} onResult={onResult} now={() => 0} />)

    fireEvent(window, new Event('blur'))
    expect(onResult).toHaveBeenCalledTimes(1)

    const button = screen.queryByRole('button', { name: 'A named memory location.' })
    if (button) fireEvent.click(button)
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('submits as incorrect on timeout with nothing chosen', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<HoldFocus item={item} onResult={onResult} now={now} />)

    t = 120000
    vi.advanceTimersByTime(120000)

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
  })

  it('focuses the passage on mount, not an answer option (fix round 1, I4)', () => {
    render(<HoldFocus item={item} onResult={() => {}} />)
    expect(document.activeElement).toBe(screen.getByLabelText(/reading passage/i))
  })

  it('the safety-net countdown does not expire while paused (fix round 1, I3)', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<HoldFocus item={item} onResult={onResult} now={now} paused />)

    t = 120000
    vi.advanceTimersByTime(120000)
    expect(onResult).not.toHaveBeenCalled()
  })
})
