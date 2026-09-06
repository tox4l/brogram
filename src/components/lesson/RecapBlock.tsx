import type { LessonPublicBlock } from '@/lib/contracts'

type RecapBlockData = Extract<LessonPublicBlock, { type: 'recap' }>

export function RecapBlock({ block }: { block: RecapBlockData }) {
  return (
    <section aria-label="Recap" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed">
        {block.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
      </ul>
      <p className="text-sm font-medium">{block.remember}</p>
    </section>
  )
}
