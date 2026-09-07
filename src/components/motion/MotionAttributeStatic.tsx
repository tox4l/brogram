'use client'

import { useEffect } from 'react'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'

// W4FIX-B2 re-check (F3): two components can both write `data-motion` on an
// authenticated route -- this one (OS-only, mounted from `providers.tsx`,
// the root boundary every route including `(app)` renders through) and the
// prefs-aware `MotionAttribute` (mounted from `(app)/providers.tsx`). Each
// has its own effect keyed to its own resolved value, and an explicit
// preference wins over the OS in `resolveMotion` -- so the two effects are
// different functions of the same OS signal and can disagree. Before this
// fix, first mount was fine (this component renders before `{children}` in
// `providers.tsx`, so `MotionAttribute`'s effect flushes last and wins), but
// nothing kept it that way: an OS motion change mid-session (e.g. Windows'
// battery saver toggling "Animation effects") re-runs THIS component's
// effect with a new OS-only resolution, and since `MotionAttribute`'s own
// resolved value never changed, its effect never re-runs to correct the
// clobber -- a learner who set `wellness.prefs.motion = 'reduced'` could
// see `data-motion` flip back to `'full'` for the rest of that session.
//
// Fix: a module-level claim. While `MotionAttribute` is mounted (every
// authenticated route), it holds the claim and this component's effect
// bails out instead of writing -- the prefs-aware value always wins over
// the OS-only one whenever both are present. Once `MotionAttribute`
// unmounts (leaving an authenticated route), it releases the claim and
// re-asserts its own last-resolved value one more time, so `data-motion`
// does not silently revert to a stale OS-only write while it was
// suppressed; this component then resumes writing on the OS signal alone,
// which is the correct source of truth again once nobody is signed in.
let claimant: symbol | null = null

/**
 * Called by `MotionAttribute` while it is mounted. Returns a release
 * function; calling it un-claims ownership only if this exact claim is
 * still the current one (so an unmount race can never let a stale release
 * clobber a newer claim).
 */
export function claimMotionAttribute(): () => void {
  const token = Symbol('motion-attribute-claim')
  claimant = token
  return () => {
    if (claimant === token) claimant = null
  }
}

function isMotionAttributeClaimed(): boolean {
  return claimant !== null
}

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
    // F3: `MotionAttribute` (the prefs-aware writer) owns `data-motion`
    // while it is mounted -- do not clobber its resolved value with an
    // OS-only one just because the OS signal changed.
    if (isMotionAttributeClaimed()) return
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full'
  }, [reduced])

  return null
}
