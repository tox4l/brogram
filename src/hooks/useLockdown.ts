'use client'

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type SyntheticEvent } from 'react'
import { LOCKDOWN, type IntegrityEventType } from '@/lib/contracts'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'

export type LockdownReason = 'blur' | 'idle' | 'printscreen'
export interface LockdownOptions { duringAttempt?: boolean; enabled?: boolean; idleGuard?: boolean }

interface IntegrityRow {
  user_id: string
  exercise_id: string | null
  type: IntegrityEventType
  during_attempt: boolean
  created_at: string
}

function attemptIsActive() {
  try { return sessionStorage.getItem('brogram:attempt-active') === 'true' } catch { return false }
}

/**
 * `exerciseId` is `null` on screens with no exercise row to attach the event
 * to (the de-rot drill runner: drill ids are not `exercise_id`'s uuid type),
 * matching the nullable `IntegrityEvent.exerciseId` contract and column.
 * `idleGuard` (default true) gates only the 15s idle overlay/cover; blur,
 * printscreen and clipboard guards are unaffected. Hold-focus passes false
 * because reading a passage without moving the mouse is the point, and the
 * drill has its own blur/scroll voids as its reading guard.
 */
export function useLockdown(exerciseId: string | null, { duringAttempt, enabled = true, idleGuard = true }: LockdownOptions = {}) {
  const userId = useSession(session => session.user?.id)
  const [blurred, setBlurred] = useState(false)
  const [idle, setIdle] = useState(false)
  const [printscreen, setPrintscreen] = useState(false)
  const [pasteMessage, setPasteMessage] = useState('')
  const [loggingError, setLoggingError] = useState<string | null>(null)
  const pending = useRef(new Map<IntegrityEventType, IntegrityRow>())
  const lastLogged = useRef(new Map<IntegrityEventType, number>())
  const lastWritten = useRef(new Map<IntegrityEventType, number>())
  const trailingBatch = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(false)
  const attempt = useRef(duringAttempt)
  const activity = useRef<() => void>(() => {})
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { attempt.current = duringAttempt }, [duringAttempt])

  const flush = useCallback(function flushPending() {
    const now = Date.now()
    const batch: IntegrityRow[] = []
    let nextWriteIn = Infinity
    for (const [type, row] of pending.current) {
      const remaining = 1_000 - (now - (lastWritten.current.get(type) ?? -Infinity))
      if (remaining > 0) { nextWriteIn = Math.min(nextWriteIn, remaining); continue }
      batch.push(row)
      pending.current.delete(type)
      lastWritten.current.set(type, now)
    }
    // A final partial batch still obeys the per-type write interval. Its
    // bounded trailing timeout also survives a client-side route unmount.
    if (pending.current.size && trailingBatch.current === null) {
      trailingBatch.current = setTimeout(() => {
        trailingBatch.current = null
        flushPending()
      }, nextWriteIn)
    }
    if (!batch.length) return
    const failed = (error: unknown) => {
      console.error('Integrity event batch could not be saved.', error)
      if (mounted.current) setLoggingError('Activity could not be saved. Check your connection before continuing.')
    }
    // This table intentionally allows inserts only. Never try to read it back.
    try {
      void Promise.resolve(createClient().from('integrity_events').insert(batch)).then(({ error }) => {
        if (error) failed(error)
      }).catch(failed)
    } catch (error) {
      failed(error)
    }
  }, [])

  const logIntegrity = useCallback((type: IntegrityEventType) => {
    if (!enabled) return
    if (type === 'paste-blocked') {
      setPasteMessage("Type it. That's the whole point.")
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setPasteMessage(''), 3_500)
    }
    if (!userId) return
    const now = Date.now()
    // Editor and page handlers may observe the same bubbling event. Coalesce
    // each type, and retain the attempt status at the time it happened.
    if (now - (lastLogged.current.get(type) ?? -Infinity) < 1_000) return
    lastLogged.current.set(type, now)
    pending.current.set(type, {
      user_id: userId,
      exercise_id: exerciseId,
      type,
      during_attempt: attempt.current ?? attemptIsActive(),
      created_at: new Date(now).toISOString(),
    })
  }, [enabled, exerciseId, userId])

  useEffect(() => {
    if (!enabled) return
    mounted.current = true
    let idleCoverTimer: ReturnType<typeof setTimeout>
    let idleLogTimer: ReturnType<typeof setTimeout>
    let screenshotTimer: ReturnType<typeof setTimeout> | undefined
    const resetIdle = () => {
      setIdle(false)
      clearTimeout(idleCoverTimer)
      clearTimeout(idleLogTimer)
      // idleGuard only gates the visual cover; idle is weight-0 and still worth logging.
      if (idleGuard) idleCoverTimer = setTimeout(() => setIdle(true), LOCKDOWN.idleBlurAfterS * 1_000)
      idleLogTimer = setTimeout(() => {
        logIntegrity('idle')
        flush()
      }, LOCKDOWN.idleLogAfterS * 1_000)
    }
    activity.current = resetIdle
    const blur = () => { setBlurred(true); logIntegrity('blur') }
    const focus = () => {
      if (document.hidden) return
      setBlurred(false)
      resetIdle()
    }
    const visibility = () => { if (document.hidden) blur(); else focus() }
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== 'PrintScreen' && event.keyCode !== 44) return
      setPrintscreen(true)
      logIntegrity('printscreen')
      clearTimeout(screenshotTimer)
      screenshotTimer = setTimeout(() => setPrintscreen(false), 2_000)
      try {
        const cleared = navigator.clipboard?.writeText('')
        void cleared?.catch(() => { /* Clipboard permission is browser-controlled. */ })
      } catch { /* PrintScreen protection stays active even when the clipboard is denied. */ }
    }
    setPrintscreen(false)
    setBlurred(document.hidden)
    setPasteMessage('')
    resetIdle()
    const batchTimer = setInterval(flush, 1_000)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('keydown', resetIdle)
    window.addEventListener('mousemove', resetIdle)
    window.addEventListener('pointerdown', resetIdle)
    window.addEventListener('keyup', keyup)
    return () => {
      mounted.current = false
      window.removeEventListener('blur', blur)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('keydown', resetIdle)
      window.removeEventListener('mousemove', resetIdle)
      window.removeEventListener('pointerdown', resetIdle)
      window.removeEventListener('keyup', keyup)
      clearTimeout(idleCoverTimer)
      clearTimeout(idleLogTimer)
      clearTimeout(screenshotTimer)
      clearInterval(batchTimer)
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
      activity.current = () => {}
      flush()
    }
  }, [enabled, flush, logIntegrity, idleGuard])

  const block = useCallback((event: SyntheticEvent, type: IntegrityEventType) => {
    if (!enabled) return
    event.preventDefault()
    logIntegrity(type)
  }, [enabled, logIntegrity])

  const containerProps: HTMLAttributes<HTMLDivElement> = {
    onPaste: event => block(event, 'paste-blocked'),
    onCopy: event => block(event, 'copy-blocked'),
    onCut: event => block(event, 'copy-blocked'),
    onContextMenu: event => block(event, 'contextmenu-blocked'),
    onMouseDown: event => { if (event.button === 2) block(event, 'contextmenu-blocked') },
  }

  const resume = useCallback(() => activity.current(), [])
  return {
    overlay: enabled ? (blurred ? 'blur' : printscreen ? 'printscreen' : idle ? 'idle' : null) as LockdownReason | null : null,
    logIntegrity,
    containerProps,
    resume,
    pasteMessage,
    loggingError,
  }
}
