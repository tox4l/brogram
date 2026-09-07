'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { LessonPublicBlock } from '@/lib/contracts'
import { CodeGuide, type GuideSpan } from './CodeGuide'

type WorkedBlockData = Extract<LessonPublicBlock, { type: 'worked' }>

function lineRange(line: number | [number, number]): [number, number] {
  return Array.isArray(line) ? line : [line, line]
}

/** Spec 7.2: token-level guidance draws only when a step's `say` holds
 *  **exactly one** backticked span -- any other count (none, or several)
 *  is left for `CodeGuide` to fall back to line level on its own. */
function singleBacktickToken(say: string): string | undefined {
  const matches = [...say.matchAll(/`([^`]+)`/g)]
  return matches.length === 1 ? matches[0][1] : undefined
}

/** Spec 7.4: "the step text carries the location" -- a visually-hidden
 *  prefix on every callout, e.g. "Step 2 of 4, lines 3 to 5.". */
function stepLabel(index: number, total: number, line: number | [number, number]): string {
  const [start, end] = lineRange(line)
  const where = start === end ? `line ${start}` : `lines ${start} to ${end}`
  return `Step ${index + 1} of ${total}, ${where}.`
}

/**
 * Steps reveal one at a time (spec 3.3). Advancing is a real click or Enter
 * on the "Next step" button -- native `<button>` activation already covers
 * both, so no extra key handler is needed for that half of "click or Enter"
 * (Space comes free from native button semantics too -- spec 7.4). There is
 * no timer anywhere in this path: the learner is the only thing that ever
 * calls `setStepIndex`.
 *
 * The previous callout fades to 40% opacity on the move curve; the guide
 * band and rail (now `CodeGuide`, spec 7.2/ruling W4.19) slide to the new
 * lines on the same curve. Under reduced motion every transition collapses
 * to `none` -- the band still lands on the correct lines, just without the
 * animated move (ruling W4.16's one exception: losing the band's position
 * would delete the teaching, not the motion).
 *
 * Fix round 1 (I3): the "Next step" button unmounts on the click that
 * reaches the last step, which would otherwise drop focus to `<body>`.
 * Focus moves to the newly-revealed last callout instead.
 *
 * Fix round 1 (M6): `idPrefix` is documented as aria wiring but wired
 * nothing -- the active callout now carries `aria-describedby` pointing at
 * `CodeGuide`'s own `id` (the same string), so a screen-reader user on the
 * active step has a programmatic link to the code region it describes.
 */
export function WorkedBlock({ block, reduced }: { block: WorkedBlockData; reduced: boolean }) {
  const [stepIndex, setStepIndex] = useState(0)
  const currentStep = block.steps[stepIndex]
  const isLast = stepIndex >= block.steps.length - 1
  const wasLast = useRef(false)
  const lastCalloutRef = useRef<HTMLParagraphElement>(null)
  const idPrefix = `worked-${block.id}`

  useEffect(() => {
    if (isLast && !wasLast.current) lastCalloutRef.current?.focus()
    wasLast.current = isLast
  }, [isLast])

  const active: GuideSpan | null = currentStep
    ? { line: currentStep.line, token: singleBacktickToken(currentStep.say) }
    : null

  return (
    <section aria-label="Worked example" className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <CodeGuide
          code={block.code}
          language={block.language}
          active={active}
          reduced={reduced}
          label="Code"
          idPrefix={idPrefix}
        />
      </div>
      <div className="space-y-2">
        {block.steps.slice(0, stepIndex + 1).map((step, index) => {
          const isActive = index === stepIndex
          const isLastCallout = index === block.steps.length - 1
          return (
            <p
              key={index}
              ref={isLastCallout ? lastCalloutRef : undefined}
              tabIndex={isLastCallout ? -1 : undefined}
              aria-current={isActive ? 'step' : undefined}
              aria-describedby={isActive ? idPrefix : undefined}
              className="rounded-lg border border-border bg-card p-3 text-sm leading-relaxed outline-none"
              style={{ opacity: isActive ? 1 : 0.4, transition: reduced ? 'none' : 'opacity 200ms var(--ease-move)' }}
            >
              <span className="sr-only">{stepLabel(index, block.steps.length, step.line)}</span>
              {step.say}
            </p>
          )
        })}
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
