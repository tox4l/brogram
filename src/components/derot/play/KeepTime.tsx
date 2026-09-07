'use client'

/**
 * Keep Time (spec 7.9 Playground table, accessibility rule 3): tap on the
 * beat while the tempo drifts. `raw` handed back through `onComplete` is the
 * mean absolute offset in ms between each tap and the nearest beat -- the
 * primitive `normalizeRhythm` in src/components/derot/scoring.ts expects --
 * not the already-inverted score from the spec table (that inversion, and
 * the tolerance window, live inside the normalize function, which is the
 * route's job to call).
 *
 * Rule 3 (must not be audio-only): the beat is a visual pulse plus a
 * travelling marker that reaches the end of its track exactly on the beat,
 * always rendered regardless of `soundOn` -- muted or deaf, the beat is
 * still there to tap along to. Sound (a soft tick per beat) only plays when
 * `soundOn` is true.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { CountdownRing } from '@/components/derot/CountdownRing'
import { useCountdown } from '@/components/derot/useCountdown'
import { RHYTHM_OFFSET_TOLERANCE_MS } from '@/components/derot/scoring'
import { play } from '@/lib/sound/manager'
import type { PlayGameProps } from './types'

const BASE_INTERVAL_MS = 750
const DRIFT_MS = 180
const DRIFT_PERIOD_BEATS = 8

/**
 * Every beat instant from 0 to durationMs, as a plain sorted array -- pure
 * and deterministic, so it is pinned directly by a unit test rather than by
 * racing a running rAF loop. The interval between consecutive beats drifts
 * smoothly with a sine wave over `driftPeriodBeats` beats; the tempo is
 * never random, so "drifts" reads the same way on every run.
 */
export function buildBeatSchedule(
  durationMs: number,
  baseIntervalMs: number = BASE_INTERVAL_MS,
  driftMs: number = DRIFT_MS,
  driftPeriodBeats: number = DRIFT_PERIOD_BEATS,
): number[] {
  const beats: number[] = [0]
  let t = 0
  let i = 0
  while (t < durationMs) {
    const interval = baseIntervalMs + driftMs * Math.sin((i / driftPeriodBeats) * 2 * Math.PI)
    t += Math.max(200, interval)
    beats.push(t)
    i += 1
  }
  return beats
}

/** The absolute value of the smallest distance from `elapsedMs` to any scheduled beat -- what a tap is graded against. */
export function nearestBeatOffsetMs(elapsedMs: number, beatTimes: readonly number[]): number {
  let best = Infinity
  for (const beat of beatTimes) {
    const distance = Math.abs(elapsedMs - beat)
    if (distance < best) best = distance
    if (beat - elapsedMs > best) break // beats are sorted ascending; nothing further can be closer.
  }
  return Number.isFinite(best) ? best : RHYTHM_OFFSET_TOLERANCE_MS
}

