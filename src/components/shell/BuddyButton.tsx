'use client'

import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BuddyDrawer } from '@/components/buddy/Drawer'

export function BuddyButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" className="h-9 border-input px-3 text-foreground" onClick={() => setOpen(true)}>
        <MessageCircle aria-hidden="true" />Buddy
      </Button>
      <BuddyDrawer open={open} onOpenChange={setOpen} />
    </>
  )
}
