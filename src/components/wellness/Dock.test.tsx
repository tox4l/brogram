import type { PropsWithChildren } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '@/lib/query/client'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { DEFAULT_WELLNESS } from '@/lib/contracts'
import { ATTEMPT_ACTIVE_KEY } from '@/lib/wellness/timers'
import { Dock } from './Dock'

// A controllable stand-in for the shared 1Hz clock (its own tests live in
// useSecondTick.test.tsx): the water/stretch recurring-timer test below needs
// to jump `now` forward by a fixed amount deterministically, which the real
// module-singleton interval cannot do inside a test.
const tickMocks = vi.hoisted(() => ({ now: vi.fn(() => 0) }))
vi.mock('@/components/shell/useSecondTick', () => ({ useSecondTick: () => tickMocks.now() }))

// sonner's Toaster reads window.matchMedia for OS theme detection; jsdom does not have it.
// This is the only test file exercising the real Toaster mount, so it polyfills it here
// rather than leaving a shim in production code.
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

// A stateful fake `wellness` table (rather than a fixed mockResolvedValue), like
// SoundToggle.test.tsx: this component's writes go through the shared optimistic
// mutation, which invalidates its TanStack Query key on settle and triggers a real
// refetch through this same mock -- a static mock would clobber the just-applied
// write with stale data, an artifact of the mock, not of production.
const db = vi.hoisted(() => ({ row: null as { prefs?: unknown; water_log?: unknown; pomodoro_sessions?: unknown } | null }))
const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), insert: vi.fn() }))

vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal<typeof import('sonner')>()), toast: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => ({ eq: () => ({ maybeSingle: async () => { mocks.select(table, columns); return { data: db.row, error: null } } }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: (column: string, value: string) => ({
          select: () => ({
            maybeSingle: async () => {
              mocks.update(table, patch, column, value)
              if (!db.row) return { data: null, error: null }
              db.row = { ...db.row, ...patch }
              return { data: { user_id: value }, error: null }
            },
          }),
        }),
      }),
      insert: async (payload: Record<string, unknown>) => {
        mocks.insert(table, payload)
        db.row = { ...payload }
        return { data: null, error: null }
      },
    }),
  }),
}))

beforeEach(() => {
  db.row = { prefs: {}, water_log: [], pomodoro_sessions: [] }
  tickMocks.now.mockReturnValue(0)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in tests')))
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: { latitude: 24.4667, longitude: 54.3667, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition))
  Object.defineProperty(window.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  try { sessionStorage.clear() } catch { /* jsdom always has sessionStorage */ }
})

function wrapper(userId: string | null) {
  const client = makeQueryClient()
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <SessionProvider initialState={{ user: userId ? ({ id: userId } as User) : null, profile: null, learnerState: null }}>
          {children}
        </SessionProvider>
      </QueryClientProvider>
    )
  }
}

const noop = () => {}
function Vertical() {
  return <Dock orientation="vertical" collapsed={false} onToggleCollapse={noop} corner="br" onCornerChange={noop} />
}
function Horizontal() {
  return <Dock orientation="horizontal" collapsed={false} onToggleCollapse={noop} corner="br" onCornerChange={noop} />
}