/** Which beat window `elapsedMs` currently sits in, and how far through it (0 at the beat, approaching 1 just before the next one) -- drives the pulse and the travelling marker. */
export function beatProgressAt(elapsedMs: number, beatTimes: readonly number[]): { index: number; progress: number } {
  let index = 0
  for (let i = 0; i < beatTimes.length - 1; i++) {
    index = i
    if (elapsedMs < beatTimes[i + 1]) break
  }
  const start = beatTimes[index]
  const end = beatTimes[Math.min(index + 1, beatTimes.length - 1)]
  const span = Math.max(1, end - start)
  const progress = Math.min(1, Math.max(0, (elapsedMs - start) / span))
  return { index, progress }
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

export default function KeepTime({ timeLimitS, soundOn, reducedMotion, onComplete, onAbort }: PlayGameProps) {
  const pulseRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const trackWidthRef = useRef(240)

  const beatTimesRef = useRef<number[] | undefined>(undefined)
  if (beatTimesRef.current === undefined) beatTimesRef.current = buildBeatSchedule(timeLimitS * 1000)

  const elapsedMsRef = useRef(0)
  const lastBeatIndexRef = useRef(-1)
  const offsetsRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const soundOnRef = useRef(soundOn)
  useEffect(() => { soundOnRef.current = soundOn })

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const offsets = offsetsRef.current
    const meanAbsOffsetMs = offsets.length > 0
      ? offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length
      : RHYTHM_OFFSET_TOLERANCE_MS
    onComplete({ raw: meanAbsOffsetMs, payload: { taps: offsets.length, beats: (beatTimesRef.current?.length ?? 1) - 1 } })
  }, [onComplete])

  const hidden = useHiddenTab()
  const { remainingMs, percentRemaining } = useCountdown({ timeLimitS, active: !hidden, onExpire: finish })

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    // A track not yet laid out (or no ResizeObserver at all -- jsdom has neither) reports 0;
    // keep the sane fallback width rather than collapsing the marker's travel to nothing.
    const measure = () => { if (el.clientWidth > 0) trackWidthRef.current = el.clientWidth }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let paused = document.visibilityState === 'hidden'
    let lastTs: number | null = null
    const onVisibility = () => {
      paused = document.visibilityState === 'hidden'
      if (paused) lastTs = null
    }
    document.addEventListener('visibilitychange', onVisibility)

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick)
      if (paused) return
      if (lastTs === null) lastTs = now
      elapsedMsRef.current += now - lastTs
      lastTs = now

      const beatTimes = beatTimesRef.current ?? [0]
      const { index, progress } = beatProgressAt(elapsedMsRef.current, beatTimes)
      const isNewBeat = index !== lastBeatIndexRef.current
      if (isNewBeat) {
        lastBeatIndexRef.current = index
        if (soundOnRef.current) play('ui.tap', { volumeScale: 0.4 })
      }

      // Fix round 1 (A-I4): under reduced motion, a discrete snap once per beat -- never a
      // per-frame tween. Rule 1's substitute card offers this game as a movement-free
      // alternative, so it cannot itself keep animating every frame regardless of the setting.
      if (reducedMotion) {
        if (isNewBeat) {
          if (pulseRef.current) pulseRef.current.style.opacity = index % 2 === 0 ? '1' : '0.5'
          if (markerRef.current) markerRef.current.style.transform = `translateX(${index % 2 === 0 ? trackWidthRef.current : 0}px)`
        }
        return
      }

      if (pulseRef.current) {
        pulseRef.current.style.transform = `scale(${1 + 0.35 * (1 - progress)})`
        pulseRef.current.style.opacity = String(1 - 0.6 * progress)
      }
      if (markerRef.current) {
        markerRef.current.style.transform = `translateX(${progress * trackWidthRef.current}px)`
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [reducedMotion])

  const tap = useCallback(() => {
    if (finishedRef.current) return
    const offset = nearestBeatOffsetMs(elapsedMsRef.current, beatTimesRef.current ?? [0])
    offsetsRef.current.push(offset)
    if (soundOnRef.current) play('drill.hit', { volumeScale: 0.5 })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      event.preventDefault()
      tap()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tap])

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CountdownRing remainingMs={remainingMs} percentRemaining={percentRemaining} reduced={reducedMotion} />
          <Button variant="ghost" size="sm" onClick={onAbort}>Quit</Button>
        </div>
        <CardDescription>Tap on every beat. The tempo drifts, so listen and watch, do not count.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-8">
        <div className="flex h-28 w-full items-center justify-center rounded-lg bg-muted">
          <div
            ref={pulseRef}
            data-testid="rhythm-pulse"
            className="size-16 rounded-full bg-primary"
            style={{ transform: 'scale(1)' }}
            aria-hidden="true"
          />
        </div>
        <div ref={trackRef} data-testid="rhythm-track" className="relative h-2 w-full rounded-full bg-muted">
          <div
            ref={markerRef}
            data-testid="rhythm-marker"
            className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-foreground"
            style={{ transform: 'translateX(0px)' }}
            aria-hidden="true"
          />
        </div>
        <Button size="lg" onClick={tap} data-testid="rhythm-tap">Tap</Button>
        <p className="text-micro text-muted-foreground">or press space / enter</p>
      </CardContent>
    </Card>
  )
}
