import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import type { AccountStatus } from '@/lib/contracts'
import { decodeProfileCache, encodeProfileCache, PROFILE_CACHE_COOKIE, PROFILE_CACHE_TTL_MS } from './profile-cache'

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  // C3 correction: `/account`, `/course` and `/lesson` were missing here, so
  // session refresh and the ban/restrict gate never ran on them at all.
  const protectedPage = /^\/(dashboard|onboarding|courses|course|lesson|exercise|derot|reports|account|admin)(?:\/|$)/.test(pathname)
  const exercisePage = /^\/exercise(?:\/|$)/.test(pathname)
  // W2FIX-P: BroGram's own cookie-writable sign-out handler (see the test
  // "sends a banned account to the cookie-writable sign-out handler" below).
  // A request headed there, or arriving there directly, must never leave the
  // previous account's cached status behind for whatever session follows on
  // the same browser.
  const signOutPage = /^\/auth\/signout(?:\/|$)/.test(pathname)
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const cacheHeaders = new Headers({ 'Cache-Control': 'private, no-store' })
  let account: { account_status: AccountStatus; restricted_until: string | null } | null = null
  // Set as soon as `getClaims` verifies the session, below — forwarded so
  // `(app)/layout.tsx` never has to call `auth.getUser()` a second time just
  // to learn who is signed in (T2.1).
  let userId: string | undefined
  // Fix round 1 (C1): `getClaims()` already carries the email in the same
  // verified claims as `sub` -- without forwarding it too, the layout's
  // replacement `User` stub has no email at all, and /account permanently
  // falls back to "Your account email is unavailable."
  let userEmail: string | undefined

  function finish(destination?: string) {
    // Read headers after getClaims: its cookie rotation must reach the Server Components too.
    const forwarded = new Headers(request.headers)
    forwarded.set('x-brogram-pathname', pathname)
    // Always overwrite inbound values; these headers are trusted only inside the app.
    forwarded.delete('x-brogram-account-status')
    forwarded.delete('x-brogram-restricted-until')
    forwarded.delete('x-brogram-user-id')
    forwarded.delete('x-brogram-user-email')
    if (account) {
      forwarded.set('x-brogram-account-status', account.account_status)
      forwarded.set('x-brogram-restricted-until', account.restricted_until ?? '')
    }
    if (userId) forwarded.set('x-brogram-user-id', userId)
    if (userEmail) forwarded.set('x-brogram-user-email', userEmail)
    const response = destination
      ? NextResponse.redirect(new URL(destination, request.url))
      : NextResponse.next({ request: { headers: forwarded } })
    for (const cookie of pendingCookies.values()) response.cookies.set(cookie.name, cookie.value, cookie.options)
    // W2FIX-P: no verified session, headed to the sign-out handler, or
    // already there -- in every case the cached profile cookie must not
    // survive into whatever session follows on this browser. Set *after*
    // the loop above so it wins over a same-request fresh cache write
    // (e.g. a request that just discovered the account is banned).
    if (!userId || signOutPage || destination === '/auth/signout') {
      response.cookies.set(PROFILE_CACHE_COOKIE, '', { path: '/', maxAge: 0 })
    }
    cacheHeaders.forEach((value, key) => response.headers.set(key, value))
    return response
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return finish(protectedPage ? '/login?error=configuration' : undefined)

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies, headers) => {
          for (const cookie of cookies) {
            request.cookies.set(cookie.name, cookie.value)
            pendingCookies.set(cookie.name, cookie)
          }
          for (const [name, value] of Object.entries(headers)) cacheHeaders.set(name, value)
        },
      },
    })
    const { data, error } = await supabase.auth.getClaims()
    userId = data?.claims?.sub
    userEmail = typeof data?.claims?.email === 'string' ? data.claims.email : undefined
    // Keep the recovery page reachable when a valid identity cannot load its account.
    const recoveringAccount = request.nextUrl.searchParams.get('error') === 'account-unavailable'
    if (pathname === '/login' && !recoveringAccount && !error && userId) return finish('/dashboard')
    if (!protectedPage) return finish()
    if (error || !userId) return finish('/login')

    // W2FIX-P (T3.2 report N2-1): this used to be a fresh
    // `rpc('lift_expired_restriction')` then a `profiles` select, in series,
    // on *every* proxy-matched request -- two real network round trips to
    // the production Supabase project (~500ms measured) before a route that
    // reads nothing else from Supabase (e.g. `/course/[code]`) could render
    // anything. `exercisePage` is the one place a *new* restriction must
    // bite the instant it lands (an open exercise tab reruns this on every
    // request), so it alone always pays for a fresh pair of reads, run
    // concurrently rather than serially. Everywhere else, a read at most
    // `PROFILE_CACHE_TTL_MS` old is what the signed cookie below buys back:
    // caching can only make enforcement *stricter* late (a ban committed
    // mid-window is picked up within the TTL, never skipped), never more
    // lenient than the account's last real state.
    const cached = exercisePage
      ? null
      : decodeProfileCache(request.cookies.get(PROFILE_CACHE_COOKIE)?.value, userId)
    if (cached) {
      account = cached
    } else {
      const [{ error: liftError }, { data: profile, error: profileError }] = await Promise.all([
        supabase.rpc('lift_expired_restriction'),
        supabase.from('profiles').select('account_status, restricted_until').eq('id', userId).maybeSingle(),
      ])
      if (liftError) return finish('/login?error=account-unavailable')
      if (profileError || !profile) return finish('/login?error=account-unavailable')
      // Fix round F1 (Opus review): the select above now races
      // `lift_expired_restriction` (supabase/migrations/0001_init.sql:139-142,
      // `restricted -> warned` once `restricted_until < now()`) instead of
      // running after it, so the very request whose Promise.all just
      // committed the lift can still read the pre-lift row back. The lift's
      // rule is a pure function of the row just read, so reconcile locally
      // rather than re-reading: this keeps the concurrency the brief
      // requires while never caching or gating on a status the DB has
      // already superseded.
      const expiredNow = Date.now()
      const restrictionExpired = profile.account_status === 'restricted'
        && profile.restricted_until !== null
        && Date.parse(profile.restricted_until) <= expiredNow
      account = restrictionExpired
        ? { account_status: 'warned', restricted_until: profile.restricted_until }
        : profile
      const encoded = encodeProfileCache(userId, account)
      if (encoded) {
        pendingCookies.set(PROFILE_CACHE_COOKIE, {
          name: PROFILE_CACHE_COOKIE,
          value: encoded,
          options: {
            path: '/', httpOnly: true, sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: PROFILE_CACHE_TTL_MS / 1000,
          },
        })
      }
    }
    if (account.account_status === 'banned') return finish('/auth/signout')
    // The restricted screen's own copy promises the learner keeps dashboard,
    // walkthroughs and De-rot and loses only exercises — so this stays scoped
    // to `exercisePage` alone. Widening `protectedPage` above to cover
    // `/account`, `/course` and `/lesson` must never widen this too.
    if (exercisePage && account.account_status === 'restricted') return finish('/dashboard')
    return finish()
  } catch {
    return finish(protectedPage ? '/login?error=account-unavailable' : undefined)
  }
}
