'use client'

import { useEffect } from 'react'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'

/**
 * W4FIX-B2: the OS-only half of `MotionAttribute`'s split. `MotionAttribute`
 * itself (`./MotionAttribute.tsx`) needs `QueryProvider` (it reads
 * `wellness.prefs.motion` through TanStack Query) and, before this lane,
 * needed the Supabase client too -- both real costs on `/` and `/login`,
 * which have no signed-in learner and so no in-app motion preference to
 * read in the first place. This component carries the same contract
 * (`:root[data-motion]` must be RESOLVED, standing constraint 12) for
 * exactly those routes: `useReducedMotion()` called with no argument
 * already means "system" (defer entirely to the OS query, see its own doc
 * comment), which is the correct and only resolution available before
 * sign-in. It needs no query client and no Supabase import, so it mounts
 * straight from `src/app/providers.tsx`, above `QueryProvider`.
 *
 * `(app)/layout.tsx` mounts the real, prefs-aware `<MotionAttribute />`
 * once a learner is signed in, which then owns `data-motion` for the rest
 * of that session -- this component keeps writing the OS signal underneath
 * it, harmlessly, since `(app)`'s own effect fires after and last.
 *
 * Renders nothing; side-effect only.
 */
export function MotionAttributeStatic(): null {
  const reduced = useReducedMotion()

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full'
  }, [reduced])

  return null
}
