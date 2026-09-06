'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { LessonPublicBlock } from '@/lib/contracts'

type WorkedBlockData = Extract<LessonPublicBlock, { type: 'worked' }>

const LINE_HEIGHT_PX = 24

function lineRange(line: number | [number, number]): [number, number] {
  return Array.isArray(line) ? line : [line, line]
}

/**
 * Steps reveal one at a time (spec 3.3). Advancing is a real click or Enter
 * on the "Next step" button -- native `<button>` activation already covers
 * both, so no extra key handler is needed for that half of "click or Enter".
 * The previous callout fades to 40%, and the highlight band slides to the
 * new lines on the move curve over 200ms (spec 10.5); under reduced motion
 * both transitions are suppressed, holding a static state instead.
 */
export function WorkedBlock({ block, reduced }: { block: WorkedBlockData; reduced: boolean }) {
  const [stepIndex, setStepIndex] = useState(0)
  const lines = block.code.split('\n')
  const currentStep = block.steps[stepIndex]
  const [start, end] = lineRange(currentStep?.line ?? 1)
  const isLast = stepIndex >= block.steps.length - 1

  return (
    <section aria-label="Worked example" className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
        <pre className="relative z-10 overflow-x-auto p-4 font-mono text-sm leading-6">
          <code>
            {lines.map((line, index) => <div key={index}>{line || ' '}</div>)}
          </code>
        </pre>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 rounded-md bg-primary/15 ring-1 ring-inset ring-primary/40"
          style={{
            top: 16 + (start - 1) * LINE_HEIGHT_PX,
            height: (end - start + 1) * LINE_HEIGHT_PX,
            left: 8,
            right: 8,
            transition: reduced ? 'none' : 'top 200ms var(--ease-move), height 200ms var(--ease-move)',
          }}
        />
      </div>
      <div className="space-y-2">
        {block.steps.slice(0, stepIndex + 1).map((step, index) => (
          <p
            key={index}
            className="rounded-lg border border-border bg-card p-3 text-sm leading-relaxed"
            style={{ opacity: index === stepIndex ? 1 : 0.4, transition: reduced ? 'none' : 'opacity 200ms var(--ease-move)' }}
          >
            {step.say}
          </p>
        ))}
      </div>
      {block.caption && <p className="text-xs text-muted-foreground">{block.caption}</p>}
      {!isLast && (
        <Button type="button" variant="outline" size="sm" onClick={() => setStepIndex((index) => Math.min(index + 1, block.steps.length - 1))}>
          Next step
        </Button>
      )}
    </section>
  )
}
