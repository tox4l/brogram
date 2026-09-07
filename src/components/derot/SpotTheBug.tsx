'use client'

import { useCallback, useRef, useState } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useCountdown } from './useCountdown'
import { gradeSpotTheBug, scoreTimedCorrect } from './scoring'

interface SpotTheBugPayload {
  language: Language
  snippet: string
  bugLines: number[]
  explanation: string
}

export interface SpotTheBugProps {
  item: DrillItem
  onResult: (result: DrillResult) => void
  now?: () => number
  /** True while the tab is hidden or the run is otherwise away (fix round 1, I3): the clock stops, so time never runs out unseen. */
  paused?: boolean
}

export function SpotTheBug({ item, onResult, now = Date.now, paused = false }: SpotTheBugProps) {
  const payload = item.payload as unknown as SpotTheBugPayload
  const lines = payload.snippet.split('\n')

  const [submitted, setSubmitted] = useState(false)
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [correct, setCorrect] = useState(false)

  const submittedRef = useRef(false)
  const startRef = useRef(now())
  const elapsed = () => now() - startRef.current

  const submit = useCallback(
    (line: number | null, elapsedMs: number) => {
      if (submittedRef.current) return
      submittedRef.current = true
      const isCorrect = gradeSpotTheBug(line, payload.bugLines)
      const score = scoreTimedCorrect(isCorrect, elapsedMs, item.timeLimitS)
      setSelectedLine(line)
      setCorrect(isCorrect)
      setSubmitted(true)
      onResult({
        drillId: item.id,
        kind: item.kind,
        correct: isCorrect,
        timeMs: elapsedMs,
        score,
        at: new Date(now()).toISOString(),
        lane: item.lane,
      })
    },
    [item.id, item.kind, item.lane, item.timeLimitS, onResult, payload.bugLines, now]
  )

  useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted && !paused,
    onExpire: () => submit(selectedLine, elapsed()),
  })

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-end gap-3">
          <Badge variant="outline" className="font-mono uppercase">
            {payload.language}
          </Badge>
        </div>
        <CardDescription>Click the line that causes the bug.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto rounded-lg bg-muted font-mono text-sm">
          {lines.map((line, idx) => {
            const lineNumber = idx + 1
            const isBugLine = payload.bugLines.includes(lineNumber)
            const isSelected = selectedLine === lineNumber
            return (
              <button
                key={lineNumber}
                type="button"
                autoFocus={idx === 0}
                disabled={submitted}
                onClick={() => submit(lineNumber, elapsed())}
                aria-label={`Line ${lineNumber}: ${line}`}
                className={cn(
                  'flex w-full gap-4 px-4 py-1 text-left transition-colors disabled:cursor-default',
                  !submitted && 'hover:bg-accent',
                  submitted && isBugLine && 'bg-primary/10',
                  submitted && isSelected && !isBugLine && 'bg-destructive/10'
                )}
              >
                <span className="w-6 shrink-0 select-none text-right text-muted-foreground">{lineNumber}</span>
                <span className="whitespace-pre">{line || ' '}</span>
              </button>
            )
          })}
        </div>

        {submitted && (
          <div
            className={cn(
              'rounded-lg border p-4 text-sm',
              correct ? 'border-primary/30 bg-primary/10' : 'border-destructive/30 bg-destructive/10'
            )}
          >
            <p className="font-medium">{correct ? 'Correct.' : 'Not quite.'}</p>
            <p className="mt-2 text-muted-foreground">{payload.explanation}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
