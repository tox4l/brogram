'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { Check, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { DrillResult } from '@/lib/contracts'

export interface RunSummaryProps {
  /** The drill's voice title, e.g. "Call It". */
  title: string
  /** Normalised 0-100 -- the score this run was actually saved with. */
  score: number
  /** 0..1. */
  accuracy: number
  /** Consecutive-correct streak reached at any point in the run (Arcade only -- omit for a single-session Playground game). */
  bestCombo?: number
  /**
   * Per-item correct/incorrect, in the order they were played (fix round 2,
   * item 5): "where the run went", not just its aggregate accuracy. Omit for
   * a single-session Playground game with no discrete items.
   */
  itemResults?: boolean[]
  /** The pre-normalisation "interesting number" -- a game's own raw metric (e.g. "842 ms mean reaction"). Shown as a caption, not a number in the stat grid (fix round 2, item 5): it is prose, not a value on the same footing as accuracy or combo peak. */
  rawLabel?: string
  /** True only when this run beat a genuine previous best (fix round 1, C2 -- never true on a first run, regardless of score). */
  isPersonalBest: boolean
  previousBest: number | null
  /** Most recent runs of this kind, newest first. Each stored run is one DrillResult row. */
  lastRuns: DrillResult[]
  /** Plain string pending the T2.7a/T2.7b voice bank -- see the T2.9a report for the exact lines used. */
  voiceLine: string
  onPlayAgain: () => void
  backHref: string
  reduced?: boolean
}

const RING_RADIUS = 52
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const COUNT_UP_DURATION_S = 0.7 // the celebration duration token (DUR.celebration, spec 7.8)

/**
 * The score ring (fix round 1, item 12): a big, centred visual instead of a
 * lone number in a row of small stats -- "the score ring" the reviewer asked
 * the summary to fill its frame around. The ring itself renders at its final
 * position immediately (a static arc, not worth animating on its own); the
 * number inside follows XpCounter's pattern -- GSAP tweens a proxy straight
 * into a ref's `textContent`, never React state, so no animation frame ever
 * triggers a re-render. The `sr-only` sibling is always the settled value.
 */
function ScoreRing({ score, reduced }: { score: number; reduced: boolean }) {
  const glyphRef = useRef<HTMLSpanElement>(null)
  const [initialText] = useState(() => (reduced ? String(score) : '0'))
  const offset = RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, score)) / 100)

  useGSAP(() => {
    const el = glyphRef.current
    if (!el) return
    if (reduced) {
      el.textContent = String(score)
      return
    }
    const proxy = { v: 0 }
    gsap.to(proxy, {
      v: score,
      duration: COUNT_UP_DURATION_S,
      ease: 'power1.out',
      snap: { v: 1 },
      onUpdate: () => { el.textContent = String(Math.round(proxy.v)) },
    })
  }, [score, reduced])

  return (
    <div className="relative inline-flex size-36 shrink-0 items-center justify-center">
      <svg viewBox="0 0 120 120" className="size-36 -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={RING_RADIUS} className="fill-none stroke-muted" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={RING_RADIUS}
          className="fill-none stroke-primary"
          strokeWidth="8"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        {/* W4 spec section 9 (/derot): "Score and best in --text-h1 tabular
            numerals" -- the run's headline number. */}
        <span className="font-mono text-h1 tabular-nums text-foreground">
          <span ref={glyphRef} aria-hidden="true">{initialText}</span>
          <span className="sr-only">{score}</span>
        </span>
        <span className="text-micro text-muted-foreground">score</span>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight, emphasis }: { label: string; value: string; highlight?: boolean; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-micro text-muted-foreground">{label}</p>
      {/* Score and best both carry the run's headline weight (spec section 9);
          accuracy, combo peak and delta stay one tier down. */}
      <p className={cn('mt-1 font-mono tabular-nums text-foreground', emphasis ? 'text-h1' : 'text-h2', highlight && 'text-primary')}>{value}</p>
    </div>
  )
}

