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

  it('shows one hit/miss chip per item, in order, distinguishable by more than colour (fix round 2, item 5)', () => {
    render(
      <RunSummary
        title="Call It"
        score={67}
        accuracy={0.67}
        isPersonalBest={false}
        previousBest={null}
        lastRuns={[]}
        itemResults={[true, true, false, true, false, true]}
        voiceLine="Solid."
        onPlayAgain={vi.fn()}
        backHref="/derot"
        reduced
      />
    )
    expect(screen.getByLabelText('Item 1: correct')).toBeTruthy()
    expect(screen.getByLabelText('Item 3: missed')).toBeTruthy()
    expect(screen.getByLabelText('Item 6: correct')).toBeTruthy()
    // Four correct, two missed -- distinguished by icon (Check/X), not colour alone.
    expect(document.querySelectorAll('.lucide-check').length).toBe(4)
    expect(document.querySelectorAll('.lucide-x').length).toBe(2)
  })

  it('omits the hit/miss row entirely when itemResults is not given (a Playground game with no discrete items)', () => {
    render(<RunSummary title="Twitch" score={73} accuracy={1} isPersonalBest={false} previousBest={null} lastRuns={[]} voiceLine="Fast." onPlayAgain={vi.fn()} backHref="/derot" reduced />)
    expect(screen.queryByText('Where it went')).toBeNull()
  })

  it('shows the delta against the previous best, signed, alongside Best (fix round 2, item 5)', () => {
    const { rerender } = render(
      <RunSummary title="Call It" score={92} accuracy={0.9} isPersonalBest previousBest={80} lastRuns={[]} voiceLine="New best." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.getByText('Delta')).toBeTruthy()
    expect(screen.getByText('+12')).toBeTruthy()

    rerender(
      <RunSummary title="Call It" score={70} accuracy={0.7} isPersonalBest={false} previousBest={80} lastRuns={[]} voiceLine="Keep going." onPlayAgain={vi.fn()} backHref="/derot" reduced />
    )
    expect(screen.getByText('-10')).toBeTruthy()
  })

  it('shows no delta on a first-ever run -- there is nothing to compare against', () => {
    render(<RunSummary title="Call It" score={50} accuracy={0.5} isPersonalBest={false} previousBest={null} lastRuns={[]} voiceLine="First run." onPlayAgain={vi.fn()} backHref="/derot" reduced />)
    expect(screen.queryByText('Delta')).toBeNull()
  })

  it('keeps the raw label out of the numeric Stat grid -- it is a caption, not a value (fix round 2, item 5)', () => {
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
    const rawText = screen.getByText('842 ms mean reaction')
    expect(rawText.className).not.toContain('text-2xl')
    expect(screen.queryByText('Raw')).toBeNull() // no "Raw" label in the Stat grid
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
