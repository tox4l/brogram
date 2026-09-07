'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/lib/query/keys'
import type { WellnessRow } from '@/lib/learner/compile'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { claimMotionAttribute } from '@/components/motion/MotionAttributeStatic'

// W4FIX-B: `@/lib/supabase/client` (a thin wrapper over
// `createBrowserClient` from `@supabase/ssr`) used to be a top-level import
// here. `MotionAttribute` mounts inside `Providers`, the root client
// boundary every single route renders -- so that pulled the ~230 KB
// `@supabase/supabase-js` + `@supabase/ssr` pair into the entry chunk of
// `/`, `/admin` and `/preview` too, none of which otherwise touch Supabase
// on the client at all (confirmed: rebuilding with the import restored
// puts the exact same 231,786-byte chunk, `supabase-js`/`gotrue`/`@supabase/ssr`
// strings and all, back in `/`'s `entryJSFiles`). A dynamic `import()`
// inside the effect below defers that chunk to routes that actually need
// it (every route already loads it synchronously elsewhere once a learner
// is signed in -- `SessionProvider`, `/login`'s own sign-in flow -- so this
// changes nothing for those; it only stops `/`, `/admin` and `/preview`
// from paying for it before a single Supabase call has ever been made).
async function fetchWellnessRow(userId: string): Promise<WellnessRow> {
  const { createClient } = await import('@/lib/supabase/client')
  const client = createClient()
  const { data, error } = await client
    .from('wellness')
    .select('user_id,prefs,pomodoro_sessions,water_log,drill_results,updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error('Unable to load your wellness settings', { cause: error })
  return (data as WellnessRow | null) ?? {}
}

/**
 * Deliberately NOT `useSession()`/`useWellness()` (`src/lib/query/hooks.ts`).
 * Those need `SessionContext`, which only exists inside `(app)/layout.tsx`'s
 * own `<SessionProvider>` -- a file T4.2 does not own, nested INSIDE the
 * `{children}` this module's `<MotionAttribute>` sits beside at the root
 * `Providers` boundary. A component mounted there structurally cannot see a
 * provider nested deeper in `children`'s own subtree (calling the throwing
 * `useSession()` from here crashes every route with no such provider --
 * `(auth)`, `/`, `/_not-found`, `/preview` -- which is how this shipped
 * broken the first time: `npm run build` failing on `/_not-found`).
 *
 * Reads the signed-in user id straight from Supabase's own client-side auth
 * state instead, which is genuinely global and not tied to render position,
 * then queries under the EXACT SAME cache key `(app)/layout.tsx`'s
 * `QuerySeed` already seeds (`qk.wellness(userId)`, `staleTime: Infinity`,
 * the same singleton `QueryClient` both `QueryProvider` instances share) --
 * so this never double-fetches against an authenticated route; it only ever
 * hits the network on a route `(app)/layout.tsx` never rendered for this
 * user in this session (or before its result lands).
 */
function useAuthUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    import('@/lib/supabase/client').then(({ createClient }) => {
      if (cancelled) return
      const supabase = createClient()

      supabase.auth.getUser().then(({ data }) => {
        if (!cancelled) setUserId(data.user?.id ?? null)
      })

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setUserId(session?.user?.id ?? null)
      })
      unsubscribe = () => subscription.unsubscribe()
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return userId
}

/**
 * Correction W2's other half: `:root[data-motion]` must carry the RESOLVED
 * motion preference, not the raw OS media query, or a learner who sets
 * `wellness.prefs.motion = 'reduced'` on a machine whose OS reports no
 * preference gets `data-motion="full"` -- a no-op that leaves `globals.css`'s
 * `:root[data-motion='reduced'] ::view-transition-*` kill switch unreachable
 * even though every component's own `useReducedMotion(prefs.motion)` call
 * has already gone quiet.
 *
 * Mounted from `AppEffects` (`src/app/(app)/providers.tsx`), inside
 * `(app)/layout.tsx`'s own `QueryProvider` -- not the root `Providers` in
 * `src/app/providers.tsx`, which sits above any `QueryProvider` and cannot
 * read a query result at all. `src/app/providers.tsx` mounts the OS-only
 * `MotionAttributeStatic` (`./MotionAttributeStatic.tsx`) instead for `/`
 * and `/login`, which need no query client and no Supabase client to
 * resolve `data-motion` before anyone has signed in.
 *
 * F3 (W4FIX-B2 re-check): `MotionAttributeStatic` also writes `data-motion`
 * on every route (it is mounted from the root boundary every route
 * renders), so while this component is mounted it claims ownership via
 * `claimMotionAttribute()` -- otherwise an OS motion change mid-session
 * (e.g. a laptop's battery saver toggling) re-runs `MotionAttributeStatic`'s
 * own effect and clobbers this component's prefs-aware resolution with a
 * plain OS-only one, even though nothing this component reads has changed.
 * Releasing the claim on unmount re-asserts this component's own last
 * resolved value once more, so `data-motion` does not silently revert to a
 * stale OS-only write in the gap before `MotionAttributeStatic` next
 * re-runs on its own.
 *
 * Renders nothing; side-effect only.
 */
export function MotionAttribute(): null {
  const userId = useAuthUserId()
  const wellnessQuery = useQuery({
    queryKey: qk.wellness(userId ?? ''),
    queryFn: () => fetchWellnessRow(userId as string),
    enabled: userId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const reduced = useReducedMotion(prefs.motion)

  useEffect(() => {
    const release = claimMotionAttribute()
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full'
    return () => {
      release()
      // Re-assert this component's own resolved value one more time on the
      // way out, so `data-motion` keeps reading the learner's preference
      // until `MotionAttributeStatic` next re-runs on its own (an OS
      // change), rather than reverting to whatever it last silently
      // computed while its writes were suppressed.
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full'
    }
  }, [reduced])

  return null
}
