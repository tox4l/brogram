'use client'

import { useCallback, useRef, useState } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useCountdown } from './useCountdown'
import { gradePredictOutput, scoreTimedCorrect } from './scoring'

interface PredictOutputPayload {
  language: Language
  snippet: string
  expectedOutput: string
}

export interface PredictOutputProps {
  item: DrillItem
  onResult: (result: DrillResult) => void
  now?: () => number
}

export function PredictOutput({ item, onResult, now = Date.now }: PredictOutputProps) {
  const payload = item.payload as unknown as PredictOutputPayload
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [correct, setCorrect] = useState(false)

  const submittedRef = useRef(false)
  const startRef = useRef(now())
  const elapsed = () => now() - startRef.current

  const submit = useCallback(
    (value: string, elapsedMs: number) => {
      if (submittedRef.current) return
      submittedRef.current = true
      const isCorrect = gradePredictOutput(value, payload.expectedOutput)
      const score = scoreTimedCorrect(isCorrect, elapsedMs, item.timeLimitS)
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
    [item.id, item.kind, item.lane, item.timeLimitS, onResult, payload.expectedOutput, now]
  )

  const { percentRemaining, remainingMs } = useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted,
    onExpire: () => submit(answer, elapsed()),
  })

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Predict the output</CardTitle>
          <Badge variant="outline" className="font-mono uppercase">
            {payload.language}
          </Badge>
        </div>
        <CardDescription>Read the snippet, then type exactly what it prints.</CardDescription>
        <div className="flex items-center gap-3">
          <Progress value={percentRemaining} className="flex-1" />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.ceil(remainingMs / 1000)}s
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-sm leading-relaxed">
          <code>{payload.snippet}</code>
        </pre>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={submitted}
          rows={3}
          placeholder="Type the exact output"
          className="w-full resize-none rounded-lg border border-input bg-transparent p-3 font-mono text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        />

        {!submitted ? (
          <Button className="self-start" onClick={() => submit(answer, elapsed())}>
            Submit
          </Button>
        ) : (
          <div
            className={cn(
              'rounded-lg border p-4 text-sm',
              correct ? 'border-primary/30 bg-primary/10' : 'border-destructive/30 bg-destructive/10'
            )}
          >
            <p className="font-medium">{correct ? 'Correct.' : 'Not quite.'}</p>
            {!correct && (
              <p className="mt-2 text-muted-foreground">
                Expected: <span className="whitespace-pre-wrap font-mono text-foreground">{payload.expectedOutput}</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
