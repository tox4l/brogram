'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrillItem, DrillResult } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useCountdown } from './useCountdown'
import { gradeHoldFocus, scoreTimedCorrect } from './scoring'

interface HoldFocusPayload {
  passage: string
  question: string
  options: string[]
  answerIndex: number
}

export interface HoldFocusProps {
  item: DrillItem
  onResult: (result: DrillResult) => void
  now?: () => number
}

export function HoldFocus({ item, onResult, now = Date.now }: HoldFocusProps) {
  const payload = item.payload as unknown as HoldFocusPayload

  const [submitted, setSubmitted] = useState(false)
  const [voided, setVoided] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)

  const submittedRef = useRef(false)
  const startRef = useRef(now())
  const elapsed = useCallback(() => now() - startRef.current, [now])
  const containerRef = useRef<HTMLDivElement | null>(null)

  const finish = useCallback(
    (selectedIndex: number | null, wasVoided: boolean) => {
      if (submittedRef.current) return
      submittedRef.current = true
      const isCorrect = !wasVoided && gradeHoldFocus(selectedIndex, payload.answerIndex)
      const elapsedMs = elapsed()
      const score = wasVoided ? 0 : scoreTimedCorrect(isCorrect, elapsedMs, item.timeLimitS)
      setSelected(selectedIndex)
      setVoided(wasVoided)
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
    [item.id, item.kind, item.timeLimitS, onResult, payload.answerIndex, now, elapsed]
  )

  const voidDrill = useCallback(() => finish(null, true), [finish])

  const { percentRemaining, remainingMs } = useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted,
    onExpire: () => finish(null, false),
  })

  // Leaving the page voids the drill: blur or the tab going hidden.
  useEffect(() => {
    if (submitted) return
    const onBlur = () => voidDrill()
    const onVisibilityChange = () => {
      if (document.hidden) voidDrill()
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [submitted, voidDrill])

  // No scrolling allowed on the passage: any attempt voids the drill.
  useEffect(() => {
    if (submitted) return
    const node = containerRef.current
    if (!node) return
    const onScrollAttempt = (event: Event) => {
      event.preventDefault()
      voidDrill()
    }
    node.addEventListener('wheel', onScrollAttempt, { passive: false })
    node.addEventListener('touchmove', onScrollAttempt, { passive: false })
    node.addEventListener('scroll', onScrollAttempt)
    return () => {
      node.removeEventListener('wheel', onScrollAttempt)
      node.removeEventListener('touchmove', onScrollAttempt)
      node.removeEventListener('scroll', onScrollAttempt)
    }
  }, [submitted, voidDrill])

  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader className="gap-3">
        <CardTitle>Hold focus</CardTitle>
        <CardDescription>Read the passage without scrolling, then answer the question. Leaving the page voids the drill.</CardDescription>
        <div className="flex items-center gap-3">
          <Progress value={percentRemaining} className="flex-1" />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.ceil(remainingMs / 1000)}s
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          ref={containerRef}
          aria-label="Reading passage"
          className="rounded-lg bg-muted p-4 text-sm leading-relaxed"
          style={{ overflow: 'hidden' }}
        >
          {payload.passage}
        </div>

        {voided && submitted ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <p className="font-medium">Focus lost. The drill was voided.</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">{payload.question}</p>
            <div className="grid gap-2">
              {payload.options.map((option, idx) => {
                const isAnswer = idx === payload.answerIndex
                const isSelected = selected === idx
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={submitted}
                    onClick={() => finish(idx, false)}
                    className={cn(
                      'rounded-lg border border-border px-4 py-2 text-left text-sm transition-colors disabled:cursor-default',
                      !submitted && 'hover:bg-accent',
                      submitted && isAnswer && 'border-primary/30 bg-primary/10',
                      submitted && isSelected && !isAnswer && 'border-destructive/30 bg-destructive/10'
                    )}
                  >
                    {option}
                  </button>
                )
              })}
            </div>
            {submitted && (
              <div
                className={cn(
                  'rounded-lg border p-4 text-sm',
                  selected === payload.answerIndex ? 'border-primary/30 bg-primary/10' : 'border-destructive/30 bg-destructive/10'
                )}
              >
                <p className="font-medium">{selected === payload.answerIndex ? 'Correct.' : 'Not quite.'}</p>
                {selected !== payload.answerIndex && (
                  <p className="mt-2 text-muted-foreground">
                    The correct answer: <span className="text-foreground">{payload.options[payload.answerIndex]}</span>
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
