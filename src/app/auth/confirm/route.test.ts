// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn(), from: vi.fn(), maybeSingle: vi.fn(), createRouteClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createRouteClient: mocks.createRouteClient }))

describe('magic link confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: 'student' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.from.mockImplementation((table) => {
      expect(table).toBe('learner_state')
      return { select: () => ({ eq: (key: string, id: string) => {
        expect([key, id]).toEqual(['user_id', 'student'])
        return { maybeSingle: mocks.maybeSingle }
      } }) }
    })
    mocks.createRouteClient.mockImplementation((_request, response) => {
      response.cookies.set('sb-session', 'refreshed', { httpOnly: true })
      return { auth: { verifyOtp: mocks.verifyOtp }, from: mocks.from }
    })
  })

  async function confirm(query = '?token_hash=one-use-hash&type=email') {
    const { GET } = await import('./route')
    return GET(new NextRequest(`https://brogram.test/auth/confirm${query}`))
  }

  it.each([
    [null, '/onboarding'],
    [{ state: { profile: { onboardingComplete: false } } }, '/onboarding'],
    [{ state: { profile: { onboardingComplete: true } } }, '/dashboard'],
  ])('routes the persisted onboarding state %j to %s', async (row, destination) => {
    mocks.maybeSingle.mockResolvedValue({ data: row, error: null })
    const response = await confirm()
    expect(response.headers.get('location')).toBe(`https://brogram.test${destination}`)
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'one-use-hash', type: 'email' })
    expect(response.cookies.get('sb-session')?.value).toBe('refreshed')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it.each(['', '?token_hash=x&type=recovery'])('rejects invalid links without exchanging them: %s', async (query) => {
    const response = await confirm(query)
    expect(response.headers.get('location')).toBe('https://brogram.test/login?error=invalid-link')
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('does not query learner state after OTP rejection', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    expect((await confirm()).headers.get('location')).toContain('/login?error=invalid-link')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not mistake a database failure for a new learner', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    expect((await confirm()).headers.get('location')).toBe('https://brogram.test/login?error=state-unavailable')
  })

  it('ignores arbitrary redirect targets in a link', async () => {
    expect((await confirm('?token_hash=one-use-hash&type=email&next=https://evil.test')).headers.get('location'))
      .toBe('https://brogram.test/onboarding')
  })
})
