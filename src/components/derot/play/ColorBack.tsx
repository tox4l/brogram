'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Diamond, Hexagon, Square, Star, Triangle, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { play, withInterfaceSounds } from '@/lib/sound/manager'
import { countPlantedMatches } from '../scoring'
import { DRILL_META } from '../../../app/(app)/derot/lib'
import type { PlayGameProps } from './types'

/**
 * Colour Back (`color-nback`, R7.4 rule 2): a stream of stimuli where every
 * entry carries BOTH a shape and a colour, in a fixed one-to-one mapping, so
 * the game is completely playable on shape alone -- around 1 in 12 men
 * cannot reliably separate the palette. Never described by colour anywhere
 * in copy or aria text; colour is a purely visual bonus channel, shape is
 * the ground truth. A soft tone (mapped to the same fixed pairing) plays on
 * every new stimulus when `soundOn`, giving a third, audio-only channel.
 */

const N_BACK = 2
const TICK_MS = 2000
const FORCED_MATCH_CHANCE = 0.35

interface Kind {
  id: string
  Icon: LucideIcon
  swatch: string
  freq: number
}

const KINDS: readonly Kind[] = [
  { id: 'circle', Icon: Circle, swatch: 'bg-primary text-primary-foreground', freq: 261.63 },
  { id: 'square', Icon: Square, swatch: 'bg-accent text-accent-foreground', freq: 293.66 },
  { id: 'triangle', Icon: Triangle, swatch: 'bg-success text-success-foreground', freq: 329.63 },
  { id: 'diamond', Icon: Diamond, swatch: 'bg-warning text-warning-foreground', freq: 349.23 },
  { id: 'star', Icon: Star, swatch: 'bg-destructive text-destructive-foreground', freq: 392.0 },
  { id: 'hexagon', Icon: Hexagon, swatch: 'bg-celebration text-celebration-foreground', freq: 440.0 },
]

/** True while an element with focus is a text-entry field elsewhere on the page (buddy drawer, wellness rail). */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function generateSequence(count: number, n: number, rng: () => number): number[] {
  const seq: number[] = []
  for (let i = 0; i < count; i++) {
    if (i >= n && rng() < FORCED_MATCH_CHANCE) seq.push(seq[i - n])
    else seq.push(Math.floor(rng() * KINDS.length))
  }
  return seq
}

/** A short, best-effort sine beep. Never throws (no AudioContext in test/old-browser environments is a silent no-op), and reuses one lazily-created context rather than one per tone. This is decorative-only audio local to this game, separate from the shared sound manager's sprite (Howler owns every catalogued reward/interface cue; this is a synesthetic bonus channel unique to Colour Back). */
let toneCtx: AudioContext | null = null
function playTone(freq: number) {
  try {
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return
    if (!toneCtx) toneCtx = new window.AudioContext()
    const ctx = toneCtx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.24)
  } catch {
    // best-effort only; a beep must never crash the game
  }
}

export interface ColorBackProps extends PlayGameProps {
  /** Test seam: injected clock, defaults to Date.now. */
  now?: () => number
  /** Test seam: injected RNG so the stimulus sequence is deterministic in tests. */
  rng?: () => number
}

