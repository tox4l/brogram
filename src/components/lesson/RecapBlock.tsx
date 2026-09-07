import type { LessonPublicBlock } from '@/lib/contracts'
import { Reveal } from '@/components/motion/Reveal'

type RecapBlockData = Extract<LessonPublicBlock, { type: 'recap' }>

/** Wave 4 spec 5.2/ruling W4.14: "line reveals on the lesson hook and
 *  recap" -- the one line the learner should still have in a week is this
 *  block's headline-equivalent, so it gets the masked line reveal; the
 *  bullets above it stay plain (the ration is two surfaces for a
 *  masked/character reveal, not every string on the page). */
export function RecapBlock({ block, reduced }: { block: RecapBlockData; reduced: boolean }) {
  return (
    <section aria-label="Recap" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed">
        {block.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
      </ul>
      <p className="text-sm font-medium">
        <Reveal mode="lines" reduced={reduced}>{block.remember}</Reveal>
      </p>
    </section>
  )
}
