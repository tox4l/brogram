'use client'

import type { ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { THEME_STORAGE_KEY, THEMES } from '@/lib/theme/themes'
import { MotionAttributeStatic } from '@/components/motion/MotionAttributeStatic'
import { VitalsCollector } from '@/lib/perf/VitalsCollector'

/**
 * Root client boundary (§8.2): `ThemeProvider` only, now -- `/` and
 * `/login` are the only routes that ever mount this file (every
 * authenticated route also renders `(app)/layout.tsx`'s own boundary, one
 * level in), so nothing an authenticated route alone needs belongs here.
 *
 * W4FIX-B2: `QueryProvider` and the sound manager's first-gesture listener
 * used to mount here too. Neither `/` nor `/login` reads a TanStack Query
 * hook or plays a sound (every `play()` call site and every `useQuery` in
 * the tree lives under `(app)/**` or the buddy drawer, which only ever
 * renders inside `(app)`), so both were pure entry-chunk weight on the two
 * routes that need them least -- the bundle lane's review measured this as
 * part of `/`'s and `/login`'s residual overage. Both now mount from
 * `src/app/(app)/providers.tsx` (`AppEffects`), a sibling of `(app)/layout.tsx`,
 * alongside the `QueryProvider` that layout already renders for its own
 * authenticated data seed.
 *
 * `MotionAttributeStatic` replaces the prefs-aware `<MotionAttribute>` for
 * the same reason (its own header comment): it needs no `QueryClientProvider`
 * and no Supabase client, only `useReducedMotion()`'s OS-only resolution,
 * which is the correct answer before anyone has signed in. `(app)/providers.tsx`
 * mounts the real, prefs-aware `<MotionAttribute>` once a learner is signed in.
 *
 * W4FIX-B: this module imports nothing that imports gsap. It used to call
 * `registerEases()` here at module scope, which pulled gsap + `@gsap/react`
 * + `CustomEase`/`SplitText`/`Flip` into this file's own module graph --
 * and since `Providers` is the root client boundary every single route
 * mounts, that put gsap in the entry chunk of every route, animated or not
 * (confirmed: `0cn5acooblm1q.js`, 70.9 KB of gsap + plugins, sat in the
 * root layout's own `entryJSFiles` and in literally every route's built
 * manifest, `/` and `/login` included). `src/lib/motion/eases.ts` now
 * exports a lazy `loadGsap()` instead of registering anything at import
 * time; the components that actually animate (`Reveal`,
 * `useFlipIndicator`) call it from inside their own effects, on first use,
 * and skip it entirely under reduced motion.
 *
 * Correction W2: `:root[data-motion]` is the reduced-motion kill switch
 * `<ViewTransition>` needs, because React does not read the in-app
 * override -- an override is React state, not a media query, so
 * `globals.css`'s two-selector kill switch (`@media (prefers-reduced-motion)`
 * plus this attribute) needs the attribute written somewhere.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      // T4.0 fix round 3 (F3/M2, granted for this one line): derived from
      // the registry rather than hand-enumerated, so a sixth palette added
      // to `THEMES` cannot leave this array silently stale the way it did
      // for `eclipse` before this fix.
      themes={THEMES.map((t) => t.id)}
      defaultTheme="midnight"
      enableSystem={false}
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <MotionAttributeStatic />
      <VitalsCollector />
      {children}
    </ThemeProvider>
  )
}
