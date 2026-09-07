'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { Dock } from '@/components/wellness/Dock'
import { BuddyDrawer } from '@/components/buddy/Drawer'
import { fixtureSessionData } from '../fixtures'
import { Section, SectionErrorBoundary } from './Section'

export function WellnessBuddySection() {
  const [open, setOpen] = useState(true)

  return (
    <Section id="wellness-buddy" title="Wellness and buddy" caption="The full Rail and its compact strip variant, plus the Buddy drawer opened. Both read Supabase (prayer times, wellness prefs, message history) and degrade to defaults or an empty state since every fetch fails here.">
      <SectionErrorBoundary>
        <SessionProvider initialState={fixtureSessionData}>
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <div className="rounded-xl border border-border p-5">
              <p className="mb-4 text-xs font-medium text-muted-foreground">Full dock (vertical, expanded)</p>
              <Dock orientation="vertical" collapsed={false} onToggleCollapse={() => {}} corner="br" onCornerChange={() => {}} />
            </div>
            <div className="rounded-xl border border-border p-5">
              <p className="mb-4 text-xs font-medium text-muted-foreground">Compact strip (exercise screen)</p>
              <Dock orientation="horizontal" collapsed={false} onToggleCollapse={() => {}} corner="br" onCornerChange={() => {}} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => setOpen(true)}>Open buddy drawer</Button>
            <p className="text-xs text-muted-foreground">The drawer does not accept initial messages as a prop, so it opens to its real empty state rather than three seeded messages.</p>
          </div>
          <BuddyDrawer open={open} onOpenChange={setOpen} />
        </SessionProvider>
      </SectionErrorBoundary>
    </Section>
  )
}
