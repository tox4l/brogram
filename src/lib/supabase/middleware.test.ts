// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { CookieMethodsServer } from '@supabase/ssr'
import { decodeProfileCache, encodeProfileCache, PROFILE_CACHE_COOKIE, PROFILE_CACHE_TTL_MS } from './profile-cache'

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

  it.each([
    '/dashboard', '/courses', '/derot', '/reports', '/onboarding', '/exercise/ex_1',
    // C3 correction: these three were not behind the gate at all before T1.6.
    '/account', '/course/C1', '/lesson/C1-1',
  ])(
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

  // Fix round 1, I7: this header is now `(app)/layout.tsx`'s sole source of
  // identity (T2.1). A future refactor of `finish()` that dropped the
  // `delete()` before the `set()` would have every other test in this file
  // still pass -- only a forged inbound value proves the strip actually happens.
  it('strips a forged x-brogram-user-id header, forwarding the verified claim instead', async () => {
    const response = await visit('/dashboard', { 'x-brogram-user-id': 'victim-uuid' })
    expect(response.headers.get('x-middleware-request-x-brogram-user-id')).toBe('student')
  })

  it('strips a forged x-brogram-user-email header, forwarding the verified claim instead', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'student', email: 'real@uni.edu.qa' } }, error: null })
    const response = await visit('/dashboard', { 'x-brogram-user-email': 'phisher@evil.example' })
    expect(response.headers.get('x-middleware-request-x-brogram-user-email')).toBe('real@uni.edu.qa')
  })

  it('forwards no email header at all when the verified claims carry none', async () => {
    const response = await visit('/dashboard', { 'x-brogram-user-email': 'forged@evil.example' })
    expect(response.headers.get('x-middleware-request-x-brogram-user-email')).toBeNull()
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

  // Fix round F1 (Opus review): `rpc` and `maybeSingle` now run concurrently
  // (`Promise.all`), so the mock-toggle trick in the test above proves
  // nothing about a real race -- both mocks resolve synchronously here. This
  // test instead makes the select itself return a row whose restriction has
  // already expired (the exact shape a genuine race would hand back on the
  // request that commits the lift), and asserts the gate does not act on --
  // or cache -- that stale value.
  it('reconciles a fresh read whose restricted_until has already passed to warned, instead of gating or caching the stale restricted value', async () => {
    const pastIso = new Date(Date.now() - 1000).toISOString()
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key')
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'student', account_status: 'restricted', restricted_until: pastIso }, error: null,
    })
    const response = await visit('/exercise/ex_1')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-request-x-brogram-account-status')).toBe('warned')
    const cookie = response.cookies.get(PROFILE_CACHE_COOKIE)
    expect(decodeProfileCache(cookie?.value, 'student')?.account_status).toBe('warned')
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

  it.each([
    '/dashboard', '/derot',
    // The restricted screen's copy promises dashboard, walkthroughs and De-rot stay
    // open — a restricted learner loses only /exercise. /course and /account too:
    // nothing about switching courses or account settings is an exercise.
    '/course/C1', '/lesson/C1-1', '/account',
  ])(
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

  // W2FIX-P: the ban/restrict gate used to cost every proxy-matched request a
  // fresh `rpc('lift_expired_restriction')` + `profiles` select, in series
  // (T3.2 report N2-1, ~500ms measured on a course-tile click). These tests
  // cover the signed cache cookie that buys that cost back everywhere except
  // the exercise route, and the security rulings that must survive it.
  describe('the signed profile-cache cookie', () => {
    const SERVICE_KEY = 'test-service-role-key'
    function cacheCookieHeader(account: { account_status: string; restricted_until: string | null }, opts?: { userId?: string; issuedAt?: number }) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
      const value = encodeProfileCache(
        opts?.userId ?? 'student',
        account as never,
        opts?.issuedAt ?? Date.now(),
      )
      return `${PROFILE_CACHE_COOKIE}=${value}`
    }

    beforeEach(() => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY)
    })

    it('serves a cached account status with no Supabase round trip at all, on a non-exercise page', async () => {
      const cookie = cacheCookieHeader({ account_status: 'active', restricted_until: null })
      const response = await visit('/dashboard', { cookie })
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.get('x-middleware-request-x-brogram-account-status')).toBe('active')
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(mocks.from).not.toHaveBeenCalled()
    })

    it('keeps a restricted-but-cached account on the dashboard, the same as a fresh restricted read would', async () => {
      const cookie = cacheCookieHeader({ account_status: 'restricted', restricted_until: '2099-09-06T00:00:00Z' })
      const dashboard = await visit('/dashboard', { cookie })
      expect(dashboard.headers.get('location')).toBeNull()
      expect(dashboard.headers.get('x-middleware-request-x-brogram-account-status')).toBe('restricted')
      expect(mocks.from).not.toHaveBeenCalled()
    })

    // Fix round F3 (Opus review, Minor): the ban gate reads `account`, which
    // is the cached value on a hit -- no existing test exercised a *cached*
    // banned status, so a future refactor that made the ban check fresh-only
    // could regress silently. Not exploitable today (a request that
    // discovers a ban clears the cookie in the same response), but pinning
    // it keeps the cache the sole authoritative source it already is.
    it('redirects a cached banned account to the sign-out handler with no Supabase round trip', async () => {
      const cookie = cacheCookieHeader({ account_status: 'banned', restricted_until: null })
      const response = await visit('/dashboard', { cookie })
      expect(response.headers.get('location')).toBe('https://brogram.test/auth/signout')
      expect(mocks.from).not.toHaveBeenCalled()
      expect(mocks.rpc).not.toHaveBeenCalled()
    })

    it('never trusts the cache on the exercise route, even when the cookie is fresh and says active', async () => {
      // The cookie says "active" (cached moments ago); the real account has
      // since been restricted. A restriction must bite immediately on
      // /exercise, so the stale-favorable cookie must never be read there.
      mocks.maybeSingle.mockResolvedValue({
        data: { id: 'student', account_status: 'restricted', restricted_until: '2099-09-06T00:00:00Z' }, error: null,
      })
      const cookie = cacheCookieHeader({ account_status: 'active', restricted_until: null })
      const response = await visit('/exercise/ex_1', { cookie })
      expect(response.headers.get('location')).toBe('https://brogram.test/dashboard')
      expect(mocks.from).toHaveBeenCalledTimes(1)
      expect(mocks.rpc).toHaveBeenCalledWith('lift_expired_restriction')
    })

    it('falls back to a fresh read when the cache cookie signature is tampered', async () => {
      const cookie = cacheCookieHeader({ account_status: 'active', restricted_until: null })
      const tampered = cookie.slice(0, -1) + (cookie.at(-1) === 'a' ? 'b' : 'a')
      mocks.maybeSingle.mockResolvedValue({
        data: { id: 'student', account_status: 'banned', restricted_until: null }, error: null,
      })
      const response = await visit('/dashboard', { cookie: tampered })
      // A tampered cookie can never win: the real (worse) status is used.
      expect(response.headers.get('location')).toBe('https://brogram.test/auth/signout')
      expect(mocks.from).toHaveBeenCalledTimes(1)
    })

    it('falls back to a fresh read when the cache cookie belongs to a different user id', async () => {
      const cookie = cacheCookieHeader({ account_status: 'active', restricted_until: null }, { userId: 'someone-else' })
      const response = await visit('/dashboard', { cookie })
      expect(response.headers.get('location')).toBeNull()
      expect(mocks.from).toHaveBeenCalledTimes(1)
    })

    it('falls back to a fresh read when the cache cookie has expired', async () => {
      const cookie = cacheCookieHeader(
        { account_status: 'active', restricted_until: null },
        { issuedAt: Date.now() - PROFILE_CACHE_TTL_MS - 1 },
      )
      const response = await visit('/dashboard', { cookie })
      expect(response.headers.get('location')).toBeNull()
      expect(mocks.from).toHaveBeenCalledTimes(1)
    })

    it('falls back to a fresh read when no cache cookie is present', async () => {
      const response = await visit('/dashboard')
      expect(response.headers.get('location')).toBeNull()
      expect(mocks.from).toHaveBeenCalledTimes(1)
    })

    it('writes a fresh signed cache cookie, httpOnly, after a cache miss', async () => {
      const response = await visit('/dashboard')
      const cookie = response.cookies.get(PROFILE_CACHE_COOKIE)
      expect(cookie).toBeDefined()
      expect(cookie?.httpOnly).toBe(true)
      expect(cookie?.maxAge).toBe(PROFILE_CACHE_TTL_MS / 1000)
    })

    it('never writes a cache cookie when SUPABASE_SERVICE_ROLE_KEY is not configured', async () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
      const response = await visit('/dashboard')
      expect(response.cookies.get(PROFILE_CACHE_COOKIE)).toBeUndefined()
    })

    it('starts the profile select without waiting for the lift rpc to settle (concurrent, not serial)', async () => {
      let resolveRpc: (value: { data: null; error: null }) => void = () => {}
      mocks.rpc.mockImplementation(() => new Promise((resolve) => { resolveRpc = resolve }))
      const pending = visit('/dashboard')
      // A serial implementation would never call `maybeSingle` until the rpc
      // promise above settles -- it never does in this test, so this only
      // resolves under a concurrent (Promise.all) implementation.
      await vi.waitFor(() => expect(mocks.maybeSingle).toHaveBeenCalled())
      resolveRpc({ data: null, error: null })
      const response = await pending
      expect(response.headers.get('location')).toBeNull()
    })

    it('clears the cache cookie on a signed-out visit', async () => {
      mocks.getClaims.mockResolvedValue({ data: null, error: null })
      const cookie = cacheCookieHeader({ account_status: 'active', restricted_until: null })
      const response = await visit('/login', { cookie })
      expect(response.cookies.get(PROFILE_CACHE_COOKIE)?.value).toBe('')
    })

    it('clears the cache cookie when a fresh read discovers the account banned', async () => {
      mocks.maybeSingle.mockResolvedValue({
        data: { id: 'student', account_status: 'banned', restricted_until: null }, error: null,
      })
      const response = await visit('/dashboard')
      expect(response.headers.get('location')).toBe('https://brogram.test/auth/signout')
      expect(response.cookies.get(PROFILE_CACHE_COOKIE)?.value).toBe('')
    })

    it('clears the cache cookie on a direct visit to the sign-out handler', async () => {
      const cookie = cacheCookieHeader({ account_status: 'active', restricted_until: null })
      const response = await visit('/auth/signout', { cookie })
      expect(response.cookies.get(PROFILE_CACHE_COOKIE)?.value).toBe('')
    })
  })
})
