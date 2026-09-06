import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Rail } from './Rail'

// sonner's Toaster reads window.matchMedia for OS theme detection; jsdom does not have it.
// Rail mounts the real Toaster, so this test file (the only one exercising that real path)
// polyfills it here rather than leaving a shim in production code.
beforeAll(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
})

const mocks = vi.hoisted(() => ({ session: vi.fn(), select: vi.fn(), update: vi.fn(), insert: vi.fn() }))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
// Keep the real Toaster export (Rail mounts it for real here) but spy on `toast` itself.
vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal<typeof import('sonner')>()), toast: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => mocks.select(table) }) }),
      update: (patch: unknown) => ({ eq: (column: string, value: string) => ({ select: () => ({ maybeSingle: () => mocks.update(table, patch, column, value) }) }) }),
      insert: (payload: unknown) => mocks.insert(table, payload),
    }),
  }),
}))

beforeEach(() => {
  mocks.session.mockReturnValue({ user: { id: 'learner-one' } })
  mocks.select.mockResolvedValue({ data: { prefs: {}, water_log: [], pomodoro_sessions: [] }, error: null })
  // The row normally already exists (created on signup), so update finding a row is the default.
  mocks.update.mockResolvedValue({ data: { user_id: 'learner-one' }, error: null })
  mocks.insert.mockResolvedValue({ data: null, error: null })
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

  it('persists a prayer toggle back to wellness.prefs with an update (not upsert)', async () => {
    render(<Rail />)
    const toggle = await screen.findByRole('switch', { name: /fajr reminder/i })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await vi.waitFor(() => {
      expect(screen.getByRole('switch', { name: /fajr reminder/i }).getAttribute('aria-checked')).toBe('false')
    })
    expect(mocks.update).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ prefs: expect.objectContaining({ prayerReminders: expect.objectContaining({ fajr: false }) }), updated_at: expect.any(String) }),
      'user_id',
      'learner-one',
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('persists a water log tap via update, not upsert', async () => {
    render(<Rail />)
    fireEvent.click(await screen.findByRole('button', { name: /log water/i }))
    await vi.waitFor(() => expect(mocks.update).toHaveBeenCalled())
    expect(mocks.update).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ water_log: [expect.objectContaining({ kind: 'water' })] }),
      'user_id',
      'learner-one',
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('falls back to insert when the update reports no row', async () => {
    mocks.update.mockResolvedValue({ data: null, error: null })
    render(<Rail />)
    fireEvent.click(await screen.findByRole('button', { name: /log water/i }))
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalled())
    expect(mocks.insert).toHaveBeenCalledWith('wellness', expect.objectContaining({ user_id: 'learner-one', water_log: [expect.objectContaining({ kind: 'water' })] }))
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

  it('gives the pomodoro card a scroll target for the buddy\'s "break" chip, in both full and compact modes', async () => {
    const { rerender } = render(<Rail />)
    await screen.findByText('Wellness')
    expect(document.getElementById('pomodoro')).toBeTruthy()
    rerender(<Rail compact />)
    expect(document.getElementById('pomodoro')).toBeTruthy()
  })

  describe('settings', () => {
    it('changing the pomodoro work minutes persists it and the value survives a remount', async () => {
      const view = render(<Rail />)
      fireEvent.click(await screen.findByText('Settings'))
      const workInput = await screen.findByRole('spinbutton', { name: /pomodoro work/i })
      expect(workInput).toHaveProperty('value', '25')

      fireEvent.change(workInput, { target: { value: '40' } })

      await vi.waitFor(() => {
        expect(mocks.update).toHaveBeenCalledWith(
          'wellness',
          expect.objectContaining({ prefs: expect.objectContaining({ pomodoroWorkMin: 40 }) }),
          'user_id',
          'learner-one',
        )
      })

      // Simulate what a real remount reloads: the persisted value comes back from storage.
      mocks.select.mockResolvedValue({ data: { prefs: { pomodoroWorkMin: 40 }, water_log: [], pomodoro_sessions: [] }, error: null })
      view.unmount()
      render(<Rail />)
      fireEvent.click(await screen.findByText('Settings'))
      const reloadedInput = await screen.findByRole('spinbutton', { name: /pomodoro work/i })
      expect(reloadedInput).toHaveProperty('value', '40')
    })

    it('ignores a non-numeric entry and keeps the previous value', async () => {
      render(<Rail />)
      fireEvent.click(await screen.findByText('Settings'))
      const workInput = await screen.findByRole('spinbutton', { name: /pomodoro work/i })
      fireEvent.change(workInput, { target: { value: 'abc' } })
      expect(workInput).toHaveProperty('value', '25')
    })

    it('toggles device location from the settings panel', async () => {
      render(<Rail />)
      fireEvent.click(await screen.findByText('Settings'))
      const checkbox = await screen.findByRole('checkbox', { name: /use device location/i })
      expect(checkbox).toHaveProperty('checked', false)
      fireEvent.click(checkbox)
      await vi.waitFor(() => {
        expect(mocks.update).toHaveBeenCalledWith(
          'wellness',
          expect.objectContaining({ prefs: expect.objectContaining({ useDeviceLocation: true }) }),
          'user_id',
          'learner-one',
        )
      })
    })
  })
})