/**
 * The Arcade / Playground run summary (spec 7.9 step 1, 10.9): the score
 * ring, accuracy, combo peak and the two actions fill the card instead of a
 * handful of numbers in a mostly-empty box. A personal best gets its badge
 * only when it is a genuine one (C2); a first-ever run gets its own honest
 * badge instead of a false "New best". Announced through a live region
 * (fix round 1, I4) so a screen-reader user hears the run ended without
 * needing to find focus first.
 */
export function RunSummary({
  title,
  score,
  accuracy,
  bestCombo,
  itemResults,
  rawLabel,
  isPersonalBest,
  previousBest,
  lastRuns,
  voiceLine,
  onPlayAgain,
  backHref,
  reduced = false,
}: RunSummaryProps) {
  const isFirstRun = previousBest === null
  const delta = previousBest !== null ? score - previousBest : null
  const announcement = `Run complete. ${title}. Score ${score}. Accuracy ${Math.round(accuracy * 100)} percent.${isPersonalBest ? ' New personal best.' : ''}`

  return (
    <Card className="mx-auto w-full max-w-2xl">
      {/* fix round 1, I4: a screen-reader user hears the run ended and its score without needing to find focus first. The visible content below is not itself a live region -- announcing a whole card with interactive buttons on every re-render is noisy and can confuse focus handling. */}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-micro text-muted-foreground uppercase">Run complete</p>
            <p className="text-h2 text-foreground">{title}</p>
          </div>
          {isPersonalBest && <Badge className="bg-primary text-primary-foreground">New best</Badge>}
          {!isPersonalBest && isFirstRun && <Badge variant="outline">First run logged</Badge>}
        </div>
        <p className="text-small leading-relaxed text-muted-foreground">{voiceLine}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-8 py-4">
        <div className="flex flex-wrap items-center justify-center gap-8 sm:justify-start">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <ScoreRing score={score} reduced={reduced} />
            {/* fix round 2, item 5: prose, not a number -- kept out of the Stat grid below, which is built for values on the same footing as each other. */}
            {rawLabel && <p className="max-w-40 text-center text-micro text-muted-foreground sm:text-left">{rawLabel}</p>}
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-6">
            <Stat label="Accuracy" value={`${Math.round(accuracy * 100)}%`} />
            {typeof bestCombo === 'number' && <Stat label="Combo peak" value={`${bestCombo}x`} />}
            {previousBest !== null && <Stat label="Best" value={`${Math.max(previousBest, score)}`} highlight={isPersonalBest} emphasis />}
            {delta !== null && <Stat label="Delta" value={delta === 0 ? '0' : delta > 0 ? `+${delta}` : `${delta}`} highlight={delta > 0} />}
          </div>
        </div>

        {itemResults && itemResults.length > 0 && (
          <div>
            <p className="text-micro text-muted-foreground">Where it went</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {itemResults.map((correct, index) => (
                <li
                  key={index}
                  aria-label={`Item ${index + 1}: ${correct ? 'correct' : 'missed'}`}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-lg border',
                    correct ? 'border-primary/30 bg-primary/10 text-primary' : 'border-destructive/30 bg-destructive/10 text-destructive'
                  )}
                >
                  {correct ? <Check className="size-4" aria-hidden="true" /> : <X className="size-4" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          </div>
        )}

        {lastRuns.length > 1 && (
          <div>
            <p className="text-micro text-muted-foreground">Last {lastRuns.length} runs</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {lastRuns.map((run, index) => (
                <li
                  key={`${run.at}-${index}`}
                  className={cn(
                    'rounded-lg border border-rule px-2 py-1 font-mono text-micro tabular-nums',
                    index === 0 ? 'border-primary/40 bg-primary/10 text-primary' : 'text-muted-foreground'
                  )}
                >
                  {run.score}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button autoFocus onClick={onPlayAgain}>Run it again</Button>
          <Link href={backHref} className={buttonVariants({ variant: 'outline' })}>
            Back to de-rot
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
