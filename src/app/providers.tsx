'use client'

import { useEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { QueryProvider } from '@/components/shell/QueryProvider'
import { THEME_STORAGE_KEY } from '@/lib/theme/themes'
import { initSoundOnFirstGesture } from '@/lib/sound/manager'

/**
 * Root client boundary (§8.2), outermost first: `ThemeProvider` ->
 * `QueryProvider` -> children. Sound and motion are module singletons
 * (T0.5), never context, so this only ever arms the sound manager's
 * first-gesture listener in a mount effect -- it does not read or provide
 * anything sound-related itself.
 */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    initSoundOnFirstGesture()
  }, [])

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
