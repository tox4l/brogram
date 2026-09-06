'use client'

import { LoginSection } from './sections/LoginSection'
import { ShellDashboardSection } from './sections/ShellDashboardSection'
import { OnboardingSection } from './sections/OnboardingSection'
import { ExerciseSection } from './sections/ExerciseSection'
import { DerotSection } from './sections/DerotSection'
import { ReportsSection } from './sections/ReportsSection'
import { AdminSection } from './sections/AdminSection'
import { WellnessBuddySection } from './sections/WellnessBuddySection'

const NAV = [
  { href: '#login', label: 'Login' },
  { href: '#shell-dashboard', label: 'Shell & dashboard' },
  { href: '#onboarding', label: 'Onboarding' },
  { href: '#exercise', label: 'Exercise' },
  { href: '#derot', label: 'De-rot' },
  { href: '#reports', label: 'Reports' },
  { href: '#admin', label: 'Admin' },
  { href: '#wellness-buddy', label: 'Wellness & buddy' },
]

export default function PreviewPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 sm:px-8">
          <p className="text-sm font-medium">BroGram UI preview <span className="text-muted-foreground">(development only)</span></p>
          <nav aria-label="Preview sections" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{item.label}</a>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-10 px-5 py-10 sm:px-8">
        <LoginSection />
        <ShellDashboardSection />
        <OnboardingSection />
        <ExerciseSection />
        <DerotSection />
        <ReportsSection />
        <AdminSection />
        <WellnessBuddySection />
      </main>
    </div>
  )
}
