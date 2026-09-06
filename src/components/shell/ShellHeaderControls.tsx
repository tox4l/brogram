'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DockControl } from './DockControl'
import { SoundToggle } from './SoundToggle'
import { ThemeQuickSwitch } from './ThemeQuickSwitch'
import { BuddyButton } from './BuddyButton'

/**
 * The header's right-hand control cluster -- one mount point (T0.7 step 2).
 * `AppShell` received the dock placement, the sound toggle and the theme
 * quick-switch across three separate tasks; composing them here means a
 * later control is an edit to one small owned file, not to the shell.
 */
export function ShellHeaderControls() {
  const pathname = usePathname()
  return (
    <div className="ml-auto flex items-center gap-4">
      <DockControl />
      <SoundToggle />
      <ThemeQuickSwitch />
      <Link href="/account" aria-current={pathname.startsWith('/account') ? 'page' : undefined}
        className="rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-emerald-300 motion-reduce:transition-none">
        Account
      </Link>
      <BuddyButton />
    </div>
  )
}
