'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseCountdownOptions {
  /** Seconds allowed, from DrillItem.timeLimitS. */
  timeLimitS: number
  /** Injected clock so tests control time. Defaults to Date.now. */
  now?: () => number
  /** Pause the countdown (e.g. once the drill has already submitted, or the tab is hidden). Defaults to true. */
  active?: boolean
  /**
   * Fires exactly once, the instant remaining time reaches 0. Receives the
   * elapsed ms at expiry (fix round 2, N1) so a caller never needs its own,
   * separate elapsed-time source that could disagree with this one -- see
   * `getElapsedMs` below for why that mattered.
   */
  onExpire?: (elapsedMs: number) => void
}

export interface UseCountdownResult {
  remainingMs: number
  /** 0..100, for the Progress primitive. */
  percentRemaining: number
  expired: boolean
  /**
   * Elapsed **active** time only (fix round 2, N1): time spent with
   * `active: false` (paused -- the tab hidden, a cover up) is never counted,
   * frozen at pause and picked back up unchanged on resume. Before this fix
   * the clock was anchored once at mount and never shifted, so `active:
   * false` only stopped the *display* from ticking while the real elapsed
   * time kept accruing underneath it -- a long pause made the item expire
   * the instant it resumed, and a correct-but-paused answer was scored (and
   * its `timeMs` stamped) as if the hidden time had been spent solving it.
   * Callers should use this for both the ring's percentage AND for stamping
   * a manual submit -- never keep a second, local `elapsed()`.
   */
  getElapsedMs: () => number
}

const TICK_MS = 100

export function useCountdown({ timeLimitS, now = Date.now, active = true, onExpire }: UseCountdownOptions): UseCountdownResult {
  const totalMs = Math.max(0, Math.round(timeLimitS * 1000))
  // Ms of active time accumulated BEFORE the current active stretch -- frozen
  // across a pause, carried forward on resume.
  const accumulatedRef = useRef(0)
  // When the current active stretch began; null while paused (including
  // "paused from the very first render", e.g. active starts false).
  const activeStartRef = useRef<number | null>(active ? now() : null)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)

  const [remainingMs, setRemainingMs] = useState(totalMs)
  const [expired, setExpired] = useState(false)

  // Keep the latest onExpire available to the interval without restarting it.
  // Refs must not be written during render, so this happens in an effect; the
  // interval only ever fires later (asynchronously), so it always sees the latest.
  useEffect(() => {
    onExpireRef.current = onExpire
  })

  const getElapsedMs = useCallback(() => {
    const liveMs = activeStartRef.current !== null ? now() - activeStartRef.current : 0
    return accumulatedRef.current + liveMs
  }, [now])

  useEffect(() => {
    if (!active) {
      // Freeze: fold whatever ran since the last active start into the
      // accumulator and stop scheduling entirely -- no interval means no
      // tick can fire, so no time can pass, while paused.
      if (activeStartRef.current !== null) {
        accumulatedRef.current += now() - activeStartRef.current
        activeStartRef.current = null
      }
      return
    }
    // Resume (or the initial mount): pick up exactly where it left off. Only
    // stamp a fresh start when there is not already one in flight, so an
    // effect re-run for an unrelated reason (e.g. `totalMs` changing while
    // still active) can never silently donate extra time by re-anchoring.
    if (activeStartRef.current === null) {
      activeStartRef.current = now()
    }
    if (expiredRef.current) return

    const tick = () => {
      const remaining = Math.max(0, totalMs - getElapsedMs())
      setRemainingMs(remaining)
      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true
        setExpired(true)
        onExpireRef.current?.(getElapsedMs())
      }
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [active, totalMs, now, getElapsedMs])

  const percentRemaining = totalMs === 0 ? 0 : Math.min(100, Math.max(0, (remainingMs / totalMs) * 100))

  return { remainingMs, percentRemaining, expired, getElapsedMs }
}
