import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ play: vi.fn(), withInterfaceSounds: vi.fn((run: () => void) => run()) }))
vi.mock('@/lib/sound/manager', () => ({ play: mocks.play, withInterfaceSounds: mocks.withInterfaceSounds }))

import ColorBack from './ColorBack'
import Breathe from './Breathe'
import MemoryGrid from './MemoryGrid'

/** Fake timers cascade recursive setTimeout/setInterval chains inside one advance, same as NBack.test.tsx. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

// Specific colour names only -- "Colour Back" is the game's own title (already
// established in DRILL_META) and is not itself a description of a stimulus.
const COLOR_WORDS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'amber', 'pink']

function noop() {}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('ColorBack (Colour Back / color-nback)', () => {
  it('starts, scores, and calls onComplete once with a raw value', () => {
    const onComplete = vi.fn()
    render(<ColorBack timeLimitS={8} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} now={() => 0} />)

    // total ticks for an 8s run at the 2000ms cadence is 6; run the whole thing out with no presses.
    for (let i = 0; i < 6; i++) advance(2000)

    expect(onComplete).toHaveBeenCalledTimes(1)
    const result = onComplete.mock.calls[0][0]
    expect(typeof result.raw).toBe('number')
    expect(result.raw).toBeGreaterThanOrEqual(0)
    expect(result.payload).toMatchObject({ n: 2 })
  })

  it('computes raw as (hits - false alarms) times 100, floored at 0', () => {
    const onComplete = vi.fn()
    // rng() always 0: seq[0]=seq[1]=0, and every i>=2 forces seq[i]=seq[i-2] -> the whole
    // sequence is all zeros, so every position from index 2 on is a genuine planted match.
    render(<ColorBack timeLimitS={8} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} now={() => 0} rng={() => 0} />)

    advance(2000) // -> stimulus index 1 (no press; index 0 and 1 are before N=2, presses here would be false alarms)
    advance(2000) // -> stimulus index 2 (a planted match)
    fireEvent.click(screen.getByRole('button', { name: /match/i })) // hit
    advance(2000) // -> index 3
    fireEvent.click(screen.getByRole('button', { name: /match/i })) // hit
    advance(2000) // -> index 4
    fireEvent.click(screen.getByRole('button', { name: /match/i })) // hit
    advance(2000) // -> index 5
    fireEvent.click(screen.getByRole('button', { name: /match/i })) // hit
    advance(2000) // -> index 6 (past the last stimulus) -> finish

    expect(onComplete).toHaveBeenCalledTimes(1)
    const result = onComplete.mock.calls[0][0]
    // 4 hits, 0 false alarms -> (4 - 0) * 100 = 400
    expect(result.raw).toBe(400)
    expect(result.payload).toMatchObject({ hits: 4, falseAlarms: 0 })
  })

  it('renders a shape for every stimulus and never describes one by colour', () => {
    render(<ColorBack timeLimitS={90} soundOn={false} reducedMotion={false} onComplete={noop} onAbort={noop} now={() => 0} />)

    for (let i = 0; i < 5; i++) {
      // an icon (svg) representing the current stimulus's shape is always present
      const swatch = document.querySelector('[aria-hidden="true"] svg')
      expect(swatch).not.toBeNull()
      advance(2000)
    }

    const bodyText = (document.body.textContent ?? '').toLowerCase()
    for (const word of COLOR_WORDS) expect(bodyText).not.toContain(word)
  })

  it('calls onAbort on Escape and never calls onComplete', () => {
    const onComplete = vi.fn()
    const onAbort = vi.fn()
    render(<ColorBack timeLimitS={90} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={onAbort} now={() => 0} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('Breathe', () => {
  it('completes and scores with zero input', () => {
    const onComplete = vi.fn()
    render(<Breathe timeLimitS={5} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)

    // no clicks, no keypresses -- the 4-7-8 pacer runs entirely on its own clock.
    advance(5000)

    expect(onComplete).toHaveBeenCalledTimes(1)
    const result = onComplete.mock.calls[0][0]
    expect(result.raw).toBe(100)
    expect(result.payload).toMatchObject({ completionPercent: 100, tapsGiven: 0 })
  })

  it('starts, scores, and calls onComplete once with a raw value even with input along the way', () => {
    const onComplete = vi.fn()
    render(<Breathe timeLimitS={5} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} />)

    expect(screen.getByText('Breathe in')).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: /tap to breathe/i }))
    fireEvent.pointerUp(screen.getByRole('button', { name: /tap to breathe/i }))

    advance(5000)

    expect(onComplete).toHaveBeenCalledTimes(1)
    const result = onComplete.mock.calls[0][0]
    expect(typeof result.raw).toBe('number')
    expect(result.payload).toMatchObject({ tapsGiven: 1 })
  })

  it('shows a stepped, non-animated phase name and count under reduced motion', () => {
    render(<Breathe timeLimitS={90} soundOn={false} reducedMotion onComplete={noop} onAbort={noop} />)
    expect(screen.getByText('Breathe in')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
  })

  it('calls onAbort on Escape and never calls onComplete', () => {
    const onComplete = vi.fn()
    const onAbort = vi.fn()
    render(<Breathe timeLimitS={90} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={onAbort} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('MemoryGrid (Grid / memory-grid)', () => {
  it('starts, and calls onComplete once with a raw value of rounds cleared times 250', () => {
    const onComplete = vi.fn()
    render(<MemoryGrid timeLimitS={2} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} rng={() => 0.5} />)

    const grid = screen.getByRole('group', { name: /memory grid/i })

    // Capture round 1's 3-cell flash order as it plays.
    const sequence: number[] = []
    for (let i = 0; i < 3; i++) {
      const lit = grid.querySelector('[data-cell-index].bg-primary') as HTMLElement
      expect(lit).toBeTruthy()
      sequence.push(Number(lit.getAttribute('data-cell-index')))
      advance(600)
    }

    // Reproduce it correctly -- round 1 clears.
    for (const index of sequence) {
      fireEvent.click(grid.querySelector(`[data-cell-index="${index}"]`) as HTMLElement)
    }
    expect(onComplete).not.toHaveBeenCalled()

    // The 2s time limit has long since elapsed (rounds don't stop the safety net); the run ends and scores what was cleared.
    advance(6000)

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0]).toMatchObject({ raw: 250, payload: { roundsCleared: 1 } })
  })

  it('is keyboard playable: arrow keys move a labelled focus, and activating the focused cell selects it', () => {
    const onComplete = vi.fn()
    render(<MemoryGrid timeLimitS={90} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={noop} rng={() => 0.5} />)

    const grid = screen.getByRole('group', { name: /memory grid/i })

    // Focus starts on the centre cell, index 5 -> row 2, column 2 (1-indexed).
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Row 2, column 2')

    // Capture the pattern's first cell while it flashes, then let the rest of
    // the (non-interactive) flash phase play out so the grid opens for input.
    const lit = grid.querySelector('[data-cell-index].bg-primary') as HTMLElement
    expect(lit).toBeTruthy()
    const target = Number(lit.getAttribute('data-cell-index'))
    advance(600) // flash index 0 -> 1
    advance(600) // flash index 1 -> 2
    advance(600) // flash index 2 -> 3 (past the last cell) -> phase becomes 'input'

    const fromRow = 1
    const fromCol = 1
    const toRow = Math.floor(target / 4)
    const toCol = target % 4
    const keys: string[] = []
    for (let r = fromRow; r < toRow; r++) keys.push('ArrowDown')
    for (let r = fromRow; r > toRow; r--) keys.push('ArrowUp')
    for (let c = fromCol; c < toCol; c++) keys.push('ArrowRight')
    for (let c = fromCol; c > toCol; c--) keys.push('ArrowLeft')
    keys.forEach((key) => fireEvent.keyDown(grid, { key }))

    // Every cell is named by row and column -- never colour, never position alone.
    expect(document.activeElement).toBe(lit)
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Row \d, column \d$/)

    // Enter/Space on a real <button> fires the same click a keyboard activation would.
    fireEvent.click(document.activeElement as HTMLElement)
    expect(lit.getAttribute('aria-pressed')).toBe('true')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('calls onAbort on Escape and never calls onComplete', () => {
    const onComplete = vi.fn()
    const onAbort = vi.fn()
    render(<MemoryGrid timeLimitS={90} soundOn={false} reducedMotion={false} onComplete={onComplete} onAbort={onAbort} rng={() => 0.5} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onAbort).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
  })
})
