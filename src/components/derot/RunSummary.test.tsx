import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrillResult } from '@/lib/contracts'
import { RunSummary } from './RunSummary'

afterEach(cleanup)

function run(overrides: Partial<DrillResult> = {}): DrillResult {
  return { drillId: 'd1', kind: 'trace', correct: true, timeMs: 3000, score: 80, at: '2026-09-06T12:00:00.000Z', lane: 'arcade', ...overrides }
}

describe('RunSummary', () => {
  it('shows the score, accuracy and combo peak, respecting reduced motion for an instant score', () => {
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

  it('shows a personal-best badge only when this run genuinely beat a previous best (fix round 1, C2)', () => {
    const { rerender } = render(
      <RunSummary title="Call It" score={95} accuracy={1} isPersonalBest previousBest={80} lastRuns={[run()]} voiceLine="New best." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.getByText('New best')).toBeTruthy()
    expect(screen.queryByText('First run logged')).toBeNull()

    rerender(
      <RunSummary title="Call It" score={60} accuracy={0.5} isPersonalBest={false} previousBest={80} lastRuns={[run()]} voiceLine="Keep going." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.queryByText('New best')).toBeNull()
    expect(screen.queryByText('First run logged')).toBeNull()
  })

  it('shows "First run logged" instead of "New best" on a first-ever run, even at score 0 (fix round 1, C2)', () => {
    render(
      <RunSummary title="Call It" score={0} accuracy={0} isPersonalBest={false} previousBest={null} lastRuns={[run({ score: 0 })]} voiceLine="First run on the board." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.getByText('First run logged')).toBeTruthy()
    expect(screen.queryByText('New best')).toBeNull()
    // No "Best" stat is shown either -- there is nothing to compare against yet.
    expect(screen.queryByText('Best')).toBeNull()
  })

  it('never opens a label with "Your" (voice rule 3) and never renders a literal "--"', () => {
    render(
      <RunSummary title="Call It" score={82} accuracy={0.83} bestCombo={4} isPersonalBest={false} previousBest={90} lastRuns={[run(), run({ at: '2026-09-05T00:00:00.000Z' })]} voiceLine="Solid run." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.getByText('Best')).toBeTruthy()
    expect(screen.getByText('Last 2 runs')).toBeTruthy()
    expect(screen.queryByText(/Your/)).toBeNull()
    expect(document.body.textContent).not.toContain('--')
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

  it('announces the run ending through a live region (fix round 1, I4)', () => {
    render(
      <RunSummary title="Call It" score={82} accuracy={0.83} isPersonalBest={false} previousBest={90} lastRuns={[run()]} voiceLine="Solid run." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Run complete')
    expect(status.textContent).toContain('82')
  })

  it('calls onPlayAgain and links back to the given href, focusing "Run it again" on mount', () => {
    const onPlayAgain = vi.fn()
    render(<RunSummary title="Call It" score={70} accuracy={0.7} isPersonalBest={false} previousBest={null} lastRuns={[]} voiceLine="Nice." onPlayAgain={onPlayAgain} backHref="/derot" reduced />)
    const playAgainButton = screen.getByRole('button', { name: 'Run it again' })
    expect(document.activeElement).toBe(playAgainButton)
    fireEvent.click(playAgainButton)
    expect(onPlayAgain).toHaveBeenCalledTimes(1)
    const backLink = screen.getByRole('link', { name: 'Back to de-rot' })
    expect(backLink.getAttribute('href')).toBe('/derot')
  })
})
