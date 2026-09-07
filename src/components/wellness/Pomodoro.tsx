'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Pause, Play, RotateCcw, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WellnessPrefs } from '@/lib/contracts'
import { line } from '@/lib/voice/lines'
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

export function Pomodoro({ prefs, now, attemptActive, onSessionComplete, onPendingChange, compact = false, visible = true }: {
  prefs: WellnessPrefs
  now: number
  attemptActive: boolean
  /** Always an array — a caught-up backlog reports every completed work phase in one call, so Dock persists it in a single write. */
  onSessionComplete: (sessions: PomodoroSession[]) => void
  /** R6.4/C3: `true` the instant a completion fires -- whether it toasts right
   *  away or queues because an attempt is active -- so the dock can show a
   *  badge on a collapsed handle (or the header control when hidden). */
  onPendingChange?: (pending: boolean) => void
  compact?: boolean
  /** C3: the reminder engine (this component's timer/effects) must keep
   *  running while the dock is collapsed or hidden -- only the UI is
   *  conditional. Mount this component always and pass `visible={false}`
   *  rather than unmounting it. */
  visible?: boolean
}) {
  // `state` only changes from user actions (start/pause/reset), and once from the effect
  // below when a multi-boundary catch-up needs to commit an explicit pause. The live phase
  // and remaining time are otherwise derived fresh every render from (state, now) so
  // nothing needs to call setState just to keep the clock moving.
  const [state, setState] = useState<PomodoroState>(() => resetPomodoroState(prefs.pomodoroWorkMin))
  const derived = advancePomodoro(state, now, prefs.pomodoroWorkMin, prefs.pomodoroBreakMin)

  const notifiedRef = useRef(0)
  const queuedRef = useRef<string[]>([])
  const wasActiveRef = useRef(attemptActive)

  // `state` only advances from start/pause/reset (or the catch-up pause below), so
  // derived.completed resets to a short (usually empty) list right after any of those;
  // re-arm the notified count then, in an effect (never by touching a ref during render).
  useEffect(() => {
    notifiedRef.current = 0
  }, [state])

  useEffect(() => {
    if (derived.completed.length <= notifiedRef.current) return
    const newlyCompleted = derived.completed.slice(notifiedRef.current)
    notifiedRef.current = derived.completed.length

    if (newlyCompleted.length > 1) {
      // A background tab (or a closed laptop lid) let more than one phase boundary pass in
      // a single jump: don't replay each one — persist the completed work phases (stamped
      // at their real boundary) in one write, pause right where we caught up rather than
      // silently continuing to count down unattended, and say so exactly once.
      const sessions = newlyCompleted
        .filter((completion) => completion.phase === 'work')
        .map((completion) => ({ workMinutes: prefs.pomodoroWorkMin, completedAt: new Date(completion.at).toISOString() }))
      if (sessions.length) onSessionComplete(sessions)
      const pausedDurationMs = Math.max(1, derived.state.phase === 'work' ? prefs.pomodoroWorkMin : prefs.pomodoroBreakMin) * 60_000
      // Committing this pause is reacting to an external event (a large clock jump found on
      // this render), not per-render UI derivation — the one legitimate case for setState here.
      setState({ phase: derived.state.phase, running: false, targetAt: null, remainingMs: pausedDurationMs })
      const message = 'Timer paused while you were away.'
      if (attemptActive) queuedRef.current.push(message)
      else toast(message)
      onPendingChange?.(true)
    } else {
      for (const completion of newlyCompleted) {
        if (completion.phase === 'work') onSessionComplete([{ workMinutes: prefs.pomodoroWorkMin, completedAt: new Date(completion.at).toISOString() }])
        const message = completion.phase === 'work' ? 'Work block complete. Time for a short break.' : 'Break complete. Ready for another focused block.'
        if (attemptActive) queuedRef.current.push(message)
        else toast(message)
        onPendingChange?.(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.completed.length, now])

  useEffect(() => {
    if (wasActiveRef.current && !attemptActive && queuedRef.current.length) {
      const queued = queuedRef.current
      queuedRef.current = []
      onPendingChange?.(false)
      queued.forEach((message) => toast(message))
    }
    wasActiveRef.current = attemptActive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptActive])

  const remaining = remainingPomodoroMs(derived.state, now)

  const handleStart = () => setState(startPomodoro(derived.state, Date.now()))
  const handlePause = () => setState(pausePomodoro(derived.state, Date.now()))
  const handleReset = () => setState(resetPomodoroState(prefs.pomodoroWorkMin))

  if (!visible) return null

  if (compact) {
    return (
      <div id="pomodoro" className="flex scroll-mt-20 items-center gap-2 text-micro text-muted-foreground">
        <Timer className="size-4 shrink-0" aria-hidden="true" />
        <span className="font-mono tabular-nums">{formatClock(remaining)}</span>
        <span className="capitalize">{derived.state.phase}</span>
      </div>
    )
  }

  return (
    <div id="pomodoro" className="scroll-mt-20">
      <h3 className="text-small font-medium">{line('dock.pomodoro')}</h3>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-h2 font-medium tabular-nums tracking-tight">{formatClock(remaining)}</p>
          <p className="mt-1 text-micro text-muted-foreground capitalize">{derived.state.phase} · {derived.state.running ? 'running' : 'paused'}</p>
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
