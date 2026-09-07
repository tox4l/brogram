'use client'

import { useEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { QueryProvider } from '@/components/shell/QueryProvider'
import { THEME_STORAGE_KEY, THEMES } from '@/lib/theme/themes'
import { initSoundOnFirstGesture } from '@/lib/sound/manager'
import { MotionAttribute } from '@/components/motion/MotionAttribute'
import { VitalsCollector } from '@/lib/perf/VitalsCollector'

/**
 * Root client boundary (§8.2), outermost first: `ThemeProvider` ->
 * `QueryProvider` -> children. Sound and motion are module singletons
 * (T0.5), never context, so this only ever arms the sound manager's
 * first-gesture listener in a mount effect -- it does not read or provide
 * anything sound-related itself.
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
 * plus this attribute) needs the attribute written somewhere. It is written
 * by `<MotionAttribute>` (`src/components/motion/MotionAttribute.tsx`, see
 * its own header comment), mounted as the first child inside `QueryProvider`
 * rather than here: the attribute has to carry the RESOLVED preference
 * (`useReducedMotion(prefs.motion)`), and reading `wellness.prefs` needs a
 * TanStack Query hook, which needs `QueryClientProvider` in its tree -- one
 * boundary lower than this component sits.
 */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initSoundOnFirstGesture()
  }, [])

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
      <QueryProvider>
        <MotionAttribute />
        <VitalsCollector />
        {children}
      </QueryProvider>
    </ThemeProvider>
  )
}
