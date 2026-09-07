'use client'

import { useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { markPerf, SHELL_READY } from '@/lib/perf/marks'
import { ShellLayout } from './ShellLayout'
import { ShellHeaderControls } from './ShellHeaderControls'
import { WellnessSlot } from './WellnessSlot'

export function AppShell({ children, wellnessRail }: {
  children: ReactNode
  wellnessRail?: ReactNode
}) {
  const pathname = usePathname()
  // T3.2 (perf gate), controller-granted one-line call site: fires once, the instant the
  // app shell itself has mounted -- this is `brogram:shell-ready`'s whole definition
  // (`src/lib/perf/marks.ts`'s own header). An effect, not render, because the mark must
  // record real client-side mount time, not SSR time.
  useEffect(() => {
    markPerf(SHELL_READY)
  }, [])
  const exercise = pathname === '/exercise' || pathname.startsWith('/exercise/')
  const navigation = [
    { title: 'Courses', href: '/courses', active: pathname.startsWith('/courses') || pathname === '/dashboard' || pathname.startsWith('/onboarding') || exercise },
    { title: 'De-rot', href: '/derot', active: pathname.startsWith('/derot') },
    { title: 'Progress', href: '/reports', active: pathname.startsWith('/reports') },
  ]

  return (
    <div className="flex flex-1 flex-col">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>
      {/* Wave 4 spec section 4: "Header content height 56px -- a rule, not a
          band." The row locks to h-14 (56px) from lg up, where the wordmark,
          nav and control cluster actually fit on one line (measured: the row
          needs ~704px and does not fit until ~820px -- sm and md would clip
          it and force a document-wide horizontal scrollbar); below lg it
          keeps its organic wrap height (two rows) rather than clipping
          content that has nowhere else to go. */}
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 sm:px-8 lg:h-14 lg:flex-nowrap lg:py-0">
          <Link href="/dashboard" className="rounded-lg text-h3 font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">BroGram<span className="text-primary">.</span></Link>
          <nav aria-label="Main navigation" className="order-3 flex w-full items-center gap-2 lg:order-none lg:w-auto">
            {navigation.map((item) => (
              <Link key={item.title} href={item.href} aria-current={item.active ? 'page' : undefined}
                className={cn('rounded-lg px-3 py-2 text-small outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none', item.active ? 'bg-muted text-foreground' : 'text-muted-foreground')}>
                {item.title}
              </Link>
            ))}
          </nav>
          <ShellHeaderControls />
        </div>
      </header>
      <ShellLayout dock={wellnessRail ?? <WellnessSlot />}>{children}</ShellLayout>
    </div>
  )
}
