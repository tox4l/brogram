'use client'

import Link from 'next/link'
import { ArrowUpRight, CupSoda, Focus, Sunrise } from 'lucide-react'
import { useSession } from '@/store/session'

export function WellnessSlot({ compact = false }: { compact?: boolean }) {
  const { learnerState } = useSession()
  const days = learnerState?.streak.derotDays ?? 0

  if (compact) {
    return <p className="text-sm text-zinc-400">Wellness <span className="mx-2 text-zinc-600" aria-hidden="true">/</span> Take a breath between exercises. Your progress is here when you return.</p>
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-200">Wellness</h2>
      <p className="mt-2 text-xl font-medium tracking-tight">Keep a little balance.</p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">Good practice leaves room for a pause.</p>
      <div className="mt-6 space-y-5">
        <div className="flex gap-3">
          <Focus className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
          <div><h3 className="text-sm font-medium">Focus</h3><p className="mt-1 text-sm leading-relaxed text-zinc-400">Work on one small thing, then take a break.</p></div>
        </div>
        <div className="flex gap-3">
          <CupSoda className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
          <div><h3 className="text-sm font-medium">Water &amp; stretch</h3><p className="mt-1 text-sm leading-relaxed text-zinc-400">Take a sip. Relax your shoulders.</p></div>
        </div>
        <div className="flex gap-3">
          <Sunrise className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
          <div><h3 className="text-sm font-medium">Prayer &amp; reminders</h3><p className="mt-1 text-sm leading-relaxed text-zinc-400">Your reminders and timers will appear here when available.</p></div>
        </div>
      </div>
      <div className="mt-7 border-t border-white/10 pt-5">
        <p className="text-sm leading-relaxed text-zinc-400">{days > 0 ? `${days} ${days === 1 ? 'day' : 'days'} of attention practice. Keep making time for it.` : 'A short de-rot drill is a good change of pace.'}</p>
        <Link href="/derot" className="mt-3 inline-flex items-center gap-1 rounded-sm text-sm font-medium text-emerald-200 outline-none hover:text-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-300">Open de-rot<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </div>
    </div>
  )
}
