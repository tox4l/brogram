import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  // C3 correction: `/account`, `/course` and `/lesson` were missing here, so
  // session refresh and the ban/restrict gate never ran on them at all.
  const protectedPage = /^\/(dashboard|onboarding|courses|course|lesson|exercise|derot|reports|account|admin)(?:\/|$)/.test(pathname)
  const exercisePage = /^\/exercise(?:\/|$)/.test(pathname)
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const cacheHeaders = new Headers({ 'Cache-Control': 'private, no-store' })
  let account: { account_status: string; restricted_until: string | null } | null = null
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

    // Layouts are reused during client navigation. Guard each exercise request as well.
    const { error: liftError } = await supabase.rpc('lift_expired_restriction')
    if (liftError) return finish('/login?error=account-unavailable')
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('account_status, restricted_until').eq('id', userId).maybeSingle()
    if (profileError || !profile) return finish('/login?error=account-unavailable')
    account = profile
    if (profile.account_status === 'banned') return finish('/auth/signout')
    // The restricted screen's own copy promises the learner keeps dashboard,
    // walkthroughs and De-rot and loses only exercises — so this stays scoped
    // to `exercisePage` alone. Widening `protectedPage` above to cover
    // `/account`, `/course` and `/lesson` must never widen this too.
    if (exercisePage && profile.account_status === 'restricted') return finish('/dashboard')
    return finish()
  } catch {
    return finish(protectedPage ? '/login?error=account-unavailable' : undefined)
  }
}
