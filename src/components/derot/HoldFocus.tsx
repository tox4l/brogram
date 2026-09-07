'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrillItem, DrillResult } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
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
  /** True while the tab is hidden or the run is otherwise away (fix round 1, I3). Largely moot here: blur/visibilitychange already void this drill outright, which is the correct, stricter behaviour for a hold-focus mechanic. */
  paused?: boolean
}

export function HoldFocus({ item, onResult, now = Date.now, paused = false }: HoldFocusProps) {
  const payload = item.payload as unknown as HoldFocusPayload

  const [submitted, setSubmitted] = useState(false)
  const [voided, setVoided] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)

  const submittedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // `finish` takes elapsedMs as a parameter, computed by each call site from
  // `getElapsedMs` (fix round 2, N1) -- the single source of elapsed time,
  // excluding any span where `paused` was true. This also breaks what would
  // otherwise be a circular dependency: `finish` no longer needs anything
  // `useCountdown` returns to be defined first.
  const finish = useCallback(
    (selectedIndex: number | null, wasVoided: boolean, elapsedMs: number) => {
      if (submittedRef.current) return
      submittedRef.current = true
      const isCorrect = !wasVoided && gradeHoldFocus(selectedIndex, payload.answerIndex)
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
        lane: item.lane,
      })
    },
    [item.id, item.kind, item.lane, item.timeLimitS, onResult, payload.answerIndex, now]
  )

  const { getElapsedMs } = useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted && !paused,
    onExpire: (elapsedMs) => finish(null, false, elapsedMs),
  })

  const voidDrill = useCallback(() => finish(null, true, getElapsedMs()), [finish, getElapsedMs])

  // Focus lands on the passage itself, not an answer option -- the point of
  // this drill is reading first (fix round 1, I4: a fresh item always moves
  // focus to its first control; here that's the passage, not a pre-selected
  // answer, which would tempt an early click).
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

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
        <CardDescription>Read the passage without scrolling, then answer the question. Leaving the page voids the drill.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          ref={containerRef}
          tabIndex={-1}
          aria-label="Reading passage"
          className="rounded-lg bg-muted p-4 text-sm leading-relaxed outline-none"
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
                    onClick={() => finish(idx, false, getElapsedMs())}
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
