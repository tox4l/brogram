'use client'

import { useCallback, useRef, useState } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useCountdown } from './useCountdown'
import { gradeTrace, scoreTimedCorrect } from './scoring'

interface TracePayload {
  language: Language
  snippet: string
  stepIndex: number
  variables: string[]
  expected: Record<string, string>
}

export interface TraceProps {
  item: DrillItem
  onResult: (result: DrillResult) => void
  now?: () => number
  /** True while the tab is hidden or the run is otherwise away (fix round 1, I3): the clock stops, so time never runs out unseen. */
  paused?: boolean
}

export function Trace({ item, onResult, now = Date.now, paused = false }: TraceProps) {
  const payload = item.payload as unknown as TracePayload

  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(payload.variables.map((name) => [name, '']))
  )
  const [submitted, setSubmitted] = useState(false)
  const [correct, setCorrect] = useState(false)

  const submittedRef = useRef(false)

  const submit = useCallback(
    (values: Record<string, string>, elapsedMs: number) => {
      if (submittedRef.current) return
      submittedRef.current = true
      const isCorrect = gradeTrace(values, payload.expected)
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
    [item.id, item.kind, item.lane, item.timeLimitS, onResult, payload.expected, now]
  )

  // getElapsedMs is the single source of elapsed time (fix round 2, N1): it
  // excludes any span where `paused` was true.
  const { getElapsedMs } = useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted && !paused,
    onExpire: (elapsedMs) => submit(answers, elapsedMs),
  })

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-end gap-3">
          <Badge variant="outline" className="font-mono uppercase">
            {payload.language}
          </Badge>
        </div>
        <CardDescription>After step {payload.stepIndex}, what is each variable&apos;s value?</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-sm leading-relaxed">
          <code>{payload.snippet}</code>
        </pre>

        <div className="flex flex-col gap-3">
          {payload.variables.map((name, idx) => {
            const isWrong = submitted && !correct && (answers[name] ?? '').trim() !== payload.expected[name].trim()
            return (
              <div key={name} className="flex items-center gap-3">
                <label htmlFor={`trace-${name}`} className="w-20 shrink-0 font-mono text-sm text-muted-foreground">
                  {name}
                </label>
                <Input
                  id={`trace-${name}`}
                  aria-label={name}
                  autoFocus={idx === 0}
                  value={answers[name] ?? ''}
                  disabled={submitted}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [name]: e.target.value }))}
                  className="max-w-40 font-mono"
                />
                {isWrong && (
                  <span className="text-sm text-muted-foreground">
                    expected <span className="font-mono text-foreground">{payload.expected[name]}</span>
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {!submitted ? (
          <Button className="self-start" onClick={() => submit(answers, getElapsedMs())}>
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