export default function ColorBack({ timeLimitS, soundOn, reducedMotion, onComplete, onAbort, now = Date.now, rng = Math.random }: ColorBackProps) {
  const total = Math.max(N_BACK + 4, Math.floor((timeLimitS * 1000) / TICK_MS))
  const [sequence] = useState(() => generateSequence(total, N_BACK, rng))
  const plantedMatches = useMemo(() => countPlantedMatches(sequence.map(String), N_BACK), [sequence])

  const [index, setIndex] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [lastVerdict, setLastVerdict] = useState<'hit' | 'miss' | null>(null)

  const submittedRef = useRef(false)
  const hitsRef = useRef(0)
  const falseAlarmsRef = useRef(0)
  const respondedRef = useRef(false)
  const startRef = useRef(now())

  const finish = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitted(true)
    const raw = Math.max(0, (hitsRef.current - falseAlarmsRef.current) * 100)
    onComplete({
      raw,
      payload: {
        hits: hitsRef.current,
        falseAlarms: falseAlarmsRef.current,
        plantedMatches,
        n: N_BACK,
        stimuli: total,
        elapsedMs: now() - startRef.current,
      },
    })
  }, [onComplete, plantedMatches, total, now])

  // Held in a ref so the tick-scheduling effect never depends on a fresh `finish` identity.
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  })

  const respond = useCallback(() => {
    if (submittedRef.current || respondedRef.current || index >= total) return
    respondedRef.current = true
    const isMatch = index >= N_BACK && sequence[index] === sequence[index - N_BACK]
    if (isMatch) hitsRef.current += 1
    else falseAlarmsRef.current += 1
    setLastVerdict(isMatch ? 'hit' : 'miss')
    if (soundOn) withInterfaceSounds(() => play(isMatch ? 'drill.hit' : 'drill.miss'))
  }, [index, total, sequence, soundOn])

  // Advance one stimulus every TICK_MS, paused for as long as the tab stays
  // hidden (a fresh full tick begins on return rather than a resumed partial
  // one -- simple, and progress genuinely halts while hidden either way).
  useEffect(() => {
    if (submitted) return
    if (index >= total) {
      finishRef.current()
      return
    }
    respondedRef.current = false
    if (soundOn) playTone(KINDS[sequence[index]].freq)

    let id: ReturnType<typeof setTimeout> | null = null
    function schedule() {
      if (document.hidden) return
      id = setTimeout(() => {
        // Clearing the previous verdict happens here, inside the timer
        // callback, rather than synchronously in the effect body, so a new
        // stimulus arrives with a clean slate for the sr-only announcement.
        setLastVerdict(null)
        setIndex((i) => i + 1)
      }, TICK_MS)
    }
    function handleVisibility() {
      if (document.hidden) {
        if (id !== null) {
          clearTimeout(id)
          id = null
        }
      } else if (id === null) {
        schedule()
      }
    }
    schedule()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      if (id !== null) clearTimeout(id)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- soundOn/sequence intentionally excluded: a mid-run sound-toggle change or the (stable) sequence identity must not restart the current tick's timer.
  }, [index, total, submitted])

  // Space/Enter double as the Match button, ignored while focus is in a text field elsewhere on the page.
  useEffect(() => {
    if (submitted) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onAbort()
        return
      }
      if (event.code !== 'Space' && event.key !== ' ' && event.key !== 'Enter') return
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
      respond()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitted, respond, onAbort])

  const currentKind = index < total ? KINDS[sequence[index]] : null
  const CurrentIcon = currentKind?.Icon

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{DRILL_META['color-nback'].title}</CardTitle>
          <Badge variant="outline" className="font-mono uppercase">
            {N_BACK} back
          </Badge>
        </div>
        <CardDescription>Press Match when the current shape is the same as {N_BACK} back.</CardDescription>
        <Progress value={total > 0 ? (index / total) * 100 : 0} />
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-8">
        {!submitted ? (
          <>
            <p className="text-xs tabular-nums text-muted-foreground">
              Shape {Math.min(index + 1, total)} of {total}
            </p>
            <div
              className={
                'flex size-28 items-center justify-center rounded-2xl ' + (currentKind ? currentKind.swatch : 'bg-muted')
              }
              style={{ transition: reducedMotion ? 'none' : 'transform 150ms cubic-bezier(0.22, 1, 0.36, 1)' }}
              aria-hidden="true"
            >
              {CurrentIcon && <CurrentIcon size={56} strokeWidth={1.75} />}
            </div>
            <p className="sr-only" aria-live="polite">
              {lastVerdict === 'hit' ? 'Match.' : lastVerdict === 'miss' ? 'Not a match.' : ''}
            </p>
            <Button size="lg" onClick={respond}>
              Match
            </Button>
            <p className="text-xs text-muted-foreground">or press space</p>
            <button type="button" onClick={onAbort} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
              Quit
            </button>
          </>
        ) : (
          <div className="w-full rounded-lg border border-primary/30 bg-primary/10 p-4 text-center text-sm">
            <p className="font-medium">Run complete.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
