'use client'

/**
 * Twitch (spec 7.9 Playground table): ten rounds, a shape lights after a
 * random interval, tap or press fast; an early tap voids that round. `raw`
 * handed back through `onComplete` is the mean reaction time in ms across
 * all ten rounds -- the primitive `normalizeReaction` in
 * src/components/derot/scoring.ts expects -- not the already-inverted
 * "10000 minus mean" figure from the spec table (that inversion happens
 * inside the normalize function, which is the route's job to call).
 *
 * An early tap (during the wait, before the shape lights) voids the round:
 * it still counts as one of the ten, but its reaction time is recorded as
 * `VOID_PENALTY_MS` rather than retried, so ten rounds always run in a
 * bounded amount of time and jumping the gun always costs something without
 * ever blocking completion (R7.4: no judgment, but also no free pass).
 *
 * Fix round 1 (A-C1): every `setState` call below sets a plain value, never
 * an updater function that reaches for a ref, a timer or `onComplete` from
 * inside it -- React may replay an updater function (StrictMode's dev
 * double-invoke, a `Suspense` retry, this route mounts the game inside
 * both) and a replayed side effect there double-pushes into `reactionsRef`
 * or double-fires the run's single submit. `phaseRef`/`roundRef` mirror the
 * corresponding state so event handlers and timer callbacks always read the
 * current value directly instead of needing a functional updater.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { CountdownRing } from '@/components/derot/CountdownRing'
import { useCountdown } from '@/components/derot/useCountdown'
import { play } from '@/lib/sound/manager'
import { cn } from '@/lib/utils'
import type { PlayGameProps } from './types'

const ROUNDS = 10
const WAIT_MIN_MS = 700
const WAIT_MAX_MS = 2200
/** No tap within this long after the light -- treated the same as an early tap: a full penalty, never a stuck round. */
const MAX_REACTION_WINDOW_MS = 2500
const VOID_PENALTY_MS = 10000

type RoundPhase = 'waiting' | 'lit' | 'resolved'

/** True when the space/enter key should be left alone because focus is in a text field elsewhere (buddy drawer, wellness rail). */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Deterministic-under-test wait: injectable so a test can pin the interval instead of racing real randomness. */
export function randomWaitMs(random: () => number = Math.random): number {
  return WAIT_MIN_MS + Math.round(random() * (WAIT_MAX_MS - WAIT_MIN_MS))
}

/** Fix round 1 (A-I3): `useCountdown` drives off wall-clock time with no visibility gate of its own, so every game that owns one gates its `active` flag off this. */
function useHiddenTab(): boolean {
  const [hidden, setHidden] = useState(() => (typeof document !== 'undefined' ? document.hidden : false))
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  return hidden
}

