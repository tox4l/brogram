'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  /** The pre-normalisation "interesting number" -- a combo-weighted total for Arcade, a game's own raw metric for Playground. */
  rawLabel?: string
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

const COUNT_UP_DURATION_S = 0.7 // the celebration duration token (DUR.celebration, spec 7.8)

/**
 * The score count-up (spec 10.9), following the same pattern as XpCounter:
 * GSAP tweens a plain proxy object and writes straight into a ref's
 * `textContent`, never into React state -- writing through state would
 * re-render on every animation frame (react-hooks/set-state-in-effect) and
 * would race React's own reconciliation against the same text node. The
 * `sr-only` sibling below is ordinary React-rendered text, always the
 * settled `score`, so the value is announced immediately regardless of
 * whether the tween has finished (R7.9: feedback reduces, it never vanishes).
 */
function ScoreCountUp({ score, reduced }: { score: number; reduced: boolean }) {
  const glyphRef = useRef<HTMLSpanElement>(null)
  const [initialText] = useState(() => (reduced ? String(score) : '0'))

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
    <span className="font-mono text-4xl font-semibold tabular-nums">
      <span ref={glyphRef} aria-hidden="true">{initialText}</span>
      <span className="sr-only">{score}</span>
    </span>
  )
}

/** The Arcade / Playground run summary (spec 7.9 step 1, 10.9): score, accuracy, best combo, a personal-best badge when earned, one voice line, and the last runs of this kind -- nobody else's numbers ever appear. */
export function RunSummary({
  title,
  score,
  accuracy,
  bestCombo,
  rawLabel,
  isPersonalBest,
  previousBest,
  lastRuns,
  voiceLine,
  onPlayAgain,
  backHref,
  reduced = false,
}: RunSummaryProps) {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{title} -- run complete</CardTitle>
          {isPersonalBest && <Badge className="bg-primary text-primary-foreground">New best</Badge>}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{voiceLine}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-8">
          <div>
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="mt-1"><ScoreCountUp score={score} reduced={reduced} /></p>
            {rawLabel && <p className="mt-1 text-xs text-muted-foreground">{rawLabel}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Accuracy</p>
            <p className="mt-1 font-mono text-xl font-medium tabular-nums">{Math.round(accuracy * 100)}%</p>
          </div>
          {typeof bestCombo === 'number' && (
            <div>
              <p className="text-xs text-muted-foreground">Best combo</p>
              <p className="mt-1 font-mono text-xl font-medium tabular-nums">{bestCombo}x</p>
            </div>
          )}
          {previousBest !== null && (
            <div>
              <p className="text-xs text-muted-foreground">Your best</p>
              <p className={cn('mt-1 font-mono text-xl font-medium tabular-nums', isPersonalBest && 'text-primary')}>{Math.max(previousBest, score)}</p>
            </div>
          )}
        </div>

        {lastRuns.length > 1 && (
          <div>
            <p className="text-xs text-muted-foreground">Your last {lastRuns.length} runs</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {lastRuns.map((run, index) => (
                <li
                  key={`${run.at}-${index}`}
                  className={cn(
                    'rounded-md border border-border px-2 py-1 font-mono text-xs tabular-nums',
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
          <Button onClick={onPlayAgain} className="bg-emerald-200 text-primary-foreground hover:bg-emerald-100">
            Run it again
          </Button>
          <Link href={backHref} className={buttonVariants({ variant: 'outline' })}>
            Back to de-rot
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
