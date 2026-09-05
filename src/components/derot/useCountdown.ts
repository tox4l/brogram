'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseCountdownOptions {
  /** Seconds allowed, from DrillItem.timeLimitS. */
  timeLimitS: number
  /** Injected clock so tests control time. Defaults to Date.now. */
  now?: () => number
  /** Pause the countdown (e.g. once the drill has already submitted). Defaults to true. */
  active?: boolean
  /** Fires exactly once, the instant remaining time reaches 0. */
  onExpire?: () => void
}

export interface UseCountdownResult {
  remainingMs: number
  /** 0..100, for the Progress primitive. */
  percentRemaining: number
  expired: boolean
  /** Fresh elapsed time computed from the injected clock, for stamping a manual submit. */
  getElapsedMs: () => number
}

const TICK_MS = 100

export function useCountdown({ timeLimitS, now = Date.now, active = true, onExpire }: UseCountdownOptions): UseCountdownResult {
  const totalMs = Math.max(0, Math.round(timeLimitS * 1000))
  const startRef = useRef(now())
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

  const getElapsedMs = useCallback(() => now() - startRef.current, [now])

  useEffect(() => {
    if (!active || expiredRef.current) return

    const tick = () => {
      const remaining = Math.max(0, totalMs - getElapsedMs())
      setRemainingMs(remaining)
      if (remaining <= 0 && !expiredRef.current) {
        expiredRef.current = true
        setExpired(true)
        onExpireRef.current?.()
      }
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [active, totalMs, getElapsedMs])

  const percentRemaining = totalMs === 0 ? 0 : Math.min(100, Math.max(0, (remainingMs / totalMs) * 100))

  return { remainingMs, percentRemaining, expired, getElapsedMs }
}
