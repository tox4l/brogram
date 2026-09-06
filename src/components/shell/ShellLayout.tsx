'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Owns the shell's content grid: `main` plus the wellness dock slot (T0.7
 * step 1). Unchanged in behaviour from the pre-extraction `AppShell` -- right
 * rail, 15rem, the existing exercise-route case (dock leads, compact strip)
 * -- T2.4 turns this into the five-placement renderer once
 * `WellnessDockPrefs.placement` actually drives layout; nobody else edits
 * this file after that lands.
 */
export function ShellLayout({ dock, children }: { dock: ReactNode; children: ReactNode }) {
  const pathname = usePathname()
  const exercise = pathname === '/exercise' || pathname.startsWith('/exercise/')

  return (
    <div className={cn('mx-auto grid w-full max-w-7xl flex-1 px-5 py-6 sm:px-8', exercise ? 'content-start gap-4' : 'gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10')}>
      <main id="main-content" tabIndex={-1} className="min-w-0 outline-none">{children}</main>
      <aside aria-label="Wellness" className={cn('min-w-0', exercise ? 'order-first border-b border-border pb-3' : 'border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7')}>
        {dock}
      </aside>
    </div>
  )
}
