import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Development-only UI preview gallery. src/lib/supabase/middleware.ts only
 * guards /dashboard, /onboarding, /courses, /exercise, /derot, /reports and
 * /admin, so this route needs no auth bypass, only an environment gate: a
 * production build of this app must never ship this route.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  return children
}
