import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { DrillItem } from '@/lib/contracts'
import { NBack } from './NBack'
import { countPlantedMatches } from './scoring'

// tokens: index 2 repeats index 1 -> 1 planted match at n=1 ('b','b')
const tokens = ['a', 'b', 'b', 'c']
const item: DrillItem = {
  id: 'n-back-001',
  kind: 'n-back',
  language: 'python',
  difficulty: 1,
  timeLimitS: 60,
  payload: { n: 1, tokens, language: 'python' },
  lane: 'arcade',
}

/** Advancing the fake clock must happen inside act() so the effect that reschedules the next 1500ms timer flushes before the next advance. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('NBack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows tokens one at a time, advancing every 1500ms', () => {
    render(<NBack item={item} onResult={() => {}} />)
    expect(screen.getByText('a')).toBeTruthy()

    advance(1500)
    expect(screen.getByText('b')).toBeTruthy()
  })

  it('counts a hit for a correct match press and ends after the last token', () => {
    const onResult = vi.fn()
    render(<NBack item={item} onResult={onResult} now={() => 0} />)

    // token 0: 'a' - no press (correctly withheld)
    advance(1500)
    // token 1: 'b' - tokens[1] vs tokens[0]: 'b' vs 'a', no match - no press
    advance(1500)
    // token 2: 'b' - matches tokens[1]='b' -> press Match (hit)
    fireEvent.click(screen.getByRole('button', { name: /match/i }))
    advance(1500)
    // token 3: 'c' - no match, no press
    advance(1500)

    expect(onResult).toHaveBeenCalledTimes(1)
    const result = onResult.mock.calls[0][0]
    expect(result).toMatchObject({ drillId: 'n-back-001', kind: 'n-back' })
    expect(countPlantedMatches(tokens, 1)).toBe(1)
    // 1 hit, 0 false alarms, 1 planted match -> correct, score 100
    expect(result.correct).toBe(true)
    expect(result.score).toBe(100)
  })

  it('counts a false alarm for a press on a non-match, lowering the score', () => {
    const onResult = vi.fn()
    render(<NBack item={item} onResult={onResult} now={() => 0} />)

    // token 0: 'a' - false alarm
    fireEvent.click(screen.getByRole('button', { name: /match/i }))
    advance(1500)
    // token 1: 'b' - no press
    advance(1500)
    // token 2: 'b' - hit
    fireEvent.click(screen.getByRole('button', { name: /match/i }))
    advance(1500)
    // token 3: 'c' - no press
    advance(1500)

    expect(onResult).toHaveBeenCalledTimes(1)
    const result = onResult.mock.calls[0][0]
    // net = 1 hit - 1 false alarm = 0; plantedMatches = 1; correct needs net >= 0.5 -> false
    expect(result.correct).toBe(false)
    expect(result.score).toBe(0)
  })

  it('responds to the space key as well as the Match button', () => {
    const onResult = vi.fn()
    render(<NBack item={item} onResult={onResult} now={() => 0} />)

    advance(1500) // token 1 'b'
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    // that press was on token 1 (no match), so it is a false alarm
    advance(1500) // token 2 'b'
    fireEvent.click(screen.getByRole('button', { name: /match/i })) // hit
    advance(1500) // token 3 'c'
    advance(1500) // past the last token -> finish

    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('ignores a second press on the same token', () => {
    const onResult = vi.fn()
    render(<NBack item={item} onResult={onResult} now={() => 0} />)

    fireEvent.click(screen.getByRole('button', { name: /match/i }))
    fireEvent.click(screen.getByRole('button', { name: /match/i })) // should not double count
    advance(1500) // token 1
    advance(1500) // token 2 (planted match, never pressed)
    advance(1500) // token 3
    advance(1500) // past the last token -> finish

    expect(onResult).toHaveBeenCalledTimes(1)
    // only 1 false alarm counted from token 0 (the planted match at token 2 was never pressed)
    expect(onResult.mock.calls[0][0].score).toBe(0)
  })

  it('ignores the space key when focus is in a text field elsewhere on the page, without counting a press', () => {
    const onResult = vi.fn()
    render(
      <>
        <NBack item={item} onResult={onResult} now={() => 0} />
        <textarea aria-label="buddy message" />
      </>
    )

    const textarea = screen.getByLabelText('buddy message')
    textarea.focus()

    // token 2 ('b') is the sole planted match; a press here would be a hit if wrongly counted.
    advance(1500) // token 1
    advance(1500) // token 2
    const event = fireEvent.keyDown(textarea, { key: ' ', code: 'Space' })
    expect(event).toBe(true) // fireEvent returns false only when preventDefault was called
    advance(1500) // token 3
    advance(1500) // finish

    expect(onResult).toHaveBeenCalledTimes(1)
    // no hit and no false alarm counted at all -> net 0, correct false, score 0
    expect(onResult.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
  })

  it('keeps the current token timer running (no restart) and the response lock intact across a re-render with a new inline onResult', () => {
    const onResultA = vi.fn()
    const { rerender } = render(<NBack item={item} onResult={onResultA} now={() => 0} />)

    // token 0 'a': press once (a false alarm, since there is no token to look back to yet)
    fireEvent.click(screen.getByRole('button', { name: /match/i }))

    advance(700) // partway through token 0's 1500ms window
    expect(screen.getByText('a')).toBeTruthy() // still token 0 - no restart yet

    // Parent re-renders with a brand-new inline onResult identity mid-token.
    const onResultB = vi.fn()
    rerender(<NBack item={item} onResult={onResultB} now={() => 0} />)

    // A second press for the same token must still be locked out (not reset by the re-render).
    fireEvent.click(screen.getByRole('button', { name: /match/i }))

    // Only the remaining 800ms should be needed to reach token 1 - not a fresh 1500ms from the re-render.
    advance(800)
    expect(screen.getByText('b')).toBeTruthy()

    advance(1500) // token 1 -> token 2
    fireEvent.click(screen.getByRole('button', { name: /match/i })) // token 2 'b' matches token 1 'b' -> hit
    advance(1500) // token 2 -> token 3
    advance(1500) // token 3 -> finish

    expect(onResultA).not.toHaveBeenCalled()
    expect(onResultB).toHaveBeenCalledTimes(1)
    // 1 false alarm (token 0, counted once despite two presses) + 1 hit (token 2) -> net 0 -> incorrect, score 0
    expect(onResultB.mock.calls[0][0]).toMatchObject({ correct: false, score: 0 })
  })

  it('does not call onResult more than once even if the overall time limit is also reached', () => {
    const onResult = vi.fn()
    let t = 0
    const now = () => t
    render(<NBack item={item} onResult={onResult} now={now} />)

    t = 1500
    advance(1500)
    t = 3000
    advance(1500)
    t = 4500
    advance(1500)
    t = 6000
    advance(1500)
    expect(onResult).toHaveBeenCalledTimes(1)

    t = 60000
    advance(54000)
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('while paused, neither the token stream nor the safety-net countdown advances (fix round 1, I3)', () => {
    const onResult = vi.fn()
    render(<NBack item={item} onResult={onResult} now={() => 0} paused />)

    expect(screen.getByText('a')).toBeTruthy()
    advance(10000) // well past every token's 1500ms window and the 60s time limit
    expect(screen.getByText('a')).toBeTruthy() // still token 0 -- nothing advanced
    expect(onResult).not.toHaveBeenCalled()
  })

  it('focuses the Match button on mount so a fresh item is immediately playable by keyboard (fix round 1, I4)', () => {
    render(<NBack item={item} onResult={() => {}} now={() => 0} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /match/i }))
  })
})
