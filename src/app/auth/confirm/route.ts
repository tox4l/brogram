import { NextRequest, NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login?error=invalid-link', request.url))
  response.headers.set('Cache-Control', 'private, no-store')
  const token_hash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')
  if (!token_hash || (type !== null && type !== 'email')) return response

  try {
    const supabase = createRouteClient(request, response)
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: 'email' })
    if (error || !data.user) return response

    const { data: learner, error: stateError } = await supabase
      .from('learner_state').select('state').eq('user_id', data.user.id).maybeSingle()
    const destination = stateError
      ? '/login?error=state-unavailable'
      : learner?.state?.profile?.onboardingComplete === true ? '/dashboard' : '/onboarding'
    response.headers.set('Location', new URL(destination, request.url).toString())
  } catch {
    response.headers.set('Location', new URL('/login?error=sign-in-unavailable', request.url).toString())
  }
  return response
}
