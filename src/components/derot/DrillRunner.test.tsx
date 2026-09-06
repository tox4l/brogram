import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import type { DrillItem } from '@/lib/contracts'
import { DrillRunner } from './DrillRunner'

afterEach(() => cleanup())

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

describe('DrillRunner', () => {
  it('renders PredictOutput for kind predict-output', () => {
    render(
      <DrillRunner
        item={item({ kind: 'predict-output', payload: { language: 'python', snippet: 'print(1)', expectedOutput: '1' } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByText('Predict the output')).toBeTruthy()
  })

  it('renders SpotTheBug for kind spot-the-bug', () => {
    render(
      <DrillRunner
        item={item({ kind: 'spot-the-bug', payload: { language: 'python', snippet: 'a', bugLines: [1], explanation: 'e' } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByText('Spot the bug')).toBeTruthy()
  })

  it('renders Trace for kind trace', () => {
    render(
      <DrillRunner
        item={item({ kind: 'trace', payload: { language: 'python', snippet: 'a', stepIndex: 1, variables: ['i'], expected: { i: '1' } } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByText('Trace by hand')).toBeTruthy()
  })

  it('renders HoldFocus for kind hold-focus', () => {
    render(
      <DrillRunner
        item={item({ kind: 'hold-focus', payload: { passage: 'p', question: 'q', options: ['a', 'b', 'c', 'd'], answerIndex: 0 } })}
        onResult={vi.fn()}
      />
    )
    expect(screen.getByText('Hold focus')).toBeTruthy()
  })

  it('renders NBack for kind n-back', () => {
    render(<DrillRunner item={item({ kind: 'n-back', payload: { n: 1, tokens: ['a', 'b'], language: 'python' } })} onResult={vi.fn()} />)
    expect(screen.getByText('N-back')).toBeTruthy()
  })

  it('renders SpeedType for kind speed-type', () => {
    render(<DrillRunner item={item({ kind: 'speed-type', payload: { language: 'python', snippet: 'x = 1' } })} onResult={vi.fn()} />)
    expect(screen.getByText('Speed type')).toBeTruthy()
  })
})
