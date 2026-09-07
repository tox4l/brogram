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

/** A live clock has no server value: `now` is frozen at module-eval time
 *  (process start on a warm server), so returning it would put an
 *  arbitrarily stale second in the HTML and guarantee a hydration mismatch
 *  once the client's own module-eval time differs. Consumers render a
 *  placeholder while this is `0` and pick up the real clock the moment
 *  `subscribe` runs on the client (T2.4 step 7). */
const SERVER_SNAPSHOT = 0

function getServerSnapshot(): number {
  return SERVER_SNAPSHOT
}

export function useSecondTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * `useSecondTick()`'s sentinel (`0`, 1970-01-01) is not just a server-render
 * value -- React also uses `getServerSnapshot` for a client's *first* render
 * during hydration, so `now === 0` is a real value a consumer can see before
 * ever observing a real tick. A consumer that seeds durable state from `now`
 * (a target timestamp for a recurring timer, say) must never seed from this
 * sentinel: `startRecurringTimer(0, 45)` anchors to 1970-01-01 00:45, which
 * is already "due" the moment a real clock value arrives, firing a reminder
 * (and, for a `while (next <= now)` catch-up loop, spinning through decades
 * of intervals) on every single page load. Treat the sentinel as "no time
 * yet" and defer seeding until the first real tick.
 */
export function isTickReady(now: number): boolean {
  return now > 0
}

/** `now` once the shared clock has ticked for real at least once, else
 *  `null` -- so a consumer writes `const ready = nowOrNull(now); if (ready
 *  === null) return` instead of quietly seeding from the sentinel. */
export function nowOrNull(now: number): number | null {
  return isTickReady(now) ? now : null
}
