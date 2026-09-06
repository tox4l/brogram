// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { CookieMethodsServer } from '@supabase/ssr'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))

describe('Supabase request proxy', () => {
  let cookieAdapter: CookieMethodsServer

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'student' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'student', account_status: 'active', restricted_until: null }, error: null,
    })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('profiles')
      return { select: () => ({ eq: (column: string, id: string) => {
        expect([column, id]).toEqual(['id', 'student'])
        return { maybeSingle: mocks.maybeSingle }
      } }) }
    })
    mocks.createServerClient.mockImplementation((_url, _key, options: { cookies: CookieMethodsServer }) => {
      cookieAdapter = options.cookies
      return { auth: { getClaims: mocks.getClaims }, from: mocks.from, rpc: mocks.rpc }
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  async function visit(path: string, headers?: HeadersInit) {
    const { updateSession } = await import('./middleware')
    return updateSession(new NextRequest(`https://brogram.test${path}`, { headers }))
  }

  it.each(['/dashboard', '/courses', '/derot', '/reports', '/onboarding', '/exercise/ex_1'])(
    'redirects a signed-out visit to %s even when getClaims has no error', async (path) => {
      mocks.getClaims.mockResolvedValue({ data: null, error: null })
      const response = await visit(path)
      expect(response.headers.get('location')).toBe('https://brogram.test/login')
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )

  it.each(['/login', '/auth/confirm?token_hash=hash&type=email', '/auth/signout'])(
    'allows public authentication path %s when signed out', async (path) => {
      mocks.getClaims.mockResolvedValue({ data: null, error: null })
      const response = await visit(path)
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )

  it('replaces a spoofed pathname header before forwarding the request', async () => {
    const response = await visit('/dashboard', { 'x-brogram-pathname': '/exercise/forged' })
    expect(response.headers.get('x-middleware-request-x-brogram-pathname')).toBe('/dashboard')
    expect(response.headers.get('x-brogram-pathname')).toBeNull()
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects a valid signed-in login visit before the public-path return', async () => {
    expect((await visit('/login')).headers.get('location')).toBe('https://brogram.test/dashboard')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('renders account recovery after a failed profile read instead of looping through dashboard', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Database unavailable' } })
    const first = await visit('/dashboard')
    expect(first.headers.get('location')).toBe('https://brogram.test/login?error=account-unavailable')
    const recovery = await visit('/login?error=account-unavailable')
    expect(recovery.headers.get('location')).toBeNull()
  })

  it('overwrites forged account headers with the single authoritative profile read', async () => {
    const response = await visit('/dashboard', { 'x-brogram-account-status': 'banned', 'x-brogram-restricted-until': 'forged' })
    expect(response.headers.get('x-middleware-request-x-brogram-account-status')).toBe('active')
    expect(response.headers.get('x-middleware-request-x-brogram-restricted-until')).toBe('')
    expect(mocks.from).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('lift_expired_restriction')
  })

  it('retains refreshed cookies and SSR cache headers on a signed-out redirect', async () => {
    mocks.getClaims.mockImplementation(async () => {
      await cookieAdapter.setAll!([
        { name: 'sb-session', value: 'rotated', options: { path: '/', httpOnly: true, sameSite: 'lax' } },
        { name: 'sb-session.1', value: '', options: { path: '/', maxAge: 0 } },
      ], {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0',
        Expires: '0',
        Pragma: 'no-cache',
      })
      return { data: null, error: null }
    })
    const response = await visit('/dashboard', { cookie: 'sb-session=old; sb-session.1=old-chunk' })
    expect(response.headers.get('location')).toBe('https://brogram.test/login')
    expect(response.cookies.get('sb-session')).toMatchObject({ value: 'rotated', httpOnly: true, path: '/' })
    expect(response.cookies.get('sb-session.1')).toMatchObject({ value: '', maxAge: 0 })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('expires')).toBe('0')
    expect(response.headers.get('pragma')).toBe('no-cache')
  })

  it('forwards the refreshed session cookie to the Server Components', async () => {
    mocks.getClaims.mockImplementation(async () => {
      await cookieAdapter.setAll!([
        { name: 'sb-session', value: 'rotated', options: { path: '/' } },
      ], { 'Cache-Control': 'private, no-store' })
      return { data: { claims: { sub: 'student' } }, error: null }
    })
    const response = await visit('/dashboard', { cookie: 'sb-session=old' })
    expect(response.headers.get('x-middleware-request-cookie')).toContain('sb-session=rotated')
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
  })

  it('sends a banned account to the cookie-writable sign-out handler', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'student', account_status: 'banned', restricted_until: null }, error: null,
    })
    const response = await visit('/dashboard')
    expect(response.headers.get('location')).toBe('https://brogram.test/auth/signout')
  })

  it('lifts expired restrictions before checking exercise access', async () => {
    let lifted = false
    mocks.rpc.mockImplementation(async (name: string) => {
      expect(name).toBe('lift_expired_restriction')
      lifted = true
      return { data: null, error: null }
    })
    mocks.maybeSingle.mockImplementation(async () => ({
      data: { id: 'student', account_status: lifted ? 'warned' : 'restricted', restricted_until: '2026-09-04T00:00:00Z' },
      error: null,
    }))
    const response = await visit('/exercise/ex_1')
    expect(response.headers.get('location')).toBeNull()
    expect(lifted).toBe(true)
  })

  it.each(['/exercise/ex_1', '/exercise/ex_1/review'])(
    'redirects a currently restricted exercise visit %s to the dashboard', async (path) => {
      mocks.maybeSingle.mockResolvedValue({
        data: { id: 'student', account_status: 'restricted', restricted_until: '2099-09-06T00:00:00Z' }, error: null,
      })
      const response = await visit(path)
      expect(response.headers.get('location')).toBe('https://brogram.test/dashboard')
    },
  )

  it.each(['/dashboard', '/derot'])(
    'keeps %s open for a restricted account', async (path) => {
      mocks.maybeSingle.mockResolvedValue({
        data: { id: 'student', account_status: 'restricted', restricted_until: '2099-09-06T00:00:00Z' }, error: null,
      })
      expect((await visit(path)).headers.get('location')).toBeNull()
    },
  )

  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'Database unavailable' } },
  ])('fails closed when the account profile is unavailable: %j', async (result) => {
    mocks.maybeSingle.mockResolvedValue(result)
    expect((await visit('/dashboard')).headers.get('location'))
      .toBe('https://brogram.test/login?error=account-unavailable')
  })

  it('fails closed if lifting an exercise restriction fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Database unavailable' } })
    expect((await visit('/exercise/ex_1')).headers.get('location'))
      .toBe('https://brogram.test/login?error=account-unavailable')
  })

  it('redirects protected pages to a configuration message without configured Supabase', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect((await visit('/dashboard')).headers.get('location'))
      .toBe('https://brogram.test/login?error=configuration')
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })

  it('allows the login page to render without configured Supabase', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect((await visit('/login')).headers.get('location')).toBeNull()
    expect(mocks.createServerClient).not.toHaveBeenCalled()
  })
})
