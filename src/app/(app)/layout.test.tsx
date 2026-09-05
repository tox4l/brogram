import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUserAndProfile: vi.fn(), maybeSingle: vi.fn(), pathname: '/dashboard' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-brogram-pathname': mocks.pathname }) }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, usePathname: () => mocks.pathname }))
vi.mock('@/lib/supabase/server', () => ({
  serverClient: async () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }),
  getUserAndProfile: mocks.getUserAndProfile,
}))

describe('app account gate', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.pathname = '/dashboard'
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    mocks.getUserAndProfile.mockResolvedValue({ user: { id: 'student' }, profile: { id: 'student', account_status: 'active', restricted_until: null } })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
  })
  afterEach(cleanup)

  async function layout() {
    const { default: Layout } = await import('./layout')
    return Layout({ children: <p>Protected child</p> })
  }

  it('redirects signed-out requests to login', async () => {
    mocks.getUserAndProfile.mockResolvedValue({ user: null, profile: null })
    await expect(layout()).rejects.toThrow('REDIRECT:/login')
  })

  it('lifts expired restrictions before reading the authoritative profile', async () => {
    mocks.getUserAndProfile.mockImplementation(async () => {
      expect(mocks.rpc).toHaveBeenCalledWith('lift_expired_restriction')
      return { user: { id: 'student' }, profile: { id: 'student', account_status: 'warned', restricted_until: '2026-09-01T00:00:00Z' } }
    })
    render(await layout())
    expect(screen.getByText('Protected child')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Type your own work')
  })

  it('sends banned accounts to cookie-writable sign-out without reading learner state', async () => {
    mocks.getUserAndProfile.mockResolvedValue({ user: { id: 'student' }, profile: { id: 'student', account_status: 'banned', restricted_until: null } })
    await expect(layout()).rejects.toThrow('REDIRECT:/auth/signout')
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('allows restricted dashboard access with the restriction expiry', async () => {
    mocks.getUserAndProfile.mockResolvedValue({ user: { id: 'student' }, profile: { id: 'student', account_status: 'restricted', restricted_until: '2026-09-06T18:00:00Z' } })
    render(await layout())
    expect(screen.getByText('Protected child')).toBeTruthy()
    const notice = screen.getByRole('status')
    expect(notice.textContent).toContain('Exercises are paused')
    expect(notice.querySelector('time')?.dateTime).toBe('2026-09-06T18:00:00Z')
  })

  it('redirects restricted exercise routes to dashboard', async () => {
    mocks.pathname = '/exercise/first'
    mocks.getUserAndProfile.mockResolvedValue({ user: { id: 'student' }, profile: { id: 'student', account_status: 'restricted', restricted_until: null } })
    await expect(layout()).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('fails closed when the restriction RPC fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    await expect(layout()).rejects.toThrow('Unable to check account access')
  })

  it('fails closed for a missing profile', async () => {
    mocks.getUserAndProfile.mockResolvedValue({ user: { id: 'student' }, profile: null })
    await expect(layout()).rejects.toThrow('Unable to load your profile')
  })
})
