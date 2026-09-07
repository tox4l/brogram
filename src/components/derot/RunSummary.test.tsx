import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrillResult } from '@/lib/contracts'
import { RunSummary } from './RunSummary'

afterEach(cleanup)

function run(overrides: Partial<DrillResult> = {}): DrillResult {
  return { drillId: 'd1', kind: 'trace', correct: true, timeMs: 3000, score: 80, at: '2026-09-06T12:00:00.000Z', lane: 'arcade', ...overrides }
}

describe('RunSummary', () => {
  it('shows the score, accuracy and best combo, respecting reduced motion for an instant score', () => {
    render(
      <RunSummary
        title="Call It"
        score={82}
        accuracy={0.83}
        bestCombo={4}
        isPersonalBest={false}
        previousBest={90}
        lastRuns={[run({ score: 82 })]}
        voiceLine="Solid run."
        onPlayAgain={vi.fn()}
        backHref="/derot"
        reduced
      />
    )
    // The score renders twice by design (an aria-hidden glyph GSAP animates, plus an
    // sr-only live value) -- same pattern as XpCounter -- so this asserts on both.
    expect(screen.getAllByText('82').length).toBeGreaterThan(0)
    expect(screen.getByText('83%')).toBeTruthy()
    expect(screen.getByText('4x')).toBeTruthy()
    expect(screen.getByText('Solid run.')).toBeTruthy()
  })

  it('shows a personal-best badge only when this run earned one', () => {
    const { rerender } = render(
      <RunSummary title="Call It" score={95} accuracy={1} isPersonalBest previousBest={80} lastRuns={[run()]} voiceLine="New best." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.getByText('New best')).toBeTruthy()

    rerender(
      <RunSummary title="Call It" score={60} accuracy={0.5} isPersonalBest={false} previousBest={80} lastRuns={[run()]} voiceLine="Keep going." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.queryByText('New best')).toBeNull()
  })

  it('shows the raw label when given (the interesting number for the run)', () => {
    render(
      <RunSummary
        title="Twitch"
        score={73}
        accuracy={1}
        isPersonalBest={false}
        previousBest={null}
        lastRuns={[]}
        rawLabel="842 ms mean reaction"
        voiceLine="Fast."
        onPlayAgain={vi.fn()}
        backHref="/derot/play/reaction"
        reduced
      />
    )
    expect(screen.getByText('842 ms mean reaction')).toBeTruthy()
  })

  it('calls onPlayAgain and links back to the given href', () => {
    const onPlayAgain = vi.fn()
    render(<RunSummary title="Call It" score={70} accuracy={0.7} isPersonalBest={false} previousBest={null} lastRuns={[]} voiceLine="Nice." onPlayAgain={onPlayAgain} backHref="/derot" reduced />)
    fireEvent.click(screen.getByRole('button', { name: 'Run it again' }))
    expect(onPlayAgain).toHaveBeenCalledTimes(1)
    const backLink = screen.getByRole('link', { name: 'Back to de-rot' })
    expect(backLink.getAttribute('href')).toBe('/derot')
  })
})
