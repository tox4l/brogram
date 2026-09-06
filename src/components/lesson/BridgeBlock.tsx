'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import type { LessonPublicBlock } from '@/lib/contracts'

type BridgeBlockData = Extract<LessonPublicBlock, { type: 'bridge' }>

/** The handoff to the real rep. "Walkthrough finished" fires on acknowledgment
 *  here (a real click/Enter), never on scroll-past, which is also what makes
 *  keyboard-only completion of a whole lesson possible. The bridge card
 *  itself is what "slides up" per spec 10.5 -- handled by this block's own
 *  `RevealBlock` wrapper in `LessonView`, not by anything in this file. */
export function BridgeBlock({ block, course, completed, onComplete }: {
  block: BridgeBlockData
  course: string
  completed: boolean
  onComplete: () => void
}) {
  return (
    <section aria-label="Next" className="space-y-4 rounded-xl border border-border bg-card p-4">
      <p className="text-sm leading-relaxed">{block.say}</p>
      {completed ? (
        <Link href={`/course/${course}`} className={buttonVariants({ variant: 'default' })}>
          Back to your path<ArrowRight aria-hidden="true" />
        </Link>
      ) : (
        <Button type="button" onClick={onComplete}>
          Let&apos;s go<ArrowRight aria-hidden="true" />
        </Button>
      )}
    </section>
  )
}
