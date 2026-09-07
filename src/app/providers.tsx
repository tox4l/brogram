'use client'

import { useEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { QueryProvider } from '@/components/shell/QueryProvider'
import { THEME_STORAGE_KEY } from '@/lib/theme/themes'
import { initSoundOnFirstGesture } from '@/lib/sound/manager'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { registerEases } from '@/lib/motion/eases'

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
 * plus this attribute) needs the attribute written somewhere. Written here,
 * off the one resolved boolean `useReducedMotion()` already produces: no
 * new state, no new hook -- one effect syncing an existing value onto
 * `<html>`.
 */
export function Providers({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    initSoundOnFirstGesture()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full'
  }, [reducedMotion])

  return (
    <ThemeProvider
      attribute="data-theme"
      themes={['midnight', 'amber', 'paper', 'arcade']}
      defaultTheme="midnight"
      enableSystem={false}
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <QueryProvider>{children}</QueryProvider>
    </ThemeProvider>
  )
}
