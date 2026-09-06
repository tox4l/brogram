'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Pause, Play, RotateCcw, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WellnessPrefs } from '@/lib/contracts'
import {
  advancePomodoro,
  pausePomodoro,
  remainingPomodoroMs,
  resetPomodoroState,
  startPomodoro,
  type PomodoroState,
} from '@/lib/wellness/timers'

export interface PomodoroSession {
  workMinutes: number
  completedAt: string
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function Pomodoro({ prefs, now, attemptActive, onSessionComplete, compact = false }: {
  prefs: WellnessPrefs
  now: number
  attemptActive: boolean
  onSessionComplete: (session: PomodoroSession) => void
  compact?: boolean
}) {
  // `state` only changes from user actions (start/pause/reset). The live phase and
  // remaining time are derived fresh every render from (state, now) so nothing needs to
  // call setState from inside an effect just to keep the clock moving.
  const [state, setState] = useState<PomodoroState>(() => resetPomodoroState(prefs.pomodoroWorkMin))
  const derived = advancePomodoro(state, now, prefs.pomodoroWorkMin, prefs.pomodoroBreakMin)

  const notifiedRef = useRef(0)
  const queuedRef = useRef<string[]>([])
  const wasActiveRef = useRef(attemptActive)

  // `state` only advances from start/pause/reset, so derived.completed resets to a short
  // (usually empty) list right after any of those; re-arm the notified count then, in an
  // effect (never by touching a ref during render).
  useEffect(() => {
    notifiedRef.current = 0
  }, [state])

  // Side effects only (toast, persisting a completed session) — no setState here, so a
  // long-open tab can pass through many phase completions in one derivation without this
  // effect ever needing to "catch up" the stored state itself.
  useEffect(() => {
    if (derived.completed.length <= notifiedRef.current) return
    const newlyCompleted = derived.completed.slice(notifiedRef.current)
    notifiedRef.current = derived.completed.length
    for (const phase of newlyCompleted) {
      if (phase === 'work') onSessionComplete({ workMinutes: prefs.pomodoroWorkMin, completedAt: new Date(now).toISOString() })
      const message = phase === 'work' ? 'Work block complete. Time for a short break.' : 'Break complete. Ready for another focused block.'
      if (attemptActive) queuedRef.current.push(message)
      else toast(message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.completed.length, now])

  useEffect(() => {
    if (wasActiveRef.current && !attemptActive && queuedRef.current.length) {
      const queued = queuedRef.current
      queuedRef.current = []
      queued.forEach((message) => toast(message))
    }
    wasActiveRef.current = attemptActive
  }, [attemptActive])

  const remaining = remainingPomodoroMs(derived.state, now)

  const handleStart = () => setState(startPomodoro(derived.state, Date.now()))
  const handlePause = () => setState(pausePomodoro(derived.state, Date.now()))
  const handleReset = () => setState(resetPomodoroState(prefs.pomodoroWorkMin))

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Timer className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="font-mono tabular-nums">{formatClock(remaining)}</span>
        <span className="capitalize">{derived.state.phase}</span>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-medium">Pomodoro</h3>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-2xl font-medium tabular-nums tracking-tight">{formatClock(remaining)}</p>
          <p className="mt-1 text-xs text-muted-foreground capitalize">{derived.state.phase} · {derived.state.running ? 'running' : 'paused'}</p>
        </div>
        <div className="flex gap-2">
          {derived.state.running ? (
            <Button variant="outline" size="icon-sm" onClick={handlePause} aria-label="Pause pomodoro"><Pause /></Button>
          ) : (
            <Button variant="outline" size="icon-sm" onClick={handleStart} aria-label="Start pomodoro"><Play /></Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={handleReset} aria-label="Reset pomodoro"><RotateCcw /></Button>
        </div>
      </div>
    </div>
  )
}
