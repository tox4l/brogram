'use client'

import { useCallback, useRef, useState } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
  /** True while the tab is hidden or the run is otherwise away (fix round 1, I3): the clock stops, so time never runs out unseen. */
  paused?: boolean
}

function preventDefault(e: { preventDefault: () => void }) {
  e.preventDefault()
}

export function SpeedType({ item, onResult, now = Date.now, paused = false }: SpeedTypeProps) {
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
        lane: item.lane,
      })
    },
    [item.id, item.kind, item.lane, onResult, payload.snippet, now]
  )

  useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted && !paused,
    onExpire: () => submit(typed, elapsed()),
  })

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-end gap-3">
          <Badge variant="outline" className="font-mono uppercase">
            {payload.language}
          </Badge>
        </div>
        <CardDescription>Type the snippet exactly. Accuracy matters more than speed; pasting is disabled.</CardDescription>
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
          autoFocus
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
