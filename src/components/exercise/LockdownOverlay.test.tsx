import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINE_BANK, line } from '@/lib/voice/lines'
import { LockdownOverlay, type Focusable } from './LockdownOverlay'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('LockdownOverlay — full-screen overlay (blur / idle)', () => {
  it('renders nothing when reason is null', () => {
    render(<LockdownOverlay reason={null} />)
    expect(screen.queryByTestId('lockdown-overlay')).toBeNull()
  })

  // Fix round 1, I1: the body copy is one of the bank's own guard.blur
  // variants, not the hardcoded v1 string this overlay used to show.
  it('says what the app actually saw for a blur overlay, in the bank\'s own words', () => {
    render(<LockdownOverlay reason="blur" />)
    const overlay = screen.getByTestId('lockdown-overlay')
    expect(LINE_BANK['guard.blur'].variants).toContain(overlay.textContent)
  })

  it('says what the app actually saw for an idle overlay, in the bank\'s own words, plus a resume control', () => {
    const onResume = vi.fn()
    render(<LockdownOverlay reason="idle" onResume={onResume} />)
    const overlay = screen.getByTestId('lockdown-overlay')
    const matchesAVariant = LINE_BANK['guard.idle'].variants.some((variant) => overlay.textContent?.includes(variant))
    expect(matchesAVariant).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Continue rep' }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  // Fix round 1, I4: the overlay lifting must hand focus back, since the
  // exercise content sits behind `inert` while it was up.
  it('returns focus through returnFocusRef the instant the overlay lifts', () => {
    const focusable: Focusable = { focus: vi.fn() }
    const ref = { current: focusable }
    const { rerender } = render(<LockdownOverlay reason="blur" returnFocusRef={ref} />)
    expect(focusable.focus).not.toHaveBeenCalled()
    rerender(<LockdownOverlay reason={null} returnFocusRef={ref} />)
    expect(focusable.focus).toHaveBeenCalledTimes(1)
  })

  it('does nothing, and does not throw, when returnFocusRef is not supplied', () => {
    const { rerender } = render(<LockdownOverlay reason="idle" />)
    expect(() => rerender(<LockdownOverlay reason={null} />)).not.toThrow()
  })

  // X6 (wave 2 review): a kind whose own component never populated `returnFocusRef` (the gap
  // this finding closed for predict-output/spot-the-bug/trace) must still not drop focus to
  // `<body>` -- the floor is the exercise workspace container.
  it('falls back to fallbackFocusRef when returnFocusRef has nothing to focus, the instant the overlay lifts', () => {
    const emptyRef = { current: null }
    const fallback: Focusable = { focus: vi.fn() }
    const fallbackRef = { current: fallback }
    const { rerender } = render(<LockdownOverlay reason="blur" returnFocusRef={emptyRef} fallbackFocusRef={fallbackRef} />)
    expect(fallback.focus).not.toHaveBeenCalled()
    rerender(<LockdownOverlay reason={null} returnFocusRef={emptyRef} fallbackFocusRef={fallbackRef} />)
    expect(fallback.focus).toHaveBeenCalledTimes(1)
  })

  it('prefers returnFocusRef over fallbackFocusRef when both are populated', () => {
    const primary: Focusable = { focus: vi.fn() }
    const primaryRef = { current: primary }
    const fallback: Focusable = { focus: vi.fn() }
    const fallbackRef = { current: fallback }
    const { rerender } = render(<LockdownOverlay reason="idle" returnFocusRef={primaryRef} fallbackFocusRef={fallbackRef} />)
    rerender(<LockdownOverlay reason={null} returnFocusRef={primaryRef} fallbackFocusRef={fallbackRef} />)
    expect(primary.focus).toHaveBeenCalledTimes(1)
    expect(fallback.focus).not.toHaveBeenCalled()
  })

  it('falls back to fallbackFocusRef the instant the "why" panel closes too, when returnFocusRef has nothing to focus', () => {
    const emptyRef = { current: null }
    const fallback: Focusable = { focus: vi.fn() }
    const fallbackRef = { current: fallback }
    render(<LockdownOverlay reason={null} pasteMessage="Type it out." pasteWhy="Because typing is the exercise." returnFocusRef={emptyRef} fallbackFocusRef={fallbackRef} />)
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    expect(fallback.focus).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Hide why' }))
    expect(fallback.focus).toHaveBeenCalledTimes(1)
  })
})

describe('LockdownOverlay — paste toast (R9.3)', () => {
  it('shows the message inside a status region, reachable and persistent', () => {
    render(<LockdownOverlay reason={null} pasteMessage="Paste is off on this screen. Type it out." />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Paste is off on this screen. Type it out.')
  })

  it('auto-dismisses after 3.5s when "why" is never opened', () => {
    render(<LockdownOverlay reason={null} pasteMessage="Keyboard only on this screen." />)
    expect(screen.getByText('Keyboard only on this screen.')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(3_499) })
    expect(screen.getByText('Keyboard only on this screen.')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByText('Keyboard only on this screen.')).toBeNull()
  })

  // Fix round 1, I3: the "Why?" control must survive the toast's own
  // lifetime once opened, and must not live inside the auto-announcing
  // role=status region (unreachable-by-the-time-you-tab-to-it otherwise).
  it('keeps the toast and its "why" explanation alive indefinitely once opened, and the control is not inside the status region', () => {
    render(<LockdownOverlay reason={null} pasteMessage="Paste is off on this screen. Type it out." pasteWhy="Because typing is the exercise." />)
    const whyButton = screen.getByRole('button', { name: 'Why?' })
    expect(whyButton.closest('[role="status"]')).toBeNull()

    fireEvent.click(whyButton)
    expect(screen.getByText('Because typing is the exercise.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide why' })).toBeTruthy()

    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByText('Paste is off on this screen. Type it out.')).toBeTruthy()
    expect(screen.getByText('Because typing is the exercise.')).toBeTruthy()
  })

  // Fix round 2, N2: reaching "Why?" is what has to happen inside the old
  // 3.5s window -- pausing the timer only once `whyOpen` is already true
  // (fix round 1's fix) cannot save a keyboard user who has not yet Tabbed
  // there, since the card would already be gone before their focus arrives.
  // Whenever `pasteWhy` exists at all, no dismiss timer starts in the first
  // place, so this is provable without any Tab-timing assumption.
  it('never starts a dismiss timer at all while pasteWhy is supplied, so "Why?" stays reachable well past the old 3.5s window even if never opened', () => {
    render(<LockdownOverlay reason={null} pasteMessage="Paste won't work here. Type it." pasteWhy="Because typing is the exercise." />)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByText('Paste won\'t work here. Type it.')).toBeTruthy()
    const whyButton = screen.getByRole('button', { name: 'Why?' })
    whyButton.focus()
    expect(document.activeElement).toBe(whyButton)
  })

  it('stays mounted after "why" closes too -- there is no timed region to restart while pasteWhy is supplied', () => {
    render(<LockdownOverlay reason={null} pasteMessage="Paste won't work here. Type it." pasteWhy="Because typing is the exercise." />)
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide why' }))
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Paste won\'t work here. Type it.')).toBeTruthy()
  })

  it('still auto-dismisses after 3.5s when there is no pasteWhy at all (the original fixed-window behaviour, unchanged)', () => {
    render(<LockdownOverlay reason={null} pasteMessage="Keyboard only on this screen." />)
    act(() => { vi.advanceTimersByTime(3_500) })
    expect(screen.queryByText('Keyboard only on this screen.')).toBeNull()
  })

  // Fix round 1, I3: a new rotating line must not inherit the previous
  // block's expanded "why" state.
  it('resets "why" to collapsed when a new paste message arrives', () => {
    const { rerender } = render(<LockdownOverlay reason={null} pasteMessage="Paste is off on this screen. Type it out." pasteWhy="Because typing is the exercise." />)
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    expect(screen.getByRole('button', { name: 'Hide why' })).toBeTruthy()

    rerender(<LockdownOverlay reason={null} pasteMessage="Blocked. Typing is the exercise." pasteWhy="Because typing is the exercise." />)
    expect(screen.getByText('Blocked. Typing is the exercise.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Why?' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide why' })).toBeNull()
  })

  // Fix round 1, I4: closing "why" also returns focus to the editor.
  it('returns focus through returnFocusRef the instant the "why" panel closes', () => {
    const focusable: Focusable = { focus: vi.fn() }
    const ref = { current: focusable }
    render(<LockdownOverlay reason={null} pasteMessage="Type it out." pasteWhy="Because typing is the exercise." returnFocusRef={ref} />)
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    expect(focusable.focus).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Hide why' }))
    expect(focusable.focus).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when there is no pasteMessage', () => {
    render(<LockdownOverlay reason={null} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('LockdownOverlay — printscreen note (R9.2)', () => {
  it('renders the note plainly, with no overlay of any kind', () => {
    render(<LockdownOverlay reason={null} printscreenNote={line('guard.printscreen')} />)
    expect(screen.getByText(line('guard.printscreen'))).toBeTruthy()
    expect(screen.queryByTestId('lockdown-overlay')).toBeNull()
  })

  it('renders nothing when printscreenNote is null', () => {
    render(<LockdownOverlay reason={null} printscreenNote={null} />)
    expect(screen.queryByText(line('guard.printscreen'))).toBeNull()
  })
})
