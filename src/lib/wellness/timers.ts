/**
 * Pure scheduling helpers for the wellness rail. Every function here takes a clock
 * reading (`now`, from `Date.now()`) and stored target timestamps and returns the next
 * state — no `setInterval` counting, so a backgrounded tab catches up correctly the
 * moment it becomes visible again.
 */

import type { PrayerName } from './prayer'
import { PRAYER_ORDER } from './prayer'

// ---------------------------------------------------------------------------
// Attempt-active flag (src/hooks/useExerciseLoop.ts sets this during an attempt)
// ---------------------------------------------------------------------------

export const ATTEMPT_ACTIVE_KEY = 'brogram:attempt-active'

export function isAttemptActive(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ATTEMPT_ACTIVE_KEY) === 'true'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Prayer reminders: two events per prayer (lead time, and at time)
// ---------------------------------------------------------------------------

export interface PrayerReminderEvent {
  prayer: PrayerName
  kind: 'lead' | 'at'
  atMs: number
  /** Stable key so a reminder fires at most once per day. */
  firedKey: string
}

/** Interprets `dateKey` (YYYY-MM-DD) and `hhmm` (HH:MM) as local wall-clock time. */
export function parseLocalDateTime(dateKey: string, hhmm: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = hhmm.split(':').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0, 0).getTime()
}

export function buildPrayerReminders(dateKey: string, times: Record<PrayerName, string>, leadMinutes: number): PrayerReminderEvent[] {
  return PRAYER_ORDER.flatMap((prayer) => {
    const at = parseLocalDateTime(dateKey, times[prayer])
    return [
      { prayer, kind: 'lead' as const, atMs: at - leadMinutes * 60_000, firedKey: `${dateKey}:${prayer}:lead` },
      { prayer, kind: 'at' as const, atMs: at, firedKey: `${dateKey}:${prayer}:at` },
    ]
  })
}

/** Events whose time has arrived and have not already fired. Does not mutate `fired`. */
export function dueReminders(events: PrayerReminderEvent[], now: number, fired: ReadonlySet<string>): PrayerReminderEvent[] {
  return events.filter((event) => now >= event.atMs && !fired.has(event.firedKey))
}

// ---------------------------------------------------------------------------
// Recurring timers (water, stretch): fire every `intervalMin`, catching up
// ---------------------------------------------------------------------------

export interface RecurringTimerState {
  targetAt: number
}

export function startRecurringTimer(now: number, intervalMin: number): RecurringTimerState {
  return { targetAt: now + intervalMin * 60_000 }
}

export function dueRecurringTimer(state: RecurringTimerState, now: number): boolean {
  return now >= state.targetAt
}

/** Steps the target forward in whole intervals from where it was, so a long-backgrounded tab fires once and resumes on schedule rather than piling up. */
export function advanceRecurringTimer(state: RecurringTimerState, now: number, intervalMin: number): RecurringTimerState {
  const stepMs = Math.max(1, intervalMin) * 60_000
  let next = state.targetAt
  while (next <= now) next += stepMs
  return { targetAt: next }
}

// ---------------------------------------------------------------------------
// Pomodoro: work/break state machine driven by a stored target timestamp
// ---------------------------------------------------------------------------

export type PomodoroPhase = 'work' | 'break'

export interface PomodoroState {
  phase: PomodoroPhase
  running: boolean
  /** Epoch ms the current phase completes at; null while paused or never started. */
  targetAt: number | null
  /** Time left in the current phase, valid while paused; refreshed on pause. */
  remainingMs: number
}

export function resetPomodoroState(workMin: number): PomodoroState {
  return { phase: 'work', running: false, targetAt: null, remainingMs: Math.max(1, workMin) * 60_000 }
}

export function startPomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.running) return state
  return { ...state, running: true, targetAt: now + state.remainingMs }
}

export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (!state.running || state.targetAt === null) return state
  return { ...state, running: false, targetAt: null, remainingMs: Math.max(0, state.targetAt - now) }
}

export function remainingPomodoroMs(state: PomodoroState, now: number): number {
  if (state.running && state.targetAt !== null) return Math.max(0, state.targetAt - now)
  return state.remainingMs
}

export interface PomodoroTickResult {
  state: PomodoroState
  /** Set to the phase that just completed, so the caller can persist a session / show a toast. */
  completedPhase: PomodoroPhase | null
}

/**
 * Advances a running pomodoro past its target, switching phases. The next target is
 * anchored to the previous (exact, un-overshot) boundary plus the new phase's duration —
 * not to `now` — so repeated calls from `advancePomodoro` walk through every phase a
 * long-backgrounded tab passed through instead of collapsing them.
 */
export function tickPomodoro(state: PomodoroState, now: number, workMin: number, breakMin: number): PomodoroTickResult {
  if (!state.running || state.targetAt === null || now < state.targetAt) return { state, completedPhase: null }
  const completedPhase = state.phase
  const nextPhase: PomodoroPhase = completedPhase === 'work' ? 'break' : 'work'
  const durationMs = Math.max(1, nextPhase === 'work' ? workMin : breakMin) * 60_000
  return {
    state: { phase: nextPhase, running: true, targetAt: state.targetAt + durationMs, remainingMs: durationMs },
    completedPhase,
  }
}

export interface PomodoroAdvanceResult {
  state: PomodoroState
  /** Every phase completed between the stored state and `now`, oldest first. */
  completed: PomodoroPhase[]
}

/**
 * Pure derivation of "what the pomodoro looks like right now": repeatedly applies
 * `tickPomodoro` so a component can compute its live phase/remaining time straight from
 * render (state, now) without ever calling setState inside an effect. Callers persist the
 * returned `state` back only from an event handler (start / pause / reset).
 */
export function advancePomodoro(state: PomodoroState, now: number, workMin: number, breakMin: number): PomodoroAdvanceResult {
  let current = state
  const completed: PomodoroPhase[] = []
  // A generous but finite cap: even a tab left open for a year of 5-minute breaks stays well under this.
  for (let i = 0; i < 10_000; i++) {
    const result = tickPomodoro(current, now, workMin, breakMin)
    if (result.completedPhase === null) break
    completed.push(result.completedPhase)
    current = result.state
  }
  return { state: current, completed }
}

// ---------------------------------------------------------------------------
// Water / stretch streak: consecutive local days with at least one log
// ---------------------------------------------------------------------------

/** `dates` are YYYY-MM-DD (local); `today` is the current local date key. Returns 0 once the most recent log is older than yesterday. */
export function computeLogStreak(dates: string[], today: string): number {
  const distinct = Array.from(new Set(dates)).sort().reverse()
  if (distinct.length === 0) return 0
  const oneDayMs = 86_400_000
  const todayMs = Date.parse(`${today}T00:00:00`)
  const mostRecentMs = Date.parse(`${distinct[0]}T00:00:00`)
  if (todayMs - mostRecentMs > oneDayMs) return 0
  let streak = 1
  let cursor = mostRecentMs
  for (let i = 1; i < distinct.length; i++) {
    const dayMs = Date.parse(`${distinct[i]}T00:00:00`)
    if (cursor - dayMs === oneDayMs) {
      streak += 1
      cursor = dayMs
    } else break
  }
  return streak
}
