import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { DEFAULT_WELLNESS } from '@/lib/contracts'
import { WaterStretch, type WellnessLogEntry } from './WaterStretch'

vi.mock('sonner', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.mocked(toast).mockClear()
})

describe('WaterStretch', () => {
  it('does not toast before the interval elapses', () => {
    // A real (non-sentinel) tick well before the interval, so this exercises
    // "not due yet" rather than accidentally relying on the C2 not-ready gate.
    render(<WaterStretch prefs={DEFAULT_WELLNESS} now={1_000} log={[]} onLog={vi.fn()} />)
    expect(toast).not.toHaveBeenCalled()
  })

  it('toasts water and stretch reminders once their configured interval elapses', () => {
    // Seeds on a real first tick (C2: `now=0` is the hydration sentinel, never a
    // seed point), then jumps forward by the configured interval.
    const start = 1_000
    const intervalMs = DEFAULT_WELLNESS.waterIntervalMin * 60_000
    const { rerender } = render(<WaterStretch prefs={DEFAULT_WELLNESS} now={start} log={[]} onLog={vi.fn()} />)
    rerender(<WaterStretch prefs={DEFAULT_WELLNESS} now={start + intervalMs} log={[]} onLog={vi.fn()} />)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/water/i))
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/stretch/i))
  })

  it('C2: never seeds or fires from the hydration sentinel (now=0), even once a real tick arrives', () => {
    // Mounting at now=0 (what a hydrating client sees before the shared clock's
    // first real tick) must not anchor the timer to 1970 -- that would make it
    // immediately "due" the instant any real time value shows up.
    const { rerender } = render(<WaterStretch prefs={DEFAULT_WELLNESS} now={0} log={[]} onLog={vi.fn()} />)
    expect(toast).not.toHaveBeenCalled()
    rerender(<WaterStretch prefs={DEFAULT_WELLNESS} now={1_778_000_000_000} log={[]} onLog={vi.fn()} />)
    expect(toast).not.toHaveBeenCalled()
  })

  it('logs a water tap with the current time', () => {
    const onLog = vi.fn()
    render(<WaterStretch prefs={DEFAULT_WELLNESS} now={1_700_000_000_000} log={[]} onLog={onLog} />)
    fireEvent.click(screen.getByRole('button', { name: /log water/i }))
    expect(onLog).toHaveBeenCalledWith({ kind: 'water', at: new Date(1_700_000_000_000).toISOString() })
  })

  it('logs a stretch tap', () => {
    const onLog = vi.fn()
    render(<WaterStretch prefs={DEFAULT_WELLNESS} now={1_700_000_000_000} log={[]} onLog={onLog} />)
    fireEvent.click(screen.getByRole('button', { name: /log stretch/i }))
    expect(onLog).toHaveBeenCalledWith({ kind: 'stretch', at: new Date(1_700_000_000_000).toISOString() })
  })

  it('shows a streak once there are consecutive logged days', () => {
    // Noon local time keeps dateKeyOf(now) at 2026-09-06 regardless of the runner's timezone.
    const now = new Date(2026, 8, 6, 12, 0, 0).getTime()
    const log: WellnessLogEntry[] = [
      { kind: 'water', at: '2026-09-06T00:00:00.000Z' },
      { kind: 'stretch', at: '2026-09-05T00:00:00.000Z' },
    ]
    render(<WaterStretch prefs={DEFAULT_WELLNESS} now={now} log={log} onLog={vi.fn()} />)
    expect(screen.getByText(/2 days/i)).toBeTruthy()
  })

  it('prompts to log when there is no streak yet', () => {
    render(<WaterStretch prefs={DEFAULT_WELLNESS} now={0} log={[]} onLog={vi.fn()} />)
    expect(screen.getByText(/start a streak/i)).toBeTruthy()
  })

  it('R6.4: reports pending instead of toasting while an attempt is active, then clears once it flushes', () => {
    const onPendingChange = vi.fn()
    const start = 1_000
    const intervalMs = DEFAULT_WELLNESS.waterIntervalMin * 60_000
    const { rerender } = render(
      <WaterStretch prefs={DEFAULT_WELLNESS} now={start} log={[]} onLog={vi.fn()} attemptActive onPendingChange={onPendingChange} />,
    )
    rerender(<WaterStretch prefs={DEFAULT_WELLNESS} now={start + intervalMs} log={[]} onLog={vi.fn()} attemptActive onPendingChange={onPendingChange} />)
    expect(onPendingChange).toHaveBeenCalledWith(true)
    expect(toast).not.toHaveBeenCalled()

    onPendingChange.mockClear()
    rerender(<WaterStretch prefs={DEFAULT_WELLNESS} now={start + intervalMs} log={[]} onLog={vi.fn()} attemptActive={false} onPendingChange={onPendingChange} />)
    expect(onPendingChange).toHaveBeenCalledWith(false)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/water/i))
  })

  it('C3: still runs its reminder engine when not visible (mounted for a collapsed/hidden dock)', () => {
    const start = 1_000
    const intervalMs = DEFAULT_WELLNESS.waterIntervalMin * 60_000
    const { container, rerender } = render(<WaterStretch prefs={DEFAULT_WELLNESS} now={start} log={[]} onLog={vi.fn()} visible={false} />)
    expect(container.firstChild).toBeNull()
    rerender(<WaterStretch prefs={DEFAULT_WELLNESS} now={start + intervalMs} log={[]} onLog={vi.fn()} visible={false} />)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/water/i))
    expect(container.firstChild).toBeNull()
  })
})