describe('Dock', () => {
  it('loads saved prefs merged with defaults', async () => {
    db.row = { prefs: { waterIntervalMin: 30 }, water_log: [], pomodoro_sessions: [] }
    render(<Vertical />, { wrapper: wrapper('learner-one') })
    await screen.findByText(/every 30 minutes for water, 45 for a stretch/i)
  })

  it('falls back to defaults when no wellness row exists yet', async () => {
    db.row = null
    render(<Vertical />, { wrapper: wrapper('learner-one') })
    await screen.findByText(/every 45 minutes for water, 45 for a stretch/i)
  })

  it('persists a prayer toggle back to wellness.prefs with an update (not upsert)', async () => {
    render(<Vertical />, { wrapper: wrapper('learner-one') })
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
    render(<Vertical />, { wrapper: wrapper('learner-one') })
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
    db.row = null
    render(<Vertical />, { wrapper: wrapper('learner-one') })
    // The row does not exist yet, so the dock is working from defaults --
    // logging water still round-trips through the same update-then-insert path.
    fireEvent.click(await screen.findByRole('button', { name: /log water/i }))
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalled())
    expect(mocks.insert).toHaveBeenCalledWith('wellness', expect.objectContaining({ user_id: 'learner-one', water_log: [expect.objectContaining({ kind: 'water' })] }))
  })

  it('renders the full dock with a heading', async () => {
    render(<Vertical />, { wrapper: wrapper('learner-one') })
    await screen.findByText('Wellness')
  })

  it('renders a thin expanded strip in horizontal orientation without the full heading', async () => {
    render(<Horizontal />, { wrapper: wrapper('learner-one') })
    await screen.findByRole('button', { name: /^water$/i })
    expect(screen.queryByText('Wellness')).toBeNull()
  })

  it('fetches prayer times with Doha coordinates by default', async () => {
    render(<Vertical />, { wrapper: wrapper('learner-one') })
    await act(async () => { await Promise.resolve() })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('latitude=25.2854')
  })

  it('uses device coordinates once useDeviceLocation is enabled and geolocation succeeds', async () => {
    db.row = { prefs: { useDeviceLocation: true }, water_log: [], pomodoro_sessions: [] }
    render(<Vertical />, { wrapper: wrapper('learner-one') })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    await vi.waitFor(() => {
      const called = fetchMock.mock.calls.some((call) => String(call[0]).includes('latitude=24.4667'))
      expect(called).toBe(true)
    })
  })

  it('gives the pomodoro card a scroll target for the buddy\'s "break" chip, in both vertical and horizontal orientations', async () => {
    const { rerender } = render(<Vertical />, { wrapper: wrapper('learner-one') })
    await screen.findByText('Wellness')
    expect(document.getElementById('pomodoro')).toBeTruthy()
    rerender(<Horizontal />)
    expect(document.getElementById('pomodoro')).toBeTruthy()
  })

  describe('settings', () => {
    it('changing the pomodoro work minutes persists it and the value survives a remount', async () => {
      const view = render(<Vertical />, { wrapper: wrapper('learner-one') })
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
      view.unmount()
      render(<Vertical />, { wrapper: wrapper('learner-one') })
      fireEvent.click(await screen.findByText('Settings'))
      const reloadedInput = await screen.findByRole('spinbutton', { name: /pomodoro work/i })
      expect(reloadedInput).toHaveProperty('value', '40')
    })

    it('ignores a non-numeric entry and keeps the previous value', async () => {
      render(<Vertical />, { wrapper: wrapper('learner-one') })
      fireEvent.click(await screen.findByText('Settings'))
      const workInput = await screen.findByRole('spinbutton', { name: /pomodoro work/i })
      fireEvent.change(workInput, { target: { value: 'abc' } })
      expect(workInput).toHaveProperty('value', '25')
    })

    it('toggles device location from the settings panel', async () => {
      render(<Vertical />, { wrapper: wrapper('learner-one') })
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

    it('changes the dock position from the settings panel and remembers it for the header re-open glyph', async () => {
      render(<Vertical />, { wrapper: wrapper('learner-one') })
      fireEvent.click(await screen.findByText('Settings'))
      const select = await screen.findByRole('combobox', { name: /dock position/i })
      fireEvent.change(select, { target: { value: 'left' } })
      await vi.waitFor(() => {
        expect(mocks.update).toHaveBeenCalledWith(
          'wellness',
          expect.objectContaining({ prefs: expect.objectContaining({ dock: expect.objectContaining({ placement: 'left' }) }) }),
          'user_id',
          'learner-one',
        )
      })
    })
  })

  describe('R6.1: five placements, R6.2: collapse', () => {
    it('renders the 56px icon rail when the vertical dock is collapsed, and expands it on click', async () => {
      const onToggleCollapse = vi.fn()
      render(<Dock orientation="vertical" collapsed onToggleCollapse={onToggleCollapse} corner="br" onCornerChange={noop} />, { wrapper: wrapper('learner-one') })
      expect(screen.queryByText('Wellness')).toBeNull()
      const icons = await screen.findAllByRole('button')
      expect(icons.length).toBeGreaterThan(0)
      fireEvent.click(icons[0])
      expect(onToggleCollapse).toHaveBeenCalled()
    })

    it('renders a single-line summary with a chevron when the horizontal dock is collapsed', async () => {
      const onToggleCollapse = vi.fn()
      render(<Dock orientation="horizontal" collapsed onToggleCollapse={onToggleCollapse} corner="br" onCornerChange={noop} />, { wrapper: wrapper('learner-one') })
      expect(screen.queryByText('Wellness')).toBeNull()
      fireEvent.click(await screen.findByRole('button', { name: /expand wellness dock/i }))
      expect(onToggleCollapse).toHaveBeenCalled()
    })

    it('renders the float placement as role=complementary with an accessible name, collapsed as a bare pill', async () => {
      render(<Dock orientation="pill" collapsed onToggleCollapse={noop} corner="br" onCornerChange={noop} />, { wrapper: wrapper('learner-one') })
      const region = await screen.findByRole('complementary', { name: 'Wellness' })
      expect(region).toBeTruthy()
      expect(screen.queryByText('Wellness', { selector: 'h2' })).toBeNull()
    })

    it('expands the float pill into a popover with the full dock content', async () => {
      render(<Dock orientation="pill" collapsed={false} onToggleCollapse={noop} corner="br" onCornerChange={noop} />, { wrapper: wrapper('learner-one') })
      await screen.findByText('Wellness')
      await screen.findByRole('switch', { name: /fajr reminder/i })
    })

    it('moves the float pill between corners on arrow keys, and ignores other keys', async () => {
      const onCornerChange = vi.fn()
      render(<Dock orientation="pill" collapsed onToggleCollapse={noop} corner="br" onCornerChange={onCornerChange} />, { wrapper: wrapper('learner-one') })
      const pill = await screen.findByRole('button', { name: /wellness dock/i })
      fireEvent.keyDown(pill, { key: 'ArrowLeft' })
      expect(onCornerChange).toHaveBeenCalledWith('bl')
      onCornerChange.mockClear()
      fireEvent.keyDown(pill, { key: 'Enter' })
      expect(onCornerChange).not.toHaveBeenCalled()
    })
  })

  describe('R6.4: reminders never interrupt an attempt', () => {
    it('shows a dock badge instead of a toast when a reminder fires during an active attempt', async () => {
      // `useAttemptActive` reads sessionStorage once at mount (then polls), so
      // the flag has to be set before the dock ever renders.
      sessionStorage.setItem(ATTEMPT_ACTIVE_KEY, 'true')
      const { rerender } = render(<Vertical />, { wrapper: wrapper('learner-one') })
      await screen.findByText('Wellness')
      expect(screen.queryByTestId('dock-badge')).toBeNull()

      // Jump the shared clock past the (default 45-minute) water interval --
      // WaterStretch's recurring timer was seeded at `now = 0` on first render.
      tickMocks.now.mockReturnValue(DEFAULT_WELLNESS.waterIntervalMin * 60_000)
      rerender(<Vertical />)

      await vi.waitFor(() => expect(screen.getByTestId('dock-badge')).toBeTruthy())
      expect(toast).not.toHaveBeenCalled()
      // Flushing the queue back into a toast once the attempt ends is covered by
      // WaterStretch.test.tsx/PrayerTimes.test.tsx/Pomodoro.test.tsx's own R6.4 cases.
    })
  })
})
