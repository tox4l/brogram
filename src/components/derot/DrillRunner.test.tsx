import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { DrillItem } from '@/lib/contracts'
import { DrillRunner } from './DrillRunner'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function item(over: Partial<DrillItem>): DrillItem {
  return {
    id: 'x',
    kind: 'predict-output',
    difficulty: 1,
    timeLimitS: 20,
    payload: {},
    lane: 'arcade',
    ...over,
  }
}

// Fix round 1, I9: each per-kind component no longer renders its own title --
// the wrapping run page's <h1> carries the drill's one voice-titled name, so
// there is no second, conflicting heading to assert on here. These tests
// instead confirm the right component mounted by its own fixed, kind-specific
// description text.
describe('DrillRunner', () => {
  it('renders PredictOutput for kind predict-output', () => {
    render(
      <DrillRunner
        item={item({ kind: 'predict-output', payload: { language: 'python', snippet: 'print(1)', expectedOutput: '1' } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByText('Read the snippet, then type exactly what it prints.')).toBeTruthy()
  })

  it('renders SpotTheBug for kind spot-the-bug', () => {
    render(
      <DrillRunner
        item={item({ kind: 'spot-the-bug', payload: { language: 'python', snippet: 'a', bugLines: [1], explanation: 'e' } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByText('Click the line that causes the bug.')).toBeTruthy()
  })

  it('renders Trace for kind trace', () => {
    render(
      <DrillRunner
        item={item({ kind: 'trace', payload: { language: 'python', snippet: 'a', stepIndex: 1, variables: ['i'], expected: { i: '1' } } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByLabelText('i')).toBeTruthy()
  })

  it('renders HoldFocus for kind hold-focus', () => {
    render(
      <DrillRunner
        item={item({ kind: 'hold-focus', payload: { passage: 'p', question: 'q', options: ['a', 'b', 'c', 'd'], answerIndex: 0 } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByText('Read the passage without scrolling, then answer the question. Leaving the page voids the drill.')).toBeTruthy()
  })

  it('renders NBack for kind n-back', () => {
    render(<DrillRunner item={item({ kind: 'n-back', payload: { n: 1, tokens: ['a', 'b'], language: 'python' } })} onResult={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Match' })).toBeTruthy()
  })

  it('renders SpeedType for kind speed-type', () => {
    render(<DrillRunner item={item({ kind: 'speed-type', payload: { language: 'python', snippet: 'x = 1' } })} onResult={vi.fn()} />)
    expect(screen.getByText('Type the snippet exactly. Accuracy matters more than speed; pasting is disabled.')).toBeTruthy()
  })

  it('passes paused through to the mounted component so its clock cannot expire unseen (fix round 1, I3)', () => {
    const onResult = vi.fn()
    let t = 0
    render(
      <DrillRunner
        item={item({ kind: 'predict-output', timeLimitS: 5, payload: { language: 'python', snippet: 'print(1)', expectedOutput: '1' } })}
        onResult={onResult}
        now={() => t}
        paused
      />
    )
    t = 5000
    vi.advanceTimersByTime(5000)
    expect(onResult).not.toHaveBeenCalled()
  })
})
