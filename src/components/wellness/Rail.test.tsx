import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Rail } from './Rail'

const mocks = vi.hoisted(() => ({ session: vi.fn(), select: vi.fn(), upsert: vi.fn() }))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => mocks.select(table) }) }),
      upsert: (payload: unknown, options: unknown) => mocks.upsert(table, payload, options),
    }),
  }),
}))

beforeEach(() => {
  mocks.session.mockReturnValue({ user: { id: 'learner-one' } })
  mocks.select.mockResolvedValue({ data: { prefs: {}, water_log: [], pomodoro_sessions: [] }, error: null })
  mocks.upsert.mockResolvedValue({ data: null, error: null })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in tests')))
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { latitude: 24.4667, longitude: 54.3667, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition))
  Object.defineProperty(window.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Rail', () => {
  it('loads saved prefs merged with defaults', async () => {
    mocks.select.mockResolvedValue({ data: { prefs: { waterIntervalMin: 30 }, water_log: [], pomodoro_sessions: [] }, error: null })
    render(<Rail />)
    await screen.findByText(/every 30 minutes for water, 45 for a stretch/i)
  })

  it('falls back to defaults when no wellness row exists yet', async () => {
    mocks.select.mockResolvedValue({ data: null, error: null })
    render(<Rail />)
    await screen.findByText(/every 45 minutes for water, 45 for a stretch/i)
  })

  it('persists a prayer toggle back to wellness.prefs via upsert (round-trip)', async () => {
    render(<Rail />)
    const toggle = await screen.findByRole('switch', { name: /fajr reminder/i })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await vi.waitFor(() => {
      expect(screen.getByRole('switch', { name: /fajr reminder/i }).getAttribute('aria-checked')).toBe('false')
    })
    expect(mocks.upsert).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ user_id: 'learner-one', prefs: expect.objectContaining({ prayerReminders: expect.objectContaining({ fajr: false }) }) }),
      { onConflict: 'user_id' },
    )
  })

  it('persists a water log tap to water_log', async () => {
    render(<Rail />)
    fireEvent.click(await screen.findByRole('button', { name: /log water/i }))
    expect(mocks.upsert).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ user_id: 'learner-one', water_log: [expect.objectContaining({ kind: 'water' })] }),
      { onConflict: 'user_id' },
    )
  })

  it('renders the full rail with a heading', async () => {
    render(<Rail />)
    await screen.findByText('Wellness')
  })

  it('renders a thin collapsed strip in compact mode without the full heading', async () => {
    render(<Rail compact />)
    await screen.findByRole('button', { name: /^water$/i })
    expect(screen.queryByText('Wellness')).toBeNull()
  })

  it('fetches prayer times with Doha coordinates by default', async () => {
    render(<Rail />)
    await act(async () => { await Promise.resolve() })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('latitude=25.2854')
  })

  it('uses device coordinates once useDeviceLocation is enabled and geolocation succeeds', async () => {
    mocks.select.mockResolvedValue({ data: { prefs: { useDeviceLocation: true }, water_log: [], pomodoro_sessions: [] }, error: null })
    render(<Rail />)
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    await vi.waitFor(() => {
      const called = fetchMock.mock.calls.some((call) => String(call[0]).includes('latitude=24.4667'))
      expect(called).toBe(true)
    })
  })
})
