'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useWellness } from '@/lib/query/hooks'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { gridTemplateFor } from '@/lib/wellness/dock'

/**
 * Owns the shell's content grid: `main` plus the wellness dock slot. Five
 * placements (T2.4, spec R6.1): `placement` is a real layout decision, not a
 * class swap -- `left`/`right` change the grid template to put a 280px rail
 * on that side; `top` switches to a stacked layout with a full-width strip
 * above `main`; `float`/`hidden` take the dock out of the grid entirely
 * (`dock` renders through a portal, or is `null`), so `main` alone fills the
 * row.
 *
 * Reads `wellness.prefs.dock.placement` itself, the same cached TanStack
 * Query key `WellnessSlot`/`SoundToggle`/`DockControl` each read (one cache,
 * several independent readers, per `src/lib/query/hooks.ts`) -- `AppShell`
 * (frozen from Wave 0) passes only `dock`/`children`, so the placement this
 * component lays out for has to come from here, not a prop. This is also why
 * the learner's placement is never overridden by the route: the exercise and
 * lesson screens only ever collapse the dock's *content*
 * (`effectiveCollapsed`, computed by `WellnessSlot`) -- this component never
 * reads the pathname at all.
 */
export function ShellLayout({ dock, children }: { dock: ReactNode; children: ReactNode }) {
  const wellnessQuery = useWellness()
  const placement = resolveWellnessPrefs(wellnessQuery.data?.prefs).dock.placement
  const template = gridTemplateFor(placement)

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 py-6 sm:px-8',
        template === 'top-strip' && 'gap-4',
        (template === 'left-rail' || template === 'right-rail') && 'gap-8 lg:grid lg:items-start lg:gap-10',
        template === 'left-rail' && 'lg:grid-cols-[17.5rem_minmax(0,1fr)]',
        template === 'right-rail' && 'lg:grid-cols-[minmax(0,1fr)_17.5rem]',
      )}
    >
      {template === 'top-strip' && (
        <aside aria-label="Wellness" className="w-full border-b border-border pb-3">{dock}</aside>
      )}
      <main id="main-content" tabIndex={-1} className="min-w-0 outline-none">{children}</main>
      {template === 'left-rail' && (
        <aside aria-label="Wellness" className="min-w-0 border-b border-border pb-6 lg:order-first lg:sticky lg:top-20 lg:border-b-0 lg:border-r lg:pr-7 lg:pb-0">
          {dock}
        </aside>
      )}
      {template === 'right-rail' && (
        <aside aria-label="Wellness" className="min-w-0 border-t border-border pt-6 lg:sticky lg:top-20 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-7">
          {dock}
        </aside>
      )}
      {template === 'portal' && dock}
    </div>
  )
}
