'use client'

import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import DynamicBuddyDrawer from '@/components/buddy/DynamicDrawer'

// W4FIX-B2 ruling 1 / F4 (re-check): the drawer's own component code (96.7 KB
// of message list, composer and `motion/react` bubble animations) used to
// ship in the entry bundle of every authenticated route regardless of
// whether the drawer was ever opened, because this was the drawer's one
// trigger and imported it statically. `DynamicBuddyDrawer`
// (`src/components/buddy/DynamicDrawer.tsx`) wraps the same component behind
// `next/dynamic({ ssr: false })`, so its chunk now loads on first open, not
// on every route -- this is the one-line swap that clears `/lesson/[cloId]`'s
// remaining budget overage (measured: 930.6 -> 808.9 KB against a 900.0 KB
// budget).
export function BuddyButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" className="h-11 border-input px-3 text-foreground" onClick={() => setOpen(true)}>
        <MessageCircle aria-hidden="true" />Buddy
      </Button>
      <DynamicBuddyDrawer open={open} onOpenChange={setOpen} />
    </>
  )
}
