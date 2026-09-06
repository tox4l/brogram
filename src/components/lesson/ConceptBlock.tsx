import type { LessonPublicBlock } from '@/lib/contracts'

type ConceptBlockData = Extract<LessonPublicBlock, { type: 'concept' }>

/** One idea, plainly (spec 3.1). `figure`, when present, is sanitised at
 *  build time by the static-curriculum build step -- never raw learner or
 *  runtime input -- so rendering it inline is safe here. */
export function ConceptBlock({ block }: { block: ConceptBlockData }) {
  return (
    <section aria-label="Concept" className="space-y-3">
      <h2 className="text-xl font-medium tracking-tight">{block.heading}</h2>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{block.body}</p>
      {block.figure && (
        <div
          className="overflow-hidden rounded-lg border border-border [&_svg]:h-auto [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: block.figure }}
        />
      )}
    </section>
  )
}
