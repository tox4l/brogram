import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Development-only UI preview gallery. The proxy (src/proxy.ts) runs
 * src/lib/supabase/middleware.ts's session refresh and ban/restrict gate on
 * ten prefixes -- /dashboard, /onboarding, /courses, /course, /lesson,
 * /exercise, /derot, /reports, /account and /admin -- but not on /preview, so
 * this route needs no auth bypass, only the environment gate below: this
 * layout 404s (via notFound()) whenever NODE_ENV !== 'development', so a
 * production build never serves it.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  return children
}
