'use client'

import { useCallback, useRef, useState } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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
}

export function SpotTheBug({ item, onResult, now = Date.now }: SpotTheBugProps) {
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
      })
    },
    [item.id, item.kind, item.timeLimitS, onResult, payload.bugLines, now]
  )

  const { percentRemaining, remainingMs } = useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted,
    onExpire: () => submit(selectedLine, elapsed()),
  })

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Spot the bug</CardTitle>
          <Badge variant="outline" className="font-mono uppercase">
            {payload.language}
          </Badge>
        </div>
        <CardDescription>Click the line that causes the bug.</CardDescription>
        <div className="flex items-center gap-3">
          <Progress value={percentRemaining} className="flex-1" />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.ceil(remainingMs / 1000)}s
          </span>
        </div>
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
