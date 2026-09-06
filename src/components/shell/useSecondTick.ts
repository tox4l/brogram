'use client'

import { useSyncExternalStore } from 'react'

/**
 * One shared 1Hz clock for the whole app (R6.5). `Rail.tsx:30-37,120`
 * re-rendered the whole wellness rail every second on every route via its own
 * `setInterval`; this replaces that with a single module-level interval,
 * created on the first subscriber and cleared on the last, so N
 * second-displaying components never turn into N independent per-second
 * re-render sources. Paused while the tab is hidden -- nothing needs a live
 * second while backgrounded -- and resynced immediately on
 * `visibilitychange` so a returning tab shows the current second at once
 * rather than waiting up to 1000ms for the next tick.
 *
 * Only components that actually display seconds should subscribe; everything
 * else derives from timestamps (src/lib/wellness/timers.ts already does this
 * correctly).
 */

let now = Date.now()
let intervalId: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function tick(): void {
  now = Date.now()
  notify()
}

function startInterval(): void {
  if (intervalId !== null) return
  if (typeof document !== 'undefined' && document.hidden) return
  intervalId = setInterval(tick, 1000)
}

function stopInterval(): void {
  if (intervalId === null) return
  clearInterval(intervalId)
  intervalId = null
}

/** Pauses the shared interval while hidden; on return, resyncs `now`
 *  immediately (so the next render sees the current second right away)
 *  and resumes the interval for whatever subscribers remain. */
function handleVisibilityChange(): void {
  if (typeof document === 'undefined') return
  if (document.hidden) {
    stopInterval()
    return
  }
  now = Date.now()
  notify()
  startInterval()
}

function subscribe(listener: () => void): () => void {
  const wasEmpty = listeners.size === 0
  listeners.add(listener)
  if (wasEmpty) {
    now = Date.now()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange)
    startInterval()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopInterval()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }
}

function getSnapshot(): number {
  return now
}

function getServerSnapshot(): number {
  return now
}

export function useSecondTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
