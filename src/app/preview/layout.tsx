import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { QueryProvider } from '@/components/shell/QueryProvider'

/**
 * Development-only UI preview gallery. The proxy (src/proxy.ts) runs
 * src/lib/supabase/middleware.ts's session refresh and ban/restrict gate on
 * ten prefixes -- /dashboard, /onboarding, /courses, /course, /lesson,
 * /exercise, /derot, /reports, /account and /admin -- but not on /preview, so
 * this route needs no auth bypass, only the environment gate below: this
 * layout 404s (via notFound()) whenever NODE_ENV !== 'development', so a
 * production build never serves it.
 *
 * W4FIX-B2 re-check (F1): `/preview` renders the authenticated shell's own
 * sections (`WellnessBuddySection`'s `<BuddyDrawer>` -- `useQueryClient` plus
 * two `useQuery` calls -- and `ShellDashboardSection`'s `<AppShell>`) with no
 * `QueryClientProvider` above them anywhere in this route's own tree: the
 * root `Providers` (`src/app/providers.tsx`) stopped mounting one once
 * `QueryProvider` moved to `(app)/layout.tsx` only, and `/preview` sits
 * outside `(app)` entirely. Every `useQuery`/`useQueryClient` call on this
 * page was throwing ("No QueryClient set") before this wrap, caught by
 * React and rendered as a `role="alert"` boundary instead of the gallery
 * section it names -- `src/app/preview/page.test.tsx`'s own "renders every
 * gallery section heading" test never noticed because it doesn't scan for
 * `role="alert"` at all. `QueryProvider` here is deliberately its own client
 * (`getQueryClient()`'s browser singleton), never seeded with any real
 * data -- this is a dev-only visual gallery, not an authenticated route, so
 * every query underneath renders its own loading/empty state, which is the
 * correct thing for a component gallery to show.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <QueryProvider>{children}</QueryProvider>
}
