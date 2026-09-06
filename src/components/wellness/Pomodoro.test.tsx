import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { DEFAULT_WELLNESS } from '@/lib/contracts'
import { Pomodoro } from './Pomodoro'

vi.mock('sonner', () => ({ toast: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  cleanup()
  vi.mocked(toast).mockClear()
  vi.useRealTimers()
})

const workMs = DEFAULT_WELLNESS.pomodoroWorkMin * 60_000
const breakMs = DEFAULT_WELLNESS.pomodoroBreakMin * 60_000

describe('Pomodoro', () => {
  it('shows the configured work duration before starting', () => {
    render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={vi.fn()} />)
    expect(screen.getByText('25:00')).toBeTruthy()
    expect(screen.getByText(/paused/i)).toBeTruthy()
  })

  it('starts on click and counts down against now', () => {
    render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /start pomodoro/i }))
    expect(screen.getByText(/running/i)).toBeTruthy()
  })

  it('completes a work block, persists a session, and toasts outside an attempt', () => {
    const onSessionComplete = vi.fn()
    const { rerender } = render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={onSessionComplete} />)
    fireEvent.click(screen.getByRole('button', { name: /start pomodoro/i }))
    vi.setSystemTime(workMs)
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={workMs} attemptActive={false} onSessionComplete={onSessionComplete} />)
    expect(onSessionComplete).toHaveBeenCalledWith([{ workMinutes: DEFAULT_WELLNESS.pomodoroWorkMin, completedAt: new Date(workMs).toISOString() }])
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/work block complete/i))
    expect(screen.getByText(/break/i)).toBeTruthy()
    expect(screen.getByText(DEFAULT_WELLNESS.pomodoroBreakMin < 10 ? `0${DEFAULT_WELLNESS.pomodoroBreakMin}:00` : `${DEFAULT_WELLNESS.pomodoroBreakMin}:00`)).toBeTruthy()
  })

  it('completes a break and returns to a fresh work block', () => {
    const onSessionComplete = vi.fn()
    const { rerender } = render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={onSessionComplete} />)
    fireEvent.click(screen.getByRole('button', { name: /start pomodoro/i }))
    vi.setSystemTime(workMs)
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={workMs} attemptActive={false} onSessionComplete={onSessionComplete} />)
    vi.mocked(toast).mockClear()
    vi.setSystemTime(workMs + breakMs)
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={workMs + breakMs} attemptActive={false} onSessionComplete={onSessionComplete} />)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/break complete/i))
    expect(screen.getByText('25:00')).toBeTruthy()
    expect(onSessionComplete).toHaveBeenCalledTimes(1)
  })

  it('pauses and resumes without losing remaining time', () => {
    const { rerender } = render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /start pomodoro/i }))
    vi.setSystemTime(5000)
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={5000} attemptActive={false} onSessionComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /pause pomodoro/i }))
    vi.setSystemTime(10_000)
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={10_000} attemptActive={false} onSessionComplete={vi.fn()} />)
    expect(screen.getByText('24:55')).toBeTruthy()
    expect(screen.getByText(/paused/i)).toBeTruthy()
  })

  it('resets to the configured work duration', () => {
    render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /start pomodoro/i }))
    fireEvent.click(screen.getByRole('button', { name: /reset pomodoro/i }))
    expect(screen.getByText('25:00')).toBeTruthy()
    expect(screen.getByText(/paused/i)).toBeTruthy()
  })

  it('defers the completion toast during an active attempt and fires it once the flag clears', () => {
    const onSessionComplete = vi.fn()
    const { rerender } = render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive onSessionComplete={onSessionComplete} />)
    fireEvent.click(screen.getByRole('button', { name: /start pomodoro/i }))
    vi.setSystemTime(workMs)
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={workMs} attemptActive onSessionComplete={onSessionComplete} />)
    expect(onSessionComplete).toHaveBeenCalledWith([{ workMinutes: DEFAULT_WELLNESS.pomodoroWorkMin, completedAt: new Date(workMs).toISOString() }])
    expect(toast).not.toHaveBeenCalled()

    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={workMs} attemptActive={false} onSessionComplete={onSessionComplete} />)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/work block complete/i))
  })

  it('exposes an id="pomodoro" anchor in both the full card and the compact strip', () => {
    const { rerender } = render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={vi.fn()} />)
    expect(document.getElementById('pomodoro')).toBeTruthy()
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={vi.fn()} compact />)
    expect(document.getElementById('pomodoro')).toBeTruthy()
  })

  it('collapses a 9-hour jump into a single pause, one toast, and one batched write of every completed work phase', () => {
    const onSessionComplete = vi.fn()
    const { rerender } = render(<Pomodoro prefs={DEFAULT_WELLNESS} now={0} attemptActive={false} onSessionComplete={onSessionComplete} />)
    fireEvent.click(screen.getByRole('button', { name: /start pomodoro/i }))

    const nineHoursMs = 9 * 60 * 60_000
    vi.setSystemTime(nineHoursMs)
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={nineHoursMs} attemptActive={false} onSessionComplete={onSessionComplete} />)

    // A full work+break cycle is 30 minutes; 9 hours is 18 of them, so every replayed
    // phase lands exactly on a work→break boundary and the timer is caught up mid-work.
    expect(onSessionComplete).toHaveBeenCalledTimes(1)
    const [sessions] = onSessionComplete.mock.calls[0] as [{ workMinutes: number; completedAt: string }[]]
    expect(sessions.length).toBeGreaterThan(1)
    expect(sessions.every((session) => session.workMinutes === DEFAULT_WELLNESS.pomodoroWorkMin)).toBe(true)
    expect(new Set(sessions.map((session) => session.completedAt)).size).toBe(sessions.length)

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('Timer paused while you were away.')
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/work block complete/i))
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/break complete/i))

    expect(screen.getByText(/paused/i)).toBeTruthy()
    expect(screen.getByText('25:00')).toBeTruthy()

    // Stays collapsed (does not re-fire) on a later render with the same now.
    vi.mocked(toast).mockClear()
    onSessionComplete.mockClear()
    rerender(<Pomodoro prefs={DEFAULT_WELLNESS} now={nineHoursMs} attemptActive={false} onSessionComplete={onSessionComplete} />)
    expect(toast).not.toHaveBeenCalled()
    expect(onSessionComplete).not.toHaveBeenCalled()
  })
})
