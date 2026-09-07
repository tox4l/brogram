'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { DRILL_META } from '../../../app/(app)/derot/lib'
import type { PlayGameProps } from './types'

/**
 * Grid (`memory-grid`): a pattern flashes across the 4x4 grid, the learner
 * reproduces it in the same order, and it grows by one cell every round
 * cleared. Fully keyboard playable: arrow keys move a roving cursor, Enter
 * or Space (native `<button>` activation) selects a cell, and every cell
 * carries an aria-label naming its row and column -- never just a colour
 * or a position implied by sight alone.
 */

const GRID_SIZE = 4
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const BASE_PATTERN_LENGTH = 3
const FLASH_STEP_MS = 550
const SAFETY_TICK_MS = 250

type Phase = 'flashing' | 'input' | 'done'

function generatePattern(round: number, rng: () => number): number[] {
  const length = Math.min(CELL_COUNT - 1, BASE_PATTERN_LENGTH + (round - 1))
  const pool = Array.from({ length: CELL_COUNT }, (_, i) => i)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  return pool.slice(0, length)
}

export interface MemoryGridProps extends PlayGameProps {
  /** Test seam: injected RNG so the flashed pattern is deterministic in tests. */
  rng?: () => number
}

export default function MemoryGrid({ timeLimitS, reducedMotion, onComplete, onAbort, rng = Math.random }: MemoryGridProps) {
  const totalMs = Math.max(0, Math.round(timeLimitS * 1000))

  const [round, setRound] = useState(1)
  const [roundsCleared, setRoundsCleared] = useState(0)
  const [phase, setPhase] = useState<Phase>('flashing')
  const [flashIndex, setFlashIndex] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  const [focusedIndex, setFocusedIndex] = useState(5)
  const [submitted, setSubmitted] = useState(false)
  // Bumped (never the round number) on a miss so the pattern is re-drawn at
  // the same length instead of replaying byte-for-byte (fix round 1, B-I1):
  // a wrong cell used to end the whole run; now it only ends the round.
  const [roundAttempt, setRoundAttempt] = useState(0)
  const [justMissed, setJustMissed] = useState(false)
  // Refs are the timing source of truth (mutated in the interval callback,
  // read in `finish`); render never touches them directly -- only this
  // state snapshot, copied from the ref once per tick, drives the display.
  const [elapsedMs, setElapsedMs] = useState(0)

  // `roundAttempt` is not read inside `generatePattern` -- it exists purely
  // to force a fresh shuffle at the same length after a miss (`missRound`),
  // since otherwise this memo would replay byte-for-byte on an unchanged `round`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pattern = useMemo(() => generatePattern(round, rng), [round, rng, roundAttempt])
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([])
  const submittedRef = useRef(false)
  const roundsClearedRef = useRef(0)
  const totalActiveMsRef = useRef(0)

  const finish = useCallback(() => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitted(true)
    setPhase('done')
    const cleared = roundsClearedRef.current
    onComplete({ raw: cleared * 250, payload: { roundsCleared: cleared } })
  }, [onComplete])

  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  })

  useEffect(() => {
    cellRefs.current[focusedIndex]?.focus()
    // Only on mount -- later focus moves are driven explicitly by arrow-key navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Overall time-limit safety net (paused while the tab is hidden): a slow
  // learner still gets a scored run at timeLimitS, capped at whatever they
  // had fully cleared, never mid-round.
  useEffect(() => {
    if (submitted) return
    let id: ReturnType<typeof setInterval> | null = null
    function tick() {
      totalActiveMsRef.current += SAFETY_TICK_MS
      if (totalActiveMsRef.current >= totalMs) {
        if (id !== null) {
          clearInterval(id)
          id = null
        }
        finishRef.current()
        return
      }
      setElapsedMs(totalActiveMsRef.current)
    }
    function start() {
      if (id !== null || document.hidden) return
      id = setInterval(tick, SAFETY_TICK_MS)
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

  // The flash sequence for the current round, one cell at a time, paused
  // while the tab is hidden.
  useEffect(() => {
    if (phase !== 'flashing' || submitted) return
    let id: ReturnType<typeof setTimeout> | null = null
    function schedule() {
      if (document.hidden) return
      id = setTimeout(() => {
        // Whether this step reveals the next cell or opens the grid for
        // input is decided here, inside the timer callback, never
        // synchronously in the effect body.
        if (flashIndex + 1 >= pattern.length) {
          setPhase('input')
          setJustMissed(false)
        } else {
          setFlashIndex((i) => i + 1)
        }
      }, FLASH_STEP_MS)
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
  }, [phase, flashIndex, pattern.length, submitted])

  const completeRound = useCallback(() => {
    roundsClearedRef.current += 1
    setRoundsCleared(roundsClearedRef.current)
    setSelected([])
    setFlashIndex(0)
    setJustMissed(false)
    setPhase('flashing')
    setRound((r) => r + 1)
  }, [])

  // Fix round 1 (B-I1 / ruling 2): the Twitch precedent -- "an early tap
  // voids that round" -- not the run. A wrong cell scores nothing for this
  // attempt, re-flashes the same pattern length (a fresh draw, not a
  // replay), and the overall `timeLimitS` safety net is what ends the run.
  const missRound = useCallback(() => {
    setSelected([])
    setFlashIndex(0)
    setJustMissed(true)
    setPhase('flashing')
    setRoundAttempt((n) => n + 1)
  }, [])

  const selectCell = useCallback(
    (index: number) => {
      if (phase !== 'input' || submittedRef.current) return
      const expected = pattern[selected.length]
      if (index !== expected) {
        missRound()
        return
      }
      const nextSelected = [...selected, index]
      if (nextSelected.length === pattern.length) completeRound()
      else setSelected(nextSelected)
    },
    [phase, pattern, selected, missRound, completeRound]
  )

  useEffect(() => {
    if (submitted) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onAbort()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitted, onAbort])

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const { key } = event
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return
    event.preventDefault()
    const row = Math.floor(focusedIndex / GRID_SIZE)
    const col = focusedIndex % GRID_SIZE
    let nextRow = row
    let nextCol = col
    if (key === 'ArrowUp') nextRow = Math.max(0, row - 1)
    if (key === 'ArrowDown') nextRow = Math.min(GRID_SIZE - 1, row + 1)
    if (key === 'ArrowLeft') nextCol = Math.max(0, col - 1)
    if (key === 'ArrowRight') nextCol = Math.min(GRID_SIZE - 1, col + 1)
    const nextIndex = nextRow * GRID_SIZE + nextCol
    setFocusedIndex(nextIndex)
    cellRefs.current[nextIndex]?.focus()
  }

  const percentRemaining = totalMs === 0 ? 0 : Math.max(0, 100 - (elapsedMs / totalMs) * 100)
  const statusText =
    phase === 'flashing'
      ? justMissed
        ? 'Not quite. Watch it again.'
        : 'Watch the pattern.'
      : phase === 'input'
        ? 'Repeat it, in order.'
        : 'Run complete.'

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{DRILL_META['memory-grid'].title}</CardTitle>
          <Badge variant="outline" className="font-mono uppercase">
            Round {round}
          </Badge>
        </div>
        <CardDescription>Watch the pattern, then reproduce it in the same order before it grows.</CardDescription>
        <Progress value={percentRemaining} />
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-5 py-8">
        {phase !== 'done' ? (
          <>
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {statusText}
            </p>
            <div
              role="group"
              aria-label="Memory grid, 4 by 4"
              onKeyDown={handleGridKeyDown}
              className="grid w-64 grid-cols-4 gap-2"
            >
              {Array.from({ length: CELL_COUNT }, (_, index) => {
                const row = Math.floor(index / GRID_SIZE) + 1
                const col = (index % GRID_SIZE) + 1
                const isFlashing = phase === 'flashing' && flashIndex < pattern.length && pattern[flashIndex] === index
                const isSelected = phase === 'input' && selected.includes(index)
                return (
                  <button
                    key={index}
                    type="button"
                    data-cell-index={index}
                    ref={(el) => {
                      cellRefs.current[index] = el
                    }}
                    tabIndex={focusedIndex === index ? 0 : -1}
                    aria-label={`Row ${row}, column ${col}`}
                    aria-pressed={isSelected}
                    onClick={() => selectCell(index)}
                    onFocus={() => setFocusedIndex(index)}
                    className={cn(
                      'aspect-square rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      !reducedMotion && 'transition-colors',
                      isFlashing ? 'bg-primary' : isSelected ? 'bg-accent' : 'bg-muted hover:bg-muted/70'
                    )}
                  />
                )
              })}
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">{roundsCleared} cleared</p>
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