export default function Twitch({ timeLimitS, soundOn, reducedMotion, onComplete, onAbort }: PlayGameProps) {
  const [round, setRound] = useState(1)
  const [phase, setPhase] = useState<RoundPhase>('waiting')
  const [voided, setVoided] = useState(false)

  const roundRef = useRef(round)
  useEffect(() => { roundRef.current = round })
  const phaseRef = useRef<RoundPhase>(phase)
  useEffect(() => { phaseRef.current = phase })

  const reactionsRef = useRef<number[]>([])
  const litAtRef = useRef<number | null>(null)
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const windowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishedRef = useRef(false)
  const soundOnRef = useRef(soundOn)
  useEffect(() => { soundOnRef.current = soundOn })

  const hidden = useHiddenTab()
  const hiddenRef = useRef(hidden)
  useEffect(() => { hiddenRef.current = hidden })

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current)
    if (windowTimerRef.current) clearTimeout(windowTimerRef.current)
    if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current)
    const reactions = reactionsRef.current
    // Pad any rounds the overall safety-net timer cut short with the same void penalty -- the run always produces ten data points.
    while (reactions.length < ROUNDS) reactions.push(VOID_PENALTY_MS)
    const meanReactionMs = reactions.reduce((sum, ms) => sum + ms, 0) / reactions.length
    onComplete({ raw: meanReactionMs, payload: { reactions: [...reactions] } })
  }, [onComplete])

  const finishRef = useRef(finish)
  useEffect(() => { finishRef.current = finish })

  const { remainingMs, percentRemaining } = useCountdown({ timeLimitS, active: !hidden, onExpire: finish })

  /**
   * Pure: sets state to plain values only, never reaches into a ref or fires
   * `onComplete` from inside a `setState` updater (A-C1). Safe to call from a
   * timer callback or an event handler, never from inside another updater.
   */
  const advanceToNextRound = useCallback(() => {
    if (finishedRef.current) return
    if (roundRef.current >= ROUNDS) {
      finishRef.current()
      return
    }
    setRound(roundRef.current + 1)
  }, [])

  // Starts (and re-starts, on every `round` or visibility change) exactly one round: wait, then
  // light, then either a tap resolves it or the reaction window times out and it advances on its
  // own. A-I2: while the tab is hidden this effect does nothing at all (no timer is scheduled);
  // becoming visible again re-runs it as a fresh round rather than crediting unseen time.
  useEffect(() => {
    if (finishedRef.current || hidden) return
    setPhase('waiting')
    setVoided(false)
    litAtRef.current = null

    const wait = randomWaitMs()
    waitTimerRef.current = setTimeout(() => {
      litAtRef.current = Date.now()
      setPhase('lit')
      if (soundOnRef.current) play('ui.tap', { volumeScale: 0.5 })
      windowTimerRef.current = setTimeout(() => {
        reactionsRef.current.push(VOID_PENALTY_MS)
        advanceToNextRound()
      }, MAX_REACTION_WINDOW_MS)
    }, wait)

    return () => {
      if (waitTimerRef.current) clearTimeout(waitTimerRef.current)
      if (windowTimerRef.current) clearTimeout(windowTimerRef.current)
    }
  }, [round, hidden, advanceToNextRound])

  /**
   * Pure: reads the current phase from `phaseRef` (never a `setPhase` updater), does every side
   * effect (the ref push, the sound, the timer) in the handler body, then sets plain state values.
   */
  const respond = useCallback(() => {
    if (finishedRef.current || hiddenRef.current) return
    const currentPhase = phaseRef.current
    if (currentPhase === 'waiting') {
      if (waitTimerRef.current) clearTimeout(waitTimerRef.current)
      reactionsRef.current.push(VOID_PENALTY_MS)
      if (soundOnRef.current) play('drill.miss', { volumeScale: 0.6 })
      setVoided(true)
      setPhase('resolved')
      resolveTimerRef.current = setTimeout(advanceToNextRound, 400)
      return
    }
    if (currentPhase === 'lit') {
      if (windowTimerRef.current) clearTimeout(windowTimerRef.current)
      const litAt = litAtRef.current ?? Date.now()
      reactionsRef.current.push(Date.now() - litAt)
      if (soundOnRef.current) play('drill.hit', { volumeScale: 0.6 })
      setPhase('resolved')
      resolveTimerRef.current = setTimeout(advanceToNextRound, 250)
    }
  }, [advanceToNextRound])

  useEffect(() => {
    return () => { if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current) }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== 'Enter' && event.key !== ' ') return
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
      respond()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [respond])

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CountdownRing remainingMs={remainingMs} percentRemaining={percentRemaining} reduced={reducedMotion} />
          <Button variant="ghost" size="sm" onClick={onAbort}>Quit</Button>
        </div>
        <CardDescription>Tap the instant the shape lights up. Tapping too soon voids the round.</CardDescription>
        <p className="text-micro tabular-nums text-muted-foreground">Round {round} of {ROUNDS}</p>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-8">
        <button
          type="button"
          data-testid="twitch-target"
          onClick={respond}
          className={cn(
            'flex size-32 items-center justify-center rounded-2xl border-2 text-small font-medium outline-none',
            !reducedMotion && 'transition-colors',
            phase === 'lit' && 'border-primary bg-primary text-primary-foreground',
            phase === 'waiting' && 'border-border bg-muted text-muted-foreground',
            phase === 'resolved' && voided && 'border-destructive/50 bg-destructive/10 text-destructive',
            phase === 'resolved' && !voided && 'border-primary/40 bg-primary/10 text-primary',
            'focus-visible:ring-2 focus-visible:ring-ring'
          )}
        >
          {phase === 'lit' ? 'Tap now' : phase === 'waiting' ? 'Wait for it' : voided ? 'Too soon' : 'Got it'}
        </button>
        <p className="text-micro text-muted-foreground">or press space / enter</p>
      </CardContent>
    </Card>
  )
}
