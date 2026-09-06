import { afterEach, describe, expect, it } from 'vitest'
import {
  ATTEMPT_ACTIVE_KEY,
  REMINDER_WINDOW_MS,
  advancePomodoro,
  advanceRecurringTimer,
  buildPrayerReminders,
  computeLogStreak,
  dueReminders,
  dueRecurringTimer,
  isAttemptActive,
  parseLocalDateTime,
  pausePomodoro,
  remainingPomodoroMs,
  resetPomodoroState,
  startPomodoro,
  startRecurringTimer,
  tickPomodoro,
} from './timers'

describe('attempt-active flag', () => {
  afterEach(() => sessionStorage.clear())

  it('reads false when unset', () => {
    expect(isAttemptActive()).toBe(false)
  })
  it('reads true when the exercise screen sets the flag', () => {
    sessionStorage.setItem(ATTEMPT_ACTIVE_KEY, 'true')
    expect(isAttemptActive()).toBe(true)
  })
  it('reads false once the flag clears', () => {
    sessionStorage.setItem(ATTEMPT_ACTIVE_KEY, 'true')
    sessionStorage.setItem(ATTEMPT_ACTIVE_KEY, 'false')
    expect(isAttemptActive()).toBe(false)
  })
})

describe('prayer reminders', () => {
  const times = { fajr: '04:12', dhuhr: '11:32', asr: '14:52', maghrib: '17:22', isha: '18:52' }

  it('parses a date key and HH:MM as local wall-clock time', () => {
    expect(parseLocalDateTime('2026-09-06', '11:32')).toBe(new Date(2026, 8, 6, 11, 32, 0, 0).getTime())
  })

  it('builds a lead and an at-time event per prayer', () => {
    const events = buildPrayerReminders('2026-09-06', times, 10)
    expect(events).toHaveLength(10)
    const dhuhrAt = events.find((event) => event.prayer === 'dhuhr' && event.kind === 'at')
    const dhuhrLead = events.find((event) => event.prayer === 'dhuhr' && event.kind === 'lead')
    expect(dhuhrAt?.atMs).toBe(parseLocalDateTime('2026-09-06', '11:32'))
    expect(dhuhrLead?.atMs).toBe(parseLocalDateTime('2026-09-06', '11:32') - 10 * 60_000)
  })

  it('reports an event due once now passes its time, and not before', () => {
    const events = buildPrayerReminders('2026-09-06', times, 10)
    const dhuhrLead = events.find((event) => event.prayer === 'dhuhr' && event.kind === 'lead')!
    expect(dueReminders(events, dhuhrLead.atMs - 1, new Set())).not.toContainEqual(dhuhrLead)
    expect(dueReminders(events, dhuhrLead.atMs, new Set())).toContainEqual(dhuhrLead)
  })

  it('excludes events already marked fired', () => {
    const events = buildPrayerReminders('2026-09-06', times, 10)
    const dhuhrLead = events.find((event) => event.prayer === 'dhuhr' && event.kind === 'lead')!
    const fired = new Set([dhuhrLead.firedKey])
    expect(dueReminders(events, dhuhrLead.atMs + 30_000, fired).some((event) => event.firedKey === dhuhrLead.firedKey)).toBe(false)
  })

  it('stops treating an event as due once it falls outside the reminder window (no backlog dump)', () => {
    const events = buildPrayerReminders('2026-09-06', times, 10)
    const dhuhrLead = events.find((event) => event.prayer === 'dhuhr' && event.kind === 'lead')!
    expect(dueReminders(events, dhuhrLead.atMs + REMINDER_WINDOW_MS - 1, new Set())).toContainEqual(dhuhrLead)
    expect(dueReminders(events, dhuhrLead.atMs + REMINDER_WINDOW_MS, new Set())).not.toContainEqual(dhuhrLead)
  })

  it('never reports hours-old events as due, even unfired', () => {
    const events = buildPrayerReminders('2026-09-06', times, 10)
    const now = parseLocalDateTime('2026-09-06', '22:00')
    expect(dueReminders(events, now, new Set())).toEqual([])
  })
})

describe('recurring timers (water / stretch)', () => {
  it('is not due before the interval elapses', () => {
    const state = startRecurringTimer(0, 45)
    expect(dueRecurringTimer(state, 44 * 60_000)).toBe(false)
  })
  it('is due once the interval elapses', () => {
    const state = startRecurringTimer(0, 45)
    expect(dueRecurringTimer(state, 45 * 60_000)).toBe(true)
  })
  it('advances to the next interval from now, catching up after a long background', () => {
    const state = startRecurringTimer(0, 45)
    const next = advanceRecurringTimer(state, 200 * 60_000, 45)
    expect(next.targetAt).toBe(225 * 60_000)
    expect(dueRecurringTimer(next, 200 * 60_000)).toBe(false)
  })
})

