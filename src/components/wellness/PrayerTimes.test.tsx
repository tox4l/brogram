import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { DEFAULT_WELLNESS } from '@/lib/contracts'
import { parseLocalDateTime } from '@/lib/wellness/timers'
import type { PrayerTimesResult } from '@/lib/wellness/prayer'
import { PrayerTimes } from './PrayerTimes'

vi.mock('sonner', () => ({ toast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.mocked(toast).mockClear()
})

const times = { fajr: '04:12', dhuhr: '11:32', asr: '14:52', maghrib: '17:22', isha: '18:52' }
const result: PrayerTimesResult = { date: '2026-09-06', times, source: 'aladhan' }
const dhuhrAtMs = parseLocalDateTime('2026-09-06', '11:32')

describe('PrayerTimes', () => {
  it('shows a loading state before results arrive', () => {
    render(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={null} now={0} attemptActive={false} />)
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('renders all five prayer times', () => {
    render(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={result} now={dhuhrAtMs - 60 * 60_000} attemptActive={false} />)
    expect(screen.getByText('04:12')).toBeTruthy()
    expect(screen.getByText('11:32')).toBeTruthy()
    expect(screen.getByText('18:52')).toBeTruthy()
  })

  it('shows the offline computed note for a fallback result', () => {
    render(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={{ ...result, source: 'fallback' }} now={0} attemptActive={false} />)
    expect(screen.getByText(/computed offline/i)).toBeTruthy()
  })

  it('does not toast before any reminder time that day', () => {
    const fajrLeadMs = parseLocalDateTime('2026-09-06', '04:12') - DEFAULT_WELLNESS.prayerLeadMinutes * 60_000
    render(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={result} now={fajrLeadMs - 1} attemptActive={false} />)
    expect(toast).not.toHaveBeenCalled()
  })

  it('toasts a lead reminder and the at-time reminder for an enabled prayer', () => {
    const leadMs = dhuhrAtMs - DEFAULT_WELLNESS.prayerLeadMinutes * 60_000
    const { rerender } = render(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={result} now={leadMs} attemptActive={false} />)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Dhuhr'))
    vi.mocked(toast).mockClear()
    rerender(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={result} now={dhuhrAtMs} attemptActive={false} />)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Dhuhr time has arrived'))
  })

  it('suppresses the toast for a disabled prayer', () => {
    const prefs = { ...DEFAULT_WELLNESS, prayerReminders: { ...DEFAULT_WELLNESS.prayerReminders, dhuhr: false } }
    render(<PrayerTimes prefs={prefs} onTogglePrayer={vi.fn()} result={result} now={dhuhrAtMs} attemptActive={false} />)
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('Dhuhr'))
  })

  it('queues a reminder during an active attempt and fires it once the flag clears', () => {
    const { rerender } = render(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={result} now={dhuhrAtMs} attemptActive />)
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('Dhuhr'))
    rerender(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={vi.fn()} result={result} now={dhuhrAtMs} attemptActive={false} />)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Dhuhr time has arrived'))
  })

  it('calls onTogglePrayer when a reminder switch is clicked', async () => {
    const onTogglePrayer = vi.fn()
    render(<PrayerTimes prefs={DEFAULT_WELLNESS} onTogglePrayer={onTogglePrayer} result={result} now={0} attemptActive={false} />)
    screen.getByRole('switch', { name: /dhuhr reminder/i }).click()
    expect(onTogglePrayer).toHaveBeenCalledWith('dhuhr')
  })
})
