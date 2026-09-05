'use client'

import { useCallback, useRef, useState } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useCountdown } from './useCountdown'
import { gradeSpeedType } from './scoring'

interface SpeedTypePayload {
  language: Language
  snippet: string
}

export interface SpeedTypeProps {
  item: DrillItem
  onResult: (result: DrillResult) => void
  now?: () => number
}

function preventDefault(e: { preventDefault: () => void }) {
  e.preventDefault()
}

export function SpeedType({ item, onResult, now = Date.now }: SpeedTypeProps) {
  const payload = item.payload as unknown as SpeedTypePayload
  const [typed, setTyped] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [correct, setCorrect] = useState(false)
  const [accuracy, setAccuracy] = useState(0)

  const submittedRef = useRef(false)
  const startRef = useRef(now())
  const elapsed = () => now() - startRef.current

  const submit = useCallback(
    (value: string, elapsedMs: number) => {
      if (submittedRef.current) return
      submittedRef.current = true
      const grade = gradeSpeedType(value, payload.snippet)
      setCorrect(grade.correct)
      setAccuracy(grade.accuracy)
      setSubmitted(true)
      onResult({
        drillId: item.id,
        kind: item.kind,
        correct: grade.correct,
        timeMs: elapsedMs,
        score: grade.score,
        at: new Date(now()).toISOString(),
      })
    },
    [item.id, item.kind, onResult, payload.snippet, now]
  )

  const { percentRemaining, remainingMs } = useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted,
    onExpire: () => submit(typed, elapsed()),
  })

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Speed type</CardTitle>
          <Badge variant="outline" className="font-mono uppercase">
            {payload.language}
          </Badge>
        </div>
        <CardDescription>Type the snippet exactly. Accuracy matters more than speed; pasting is disabled.</CardDescription>
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
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onPaste={preventDefault}
          onCopy={preventDefault}
          onCut={preventDefault}
          onContextMenu={preventDefault}
          onDrop={preventDefault}
          disabled={submitted}
          rows={4}
          spellCheck={false}
          placeholder="Type the snippet here"
          className="w-full resize-none rounded-lg border border-input bg-transparent p-3 font-mono text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        />

        {!submitted ? (
          <Button className="self-start" onClick={() => submit(typed, elapsed())}>
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
            <p className="mt-2 text-muted-foreground">Accuracy: {Math.round(accuracy * 100)}%</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
