import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase/server'

/** Only a verified ban can sign a user out through this GET endpoint. */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url))
  response.headers.set('Cache-Control', 'private, no-store')
  const location = (path: string) => response.headers.set('Location', new URL(path, request.url).toString())

  try {
    const supabase = createRouteClient(request, response)
    const { data, error } = await supabase.auth.getClaims()
    if (error || !data?.claims?.sub) return response
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('account_status').eq('id', data.claims.sub).maybeSingle()
    if (profileError || !profile) location('/login?error=account-unavailable')
    else if (profile.account_status !== 'banned') location('/dashboard')
    else {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      location(signOutError ? '/login?error=account-unavailable' : '/login?reason=banned')
    }
  } catch {
    location('/login?error=account-unavailable')
  }
  return response
}
