import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/dashboard/:path*', '/onboarding/:path*', '/courses/:path*', '/course/:path*',
    '/lesson/:path*', '/exercise/:path*', '/derot/:path*', '/reports/:path*',
    '/account/:path*', '/admin/:path*', '/login', '/auth/:path*',
  ],
}
