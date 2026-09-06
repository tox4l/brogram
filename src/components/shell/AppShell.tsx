'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { BuddyButton } from './BuddyButton'
import { WellnessSlot } from './WellnessSlot'

export function AppShell({ children, wellnessRail, buddy }: {
  children: ReactNode
  wellnessRail?: ReactNode
  buddy?: ReactNode
}) {
  const pathname = usePathname()
  const exercise = pathname === '/exercise' || pathname.startsWith('/exercise/')
  const navigation = [
    { title: 'Courses', href: '/dashboard#course', active: pathname === '/dashboard' || pathname.startsWith('/onboarding') || exercise },
    { title: 'De-rot', href: '/derot', active: pathname.startsWith('/derot') },
    { title: 'Reports', href: '/reports', active: pathname.startsWith('/reports') },
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
          <div className="ml-auto flex items-center gap-4">
            <Link href="/account" aria-current={pathname.startsWith('/account') ? 'page' : undefined}
              className="rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-emerald-300 motion-reduce:transition-none">
              Account
            </Link>
            {buddy ?? <BuddyButton />}
          </div>
        </div>
      </header>
      <div className={cn('mx-auto grid w-full max-w-7xl flex-1 px-5 py-6 sm:px-8', exercise ? 'content-start gap-4' : 'gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10')}>
        <main id="main-content" tabIndex={-1} className="min-w-0 outline-none">{children}</main>
        <aside aria-label="Wellness" className={cn('min-w-0', exercise ? 'order-first border-b border-border pb-3' : 'border-t border-border pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7')}>
          {wellnessRail ?? <WellnessSlot compact={exercise} />}
        </aside>
      </div>
    </div>
  )
}
