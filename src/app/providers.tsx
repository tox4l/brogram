'use client'

import { useEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { QueryProvider } from '@/components/shell/QueryProvider'
import { THEME_STORAGE_KEY, THEMES } from '@/lib/theme/themes'
import { initSoundOnFirstGesture } from '@/lib/sound/manager'
import { registerEases } from '@/lib/motion/eases'
import { MotionAttribute } from '@/components/motion/MotionAttribute'
import { VitalsCollector } from '@/lib/perf/VitalsCollector'

// W4 §5.6: "gsap.registerPlugin(...) once, in a client module imported by
// the shell." This module is that shell entry point -- called once at
// module scope (never inside the component body, which would violate the
// React Compiler's `purity` lint rule), registering both the GSAP plugins
// (via importing `eases.ts`, itself the client module that runs
// `gsap.registerPlugin`) and the four named `CustomEase` curves.
registerEases()

/**
 * Root client boundary (§8.2), outermost first: `ThemeProvider` ->
 * `QueryProvider` -> children. Sound and motion are module singletons
 * (T0.5), never context, so this only ever arms the sound manager's
 * first-gesture listener in a mount effect -- it does not read or provide
 * anything sound-related itself.
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
