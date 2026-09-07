'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DRILL_META } from '../../../app/(app)/derot/lib'
import type { PlayGameProps } from './types'

/**
 * Breathe (`breathe`, R7.4 rule 4): a 4-7-8 pacer that cannot be failed. The
 * phase clock is entirely automatic -- a tap never speeds it up and its
 * absence never slows it down -- so a learner who does nothing at all still
 * completes the full run and still scores. Tap (or hold; both do the same
 * thing here, since pacing was never gated on input) is purely a "join in"
 * gesture with its own visual feedback. This is the one Playground game the
 * spec explicitly hands the full celebration budget (R7.4): transform and
 * opacity only, and under reduced motion the shape is replaced outright by
 * a stepped, textual pacer -- phase name plus a count -- never dimmed in place.
 */

const PHASES = [
  { key: 'inhale', label: 'Breathe in', ms: 4000 },
  { key: 'hold', label: 'Hold', ms: 7000 },
  { key: 'exhale', label: 'Breathe out', ms: 8000 },
] as const

const CYCLE_MS = PHASES.reduce((sum, phase) => sum + phase.ms, 0)
const TICK_MS = 250

/** 1 at rest, grows to 1.35 through the inhale, holds, shrinks back through the exhale. Transform-only. */
function scaleFor(phaseIndex: number, progress: number): number {
  if (phaseIndex === 0) return 1 + 0.35 * progress
  if (phaseIndex === 1) return 1.35
  return 1.35 - 0.35 * progress
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export default function Breathe({ timeLimitS, reducedMotion, onComplete, onAbort }: PlayGameProps) {
  const totalMs = Math.max(0, Math.round(timeLimitS * 1000))

  const [submitted, setSubmitted] = useState(false)
  const [holding, setHolding] = useState(false)
  // Refs are the timing source of truth (mutated in the interval callback,
  // read in `finish`); render never touches them directly -- only this
  // state snapshot, copied from the refs once per tick, drives the display.
  const [snapshot, setSnapshot] = useState({ phaseIndex: 0, phaseElapsedMs: 0 })

  const submittedRef = useRef(false)
  const phaseIndexRef = useRef(0)
  const phaseElapsedRef = useRef(0)
  const totalActiveMsRef = useRef(0)
  const tapsRef = useRef(0)

  const finish = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitted(true)
    const raw = totalMs <= 0 ? 100 : Math.min(100, Math.round((totalActiveMsRef.current / totalMs) * 100))
    onComplete({
      raw,
      payload: {
        completionPercent: raw,
        cyclesCompleted: Math.floor(totalActiveMsRef.current / CYCLE_MS),
        tapsGiven: tapsRef.current,
      },
    })
  }, [onComplete, totalMs])

  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  })

  // The one clock driving everything: phase progression and total completion
  // both derive from the same accumulator, which only advances while the tab
  // is visible -- that is the whole of "paused when hidden" for this game.
  useEffect(() => {
    if (submitted) return
    let id: ReturnType<typeof setInterval> | null = null

    function tick() {
      phaseElapsedRef.current += TICK_MS
      totalActiveMsRef.current += TICK_MS
      const phase = PHASES[phaseIndexRef.current]
      if (phaseElapsedRef.current >= phase.ms) {
        phaseElapsedRef.current = 0
        phaseIndexRef.current = (phaseIndexRef.current + 1) % PHASES.length
      }
      if (totalActiveMsRef.current >= totalMs) {
        if (id !== null) {
          clearInterval(id)
          id = null
        }
        finishRef.current()
        return
      }
      setSnapshot({ phaseIndex: phaseIndexRef.current, phaseElapsedMs: phaseElapsedRef.current })
    }

    function start() {
      if (id !== null || document.hidden) return
      id = setInterval(tick, TICK_MS)
    }
    function stop() {
      if (id !== null) {
        clearInterval(id)
        id = null
      }
    }
    function handleVisibility() {
      if (document.hidden) stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [submitted, totalMs])

  const tap = useCallback(() => {
    if (submittedRef.current) return
    tapsRef.current += 1
  }, [])

  useEffect(() => {
    if (submitted) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onAbort()
        return
      }
      if (event.repeat) return
      if (isTextEntryTarget(event.target)) return
      if (event.code === 'Space' || event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        setHolding(true)
        tap()
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space' || event.key === ' ' || event.key === 'Enter') setHolding(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [submitted, tap, onAbort])

  const phase = PHASES[snapshot.phaseIndex]
  const progress = Math.min(1, snapshot.phaseElapsedMs / phase.ms)
  const secondsLeft = Math.max(0, Math.ceil((phase.ms - snapshot.phaseElapsedMs) / 1000))
  const scale = scaleFor(snapshot.phaseIndex, progress)

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <CardTitle>{DRILL_META.breathe.title}</CardTitle>
        <CardDescription>A four-seven-eight pace. This one cannot be failed — tap along or just watch.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-12">
        {/* Fix round 1 (B-I2): announce phase transitions only (3x per 19s
            cycle) plus completion -- not the count, which changed every
            second and queued roughly ninety announcements across a run. This
            one element stays mounted through submit so the swap to "Run
            complete." is itself announced. */}
        <p aria-live="polite" className="sr-only">
          {submitted ? 'Run complete.' : `${phase.label}.`}
        </p>
        {!submitted ? (
          <>
            {reducedMotion ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <p className="text-h3 text-foreground">{phase.label}</p>
                <p role="timer" aria-live="off" className="font-mono text-h1 tabular-nums text-primary">
                  {secondsLeft}
                </p>
              </div>
            ) : (
              <div
                // W4 spec section 9 (/derot): "Breathe keeps its transform-only
                // pacer and gains a static radial-gradient aura on the
                // existing scaleFor transform for 0 KB" -- the gradient is a
                // static paint layer riding the same `transform`/`opacity`
                // the pacer already animates; it adds no animated property of
                // its own.
                className="relative flex size-48 items-center justify-center rounded-full bg-primary/10"
                style={{
                  transform: `scale(${scale})`,
                  opacity: 0.7 + 0.3 * (snapshot.phaseIndex === 1 ? 1 : progress),
                  transition: `transform ${TICK_MS}ms linear, opacity ${TICK_MS}ms linear`,
                  backgroundImage: 'radial-gradient(circle at 50% 50%, var(--glow), transparent 70%)',
                }}
                aria-hidden="true"
              >
                <div className="flex flex-col items-center gap-1 rounded-full bg-primary/25 px-6 py-6 text-center">
                  <span className="text-small font-medium text-primary-foreground">{phase.label}</span>
                  <span role="timer" aria-live="off" className="font-mono text-h2 tabular-nums text-primary-foreground">
                    {secondsLeft}
                  </span>
                </div>
              </div>
            )}
            <Button
              size="lg"
              variant={holding ? 'default' : 'outline'}
              onPointerDown={() => {
                setHolding(true)
                tap()
              }}
              onPointerUp={() => setHolding(false)}
              onPointerLeave={() => setHolding(false)}
            >
              Tap to breathe with it
            </Button>
            <p className="text-micro text-muted-foreground">Optional — hold or tap space, or just let it run.</p>
            <button type="button" onClick={onAbort} className="text-micro text-muted-foreground underline-offset-2 hover:underline">
              Quit
            </button>
          </>
        ) : (
          <div className="w-full rounded-lg border border-primary/30 bg-primary/10 p-4 text-center text-small">
            <p className="font-medium">Run complete.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
