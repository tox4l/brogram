import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const protectedPage = /^\/(dashboard|onboarding|courses|exercise|derot|reports|admin)(?:\/|$)/.test(pathname)
  const exercisePage = /^\/exercise(?:\/|$)/.test(pathname)
  const pendingCookies = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const cacheHeaders = new Headers({ 'Cache-Control': 'private, no-store' })

  function finish(destination?: string) {
    // Read headers after getClaims: its cookie rotation must reach the Server Components too.
    const forwarded = new Headers(request.headers)
    forwarded.set('x-brogram-pathname', pathname)
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
    if (!protectedPage) return finish()
    const userId = data?.claims?.sub
    if (error || !userId) return finish('/login')

    // Layouts are reused during client navigation. Guard each exercise request as well.
    if (exercisePage) {
      const { error: liftError } = await supabase.rpc('lift_expired_restriction')
      if (liftError) return finish('/login?error=account-unavailable')
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('account_status, restricted_until').eq('id', userId).maybeSingle()
    if (profileError || !profile) return finish('/login?error=account-unavailable')
    if (profile.account_status === 'banned') return finish('/auth/signout')
    if (exercisePage && profile.account_status === 'restricted') return finish('/dashboard')
    return finish()
  } catch {
    return finish(protectedPage ? '/login?error=account-unavailable' : undefined)
  }
}
