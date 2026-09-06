import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundToggle } from './SoundToggle'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
}))

vi.mock('@/store/session', () => ({ useSession: () => mocks.session() }))
vi.mock('@/lib/sound/manager', () => ({ setEnabled: mocks.setEnabled, setVolume: mocks.setVolume }))
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
  mocks.select.mockResolvedValue({ data: { prefs: {} }, error: null })
  mocks.update.mockResolvedValue({ data: { user_id: 'learner-one' }, error: null })
  mocks.insert.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SoundToggle', () => {
  it('defaults to on before any signed-in prefs load', () => {
    mocks.session.mockReturnValue({ user: null })
    render(<SoundToggle />)
    const button = screen.getByRole('button', { name: /mute sound/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('loads a saved sound.enabled = false and syncs the manager', async () => {
    mocks.select.mockResolvedValue({ data: { prefs: { sound: { enabled: false, volume: 0.4, interface: false } } }, error: null })
    render(<SoundToggle />)
    await screen.findByRole('button', { name: /unmute sound/i })
    expect(mocks.setEnabled).toHaveBeenCalledWith(false)
    expect(mocks.setVolume).toHaveBeenCalledWith(0.4)
  })

  it('clicking toggles the accessible name, aria-pressed, and the sound manager immediately', async () => {
    render(<SoundToggle />)
    const button = await screen.findByRole('button', { name: /mute sound/i })
    expect(button.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(button)

    expect(mocks.setEnabled).toHaveBeenCalledWith(false)
    const toggled = await screen.findByRole('button', { name: /unmute sound/i })
    expect(toggled.getAttribute('aria-pressed')).toBe('false')
  })

  it('persists the toggle to wellness.prefs.sound.enabled via update, not upsert', async () => {
    render(<SoundToggle />)
    const button = await screen.findByRole('button', { name: /mute sound/i })
    fireEvent.click(button)

    await vi.waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(
        'wellness',
        expect.objectContaining({ prefs: expect.objectContaining({ sound: expect.objectContaining({ enabled: false }) }) }),
        'user_id',
        'learner-one',
      )
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('falls back to insert when the update reports no row', async () => {
    mocks.update.mockResolvedValue({ data: null, error: null })
    render(<SoundToggle />)
    const button = await screen.findByRole('button', { name: /mute sound/i })
    fireEvent.click(button)

    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalled())
    expect(mocks.insert).toHaveBeenCalledWith(
      'wellness',
      expect.objectContaining({ user_id: 'learner-one', prefs: expect.objectContaining({ sound: expect.objectContaining({ enabled: false }) }) }),
    )
  })

  it('never throws when the wellness fetch fails, and still toggles locally', async () => {
    mocks.select.mockRejectedValue(new Error('offline'))
    render(<SoundToggle />)
    const button = await screen.findByRole('button', { name: /mute sound/i })
    expect(() => fireEvent.click(button)).not.toThrow()
    await screen.findByRole('button', { name: /unmute sound/i })
  })
})
