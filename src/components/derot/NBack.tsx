'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DrillItem, DrillResult, Language } from '@/lib/contracts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useCountdown } from './useCountdown'
import { countPlantedMatches, gradeNBack } from './scoring'

interface NBackPayload {
  n: number
  tokens: string[]
  language: Language
}

export interface NBackProps {
  item: DrillItem
  onResult: (result: DrillResult) => void
  now?: () => number
}

const TOKEN_INTERVAL_MS = 1500

export function NBack({ item, onResult, now = Date.now }: NBackProps) {
  const payload = item.payload as unknown as NBackPayload
  const total = payload.tokens.length
  const plantedMatches = useMemo(() => countPlantedMatches(payload.tokens, payload.n), [payload.tokens, payload.n])

  const [index, setIndex] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  const submittedRef = useRef(false)
  const hitsRef = useRef(0)
  const falseAlarmsRef = useRef(0)
  const respondedRef = useRef(false)
  const startRef = useRef(now())
  const elapsed = useCallback(() => now() - startRef.current, [now])

  const finish = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    const { correct, score } = gradeNBack(hitsRef.current, falseAlarmsRef.current, plantedMatches)
    const elapsedMs = elapsed()
    setSubmitted(true)
    onResult({
      drillId: item.id,
      kind: item.kind,
      correct,
      timeMs: elapsedMs,
      score,
      at: new Date(now()).toISOString(),
    })
  }, [item.id, item.kind, onResult, plantedMatches, now, elapsed])

  const respond = useCallback(() => {
    if (submittedRef.current || respondedRef.current || index >= total) return
    respondedRef.current = true
    const isMatch = index >= payload.n && payload.tokens[index] === payload.tokens[index - payload.n]
    if (isMatch) hitsRef.current += 1
    else falseAlarmsRef.current += 1
  }, [index, total, payload.n, payload.tokens])

  // Advance to the next token every 1500ms; once past the last token, the drill ends.
  useEffect(() => {
    if (submitted) return
    if (index >= total) {
      finish()
      return
    }
    respondedRef.current = false
    const id = setTimeout(() => setIndex((i) => i + 1), TOKEN_INTERVAL_MS)
    return () => clearTimeout(id)
  }, [index, total, submitted, finish])

  // Space bar doubles as the Match button.
  useEffect(() => {
    if (submitted) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault()
        respond()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitted, respond])

  // Overall time-limit safety net, in case the token stream would outrun it.
  const { percentRemaining, remainingMs } = useCountdown({
    timeLimitS: item.timeLimitS,
    now,
    active: !submitted,
    onExpire: finish,
  })

  const currentToken = index < total ? payload.tokens[index] : null

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>N-back</CardTitle>
          <Badge variant="outline" className="font-mono uppercase">
            n = {payload.n}
          </Badge>
        </div>
        <CardDescription>Press Match when the current token equals the one {payload.n} back.</CardDescription>
        <div className="flex items-center gap-3">
          <Progress value={percentRemaining} className="flex-1" />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.ceil(remainingMs / 1000)}s
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-8">
        {!submitted ? (
          <>
            <p className="text-xs tabular-nums text-muted-foreground">
              Token {Math.min(index + 1, total)} of {total}
            </p>
            <div className="flex h-24 w-full items-center justify-center rounded-lg bg-muted font-mono text-3xl">
              {currentToken}
            </div>
            <Button size="lg" onClick={respond}>
              Match
            </Button>
            <p className="text-xs text-muted-foreground">or press space</p>
          </>
        ) : (
          <div className="w-full rounded-lg border border-primary/30 bg-primary/10 p-4 text-center text-sm">
            <p className="font-medium">Drill complete.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
