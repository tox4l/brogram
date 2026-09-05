// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  createRouteClient: vi.fn(),
  getClaims: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createRouteClient: mocks.createRouteClient }))

describe('banned account sign-out route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'student' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'student', account_status: 'banned', restricted_until: null }, error: null,
    })
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('profiles')
      return { select: () => ({ eq: (column: string, id: string) => {
        expect([column, id]).toEqual(['id', 'student'])
        return { maybeSingle: mocks.maybeSingle }
      } }) }
    })
    mocks.createRouteClient.mockImplementation((_request: NextRequest, response: NextResponse) => {
      mocks.signOut.mockImplementation(async () => {
        response.cookies.set('sb-session', '', { path: '/', maxAge: 0, httpOnly: true })
        response.headers.set('cache-control', 'private, no-cache, no-store, must-revalidate, max-age=0')
        return { error: null }
      })
      return { auth: { getClaims: mocks.getClaims, signOut: mocks.signOut }, from: mocks.from }
    })
  })

  async function signOut() {
    const { GET } = await import('./route')
    return GET(new NextRequest('https://brogram.test/auth/signout'))
  }

  it('clears a banned session before redirecting to the appeal message', async () => {
    const response = await signOut()
    expect(response.headers.get('location')).toBe('https://brogram.test/login?reason=banned')
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(response.cookies.get('sb-session')).toMatchObject({ value: '', maxAge: 0, httpOnly: true })
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it.each(['active', 'warned', 'restricted'])(
    'does not sign out a %s account through the banned-account handler', async (account_status) => {
      mocks.maybeSingle.mockResolvedValue({ data: { id: 'student', account_status, restricted_until: null }, error: null })
      const response = await signOut()
      expect(response.headers.get('location')).toBe('https://brogram.test/dashboard')
      expect(mocks.signOut).not.toHaveBeenCalled()
    },
  )

  it('sends an already signed-out user to login', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    const response = await signOut()
    expect(response.headers.get('location')).toBe('https://brogram.test/login')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'Database unavailable' } },
  ])('does not claim a ban when profile verification fails: %j', async (result) => {
    mocks.maybeSingle.mockResolvedValue(result)
    expect((await signOut()).headers.get('location'))
      .toBe('https://brogram.test/login?error=account-unavailable')
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('shows account-unavailable if client creation fails', async () => {
    mocks.createRouteClient.mockImplementation(() => { throw new Error('Configuration unavailable') })
    expect((await signOut()).headers.get('location'))
      .toBe('https://brogram.test/login?error=account-unavailable')
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('does not claim sign-out succeeded when the auth client cannot clear the session', async () => {
    mocks.createRouteClient.mockImplementation(() => {
      mocks.signOut.mockResolvedValue({ error: { message: 'Session refresh failed' } })
      return { auth: { getClaims: mocks.getClaims, signOut: mocks.signOut }, from: mocks.from }
    })
    expect((await signOut()).headers.get('location'))
      .toBe('https://brogram.test/login?error=account-unavailable')
  })
})