describe('pomodoro state machine', () => {
  it('starts counting down from now', () => {
    const state = startPomodoro(resetPomodoroState(25), 0)
    expect(state.running).toBe(true)
    expect(state.targetAt).toBe(25 * 60_000)
  })
  it('does not restart an already-running pomodoro', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    expect(startPomodoro(started, 5000)).toBe(started)
  })
  it('pause captures remaining time and stops the target', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const paused = pausePomodoro(started, 60_000)
    expect(paused.running).toBe(false)
    expect(paused.targetAt).toBeNull()
    expect(paused.remainingMs).toBe(25 * 60_000 - 60_000)
  })
  it('resuming a paused pomodoro continues from the remaining time', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const paused = pausePomodoro(started, 60_000)
    const resumed = startPomodoro(paused, 100_000)
    expect(resumed.targetAt).toBe(100_000 + paused.remainingMs)
  })
  it('does not tick before the target', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const result = tickPomodoro(started, 25 * 60_000 - 1, 25, 5)
    expect(result.completedPhase).toBeNull()
  })
  it('completes a work block and switches to break', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const result = tickPomodoro(started, 25 * 60_000, 25, 5)
    expect(result.completedPhase).toBe('work')
    expect(result.state.phase).toBe('break')
    expect(result.state.running).toBe(true)
    expect(result.state.targetAt).toBe(25 * 60_000 + 5 * 60_000)
  })
  it('completes a break and switches back to work', () => {
    const afterWork = tickPomodoro(startPomodoro(resetPomodoroState(25), 0), 25 * 60_000, 25, 5).state
    const result = tickPomodoro(afterWork, afterWork.targetAt!, 25, 5)
    expect(result.completedPhase).toBe('break')
    expect(result.state.phase).toBe('work')
  })
  it('carries overshoot into the next phase so a backgrounded tab does not drift', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const result = tickPomodoro(started, 25 * 60_000 + 30_000, 25, 5)
    expect(result.state.targetAt).toBe(25 * 60_000 + 30_000 + (5 * 60_000 - 30_000))
  })
  it('reports remaining time for a running pomodoro against now', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    expect(remainingPomodoroMs(started, 60_000)).toBe(25 * 60_000 - 60_000)
  })
})

describe('advancePomodoro', () => {
  it('is a no-op derivation before the target', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const result = advancePomodoro(started, 60_000, 25, 5)
    expect(result.completed).toEqual([])
    expect(result.state).toBe(started)
  })
  it('derives a single completed work block, stamped at the real boundary, without mutating the caller-visible flow', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const result = advancePomodoro(started, 25 * 60_000, 25, 5)
    expect(result.completed).toEqual([{ phase: 'work', at: 25 * 60_000 }])
    expect(result.state.phase).toBe('break')
  })
  it('derives every phase passed through in one big jump forward (a long-backgrounded tab), each stamped at its real boundary', () => {
    const started = startPomodoro(resetPomodoroState(25), 0)
    const farFuture = (25 + 5 + 25 + 5) * 60_000 + 1000
    const result = advancePomodoro(started, farFuture, 25, 5)
    expect(result.completed).toEqual([
      { phase: 'work', at: 25 * 60_000 },
      { phase: 'break', at: 30 * 60_000 },
      { phase: 'work', at: 55 * 60_000 },
      { phase: 'break', at: 60 * 60_000 },
    ])
    expect(result.state.phase).toBe('work')
    expect(result.state.running).toBe(true)
  })
})

describe('computeLogStreak', () => {
  it('is zero with no logs', () => {
    expect(computeLogStreak([], '2026-09-06')).toBe(0)
  })
  it('is zero once the most recent log is older than yesterday', () => {
    expect(computeLogStreak(['2026-09-01'], '2026-09-06')).toBe(0)
  })
  it('counts a single log today as a streak of one', () => {
    expect(computeLogStreak(['2026-09-06'], '2026-09-06')).toBe(1)
  })
  it('counts consecutive days ending yesterday when nothing is logged yet today', () => {
    expect(computeLogStreak(['2026-09-05', '2026-09-04'], '2026-09-06')).toBe(2)
  })
  it('stops counting at the first gap', () => {
    expect(computeLogStreak(['2026-09-06', '2026-09-05', '2026-09-02'], '2026-09-06')).toBe(2)
  })
  it('ignores duplicate same-day entries', () => {
    expect(computeLogStreak(['2026-09-06', '2026-09-06', '2026-09-05'], '2026-09-06')).toBe(2)
  })
})
