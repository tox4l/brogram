'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from '@/store/session'
import { useThemeSync } from '@/lib/theme/useThemeSync'
import { DockControl } from './DockControl'
import { SoundToggle } from './SoundToggle'
import { ThemeQuickSwitch } from './ThemeQuickSwitch'
import { BuddyButton } from './BuddyButton'

/**
 * The header's right-hand control cluster -- one mount point (T0.7 step 2).
 * `AppShell` received the dock placement, the sound toggle and the theme
 * quick-switch across three separate tasks; composing them here means a
 * later control is an edit to one small owned file, not to the shell.
 *
 * X5 (wave 2 review): `useThemeSync` runs the once-per-sign-in theme
 * reconcile here rather than inside `ThemeQuickSwitch` or the Account page,
 * so it fires regardless of which authenticated screen a learner lands on
 * first -- `ShellHeaderControls` is the one mount point every `(app)` route
 * shares (`AppShell.tsx`).
 */
export function ShellHeaderControls() {
  const pathname = usePathname()
  const userId = useSession((session) => session.user?.id ?? null)
  useThemeSync(userId)
  return (
    <div className="ml-auto flex items-center gap-4">
      <DockControl />
      <SoundToggle />
      <ThemeQuickSwitch />
      <Link href="/account" aria-current={pathname.startsWith('/account') ? 'page' : undefined}
        className="inline-flex items-center rounded-lg px-1 py-2 text-small text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
        Account
      </Link>
      <BuddyButton />
    </div>
  )
}
