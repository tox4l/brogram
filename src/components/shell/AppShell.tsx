'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { ShellLayout } from './ShellLayout'
import { ShellHeaderControls } from './ShellHeaderControls'
import { WellnessSlot } from './WellnessSlot'

export function AppShell({ children, wellnessRail }: {
  children: ReactNode
  wellnessRail?: ReactNode
}) {
  const pathname = usePathname()
  const exercise = pathname === '/exercise' || pathname.startsWith('/exercise/')
  const navigation = [
    { title: 'Courses', href: '/courses', active: pathname.startsWith('/courses') || pathname === '/dashboard' || pathname.startsWith('/onboarding') || exercise },
    { title: 'De-rot', href: '/derot', active: pathname.startsWith('/derot') },
    { title: 'Progress', href: '/reports', active: pathname.startsWith('/reports') },
  ]

  return (
    <div className="flex flex-1 flex-col">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-emerald-200 px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Skip to content</a>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4 sm:px-8">
          <Link href="/dashboard" className="rounded-sm text-xl font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">BroGram<span className="text-emerald-300">.</span></Link>
          <nav aria-label="Main navigation" className="order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto">
            {navigation.map((item) => (
              <Link key={item.title} href={item.href} aria-current={item.active ? 'page' : undefined}
                className={cn('rounded-md px-3 py-2 text-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-emerald-300 motion-reduce:transition-none', item.active ? 'bg-muted text-foreground' : 'text-muted-foreground')}>
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
