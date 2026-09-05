'use client'

import Link from 'next/link'
import { MessageCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useSession } from '@/store/session'
import { cn } from '@/lib/utils'

export function BuddyButton() {
  const { learnerState, profile } = useSession()
  const days = learnerState?.streak.exerciseDays ?? 0
  const closed = Object.values(learnerState?.mastery ?? {}).filter((mastery) => mastery.closed).length

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="h-9 border-white/15 px-3 text-zinc-100" />}>
        <MessageCircle aria-hidden="true" />Buddy
      </DialogTrigger>
      <DialogContent className="top-0 right-0 left-auto h-dvh max-w-[min(24rem,100%)] translate-x-0 translate-y-0 content-start gap-8 rounded-none border-l border-white/10 bg-zinc-950 p-6 sm:max-w-sm">
        <DialogHeader className="pr-7">
          <DialogTitle className="text-xl">Your coding Buddy</DialogTitle>
          <DialogDescription>A little perspective on your progress.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm leading-relaxed text-zinc-300">
          <p>{days > 0 ? `You have a ${days}-day exercise streak. Build on it one exercise at a time.` : 'Your first exercise is a fresh start. Progress grows with practice.'}</p>
          <p>{closed > 0 ? `${closed} learning ${closed === 1 ? 'outcome completed' : 'outcomes completed'}. Take a moment to recognize what you can do now.` : 'Complete exercises with different patterns to build mastery of each outcome.'}</p>
          {profile?.account_status === 'restricted' && <p>Exercises are paused. You can still review your progress or practice with de-rot drills.</p>}
        </div>
        <div className="border-t border-white/10 pt-5">
          <p className="text-sm text-zinc-400">Buddy chat is not available yet. Your progress and practice links are ready below.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>View progress</Link>
            <Link href="/derot" className={cn(buttonVariants(), 'bg-emerald-200 text-zinc-950 hover:bg-emerald-100')}>Try de-rot</Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
