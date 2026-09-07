'use client'

import { useEffect } from 'react'
import { initSoundOnFirstGesture } from '@/lib/sound/manager'
import { MotionAttribute } from '@/components/motion/MotionAttribute'

/**
 * W4FIX-B2: the authenticated-only half of what `src/app/providers.tsx`
 * used to mount for every route. The sound manager's first-gesture
 * listener and the prefs-aware `<MotionAttribute>` (it reads
 * `wellness.prefs.motion` through TanStack Query, and used to read
 * Supabase auth state too -- see that component's own header comment) are
 * both real weight that only `(app)/**` and the buddy drawer ever use:
 * every `play()` call site in the tree lives under an authenticated route,
 * and a signed-out visitor has no `wellness` row to read a motion
 * preference from in the first place. `src/app/providers.tsx` mounts
 * `<MotionAttributeStatic>` instead for `/` and `/login`.
 *
 * Mounted from `(app)/layout.tsx` as a `QueryProvider` sibling of
 * `QuerySeed`/`SessionProvider`, not a wrapper around `{children}`:
 * `MotionAttribute` needs `QueryProvider` (a moment up the tree) but
 * nothing here needs `SessionProvider`'s Zustand snapshot (`MotionAttribute`
 * reads auth from Supabase directly, by design -- its own header comment
 * explains why it cannot use `useSession()`), and staying a leaf keeps
 * `layout.test.tsx`'s `findChild` helper -- which reads only
 * `QueryProvider`'s DIRECT children by element type, no recursion --
 * finding `QuerySeed` and `SessionProvider` exactly where it always has.
 *
 * Renders `<MotionAttribute />` as its own output (not `null`) so this one
 * component covers both authenticated-only mounts without a second sibling
 * element.
 */
export function AppEffects() {
  useEffect(() => {
    initSoundOnFirstGesture()
  }, [])

  return <MotionAttribute />
}
