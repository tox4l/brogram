'use client'

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type SyntheticEvent } from 'react'
import { LOCKDOWN, type IntegrityEventType } from '@/lib/contracts'
import { createClient } from '@/lib/supabase/client'
import { recordLocalIntegrityEvent, syncLocalIntegrityLogUser } from '@/lib/integrity/localLog'
import { line } from '@/lib/voice/lines'
import { useSession } from '@/store/session'

export type LockdownReason = 'blur' | 'idle'

/**
 * R9.2: PrintScreen gets no overlay of its own any more (see the module doc
 * below), but a pattern of presses is still worth one honest, non-blocking
 * word -- exactly once, on the third press in a given exercise. This is a UI
 * cadence, not a scored threshold (`INTEGRITY_WEIGHTS`/`INTEGRITY_THRESHOLDS`
 * in `src/lib/contracts.ts` are untouched by it), so it lives here rather
 * than in the contracts file this task does not own.
 */
const PRINTSCREEN_NOTE_AT = 3

/** `guard.paste.why` carries exactly one, variable-free variant, so picking
 *  it is a pure constant -- computed once at module load rather than on every
 *  render or every blocked paste. */
const PASTE_WHY = line('guard.paste.why')

/**
 * Matches `src/lib/runtimes/web.ts`'s `SANDBOX_MARKER` by value, not by
 * import -- a plain DOM attribute is the whole contract between the runtime
 * and this hook, so this file never has to know what an adapter is. Giving
 * the grading sandbox a real off-screen layout box (`web.ts`'s own fix for
 * the viewport bug) made it capable of taking top-level focus via a script
 * inside the graded document calling `element.focus()`: confirmed live, and
 * confirmed that `inert` and `visibility:hidden` do not stop it. That shows
 * up here as a genuine `window` `blur` -- moving focus into a child frame
 * fires one on the parent even though the tab itself never lost OS focus --
 * which this hook would otherwise score as a weight-1 integrity violation
 * against a learner who did nothing wrong, and would cover their workspace
 * mid-grade. `web.ts` also restores focus once grading settles; this guard
 * is what stops the false event from ever being scored in the meantime.
 */
const SANDBOX_MARKER = 'data-brogram-sandbox'
function blurCameFromGradingSandbox(): boolean {
  const active = document.activeElement
  return active instanceof HTMLIFrameElement && active.hasAttribute(SANDBOX_MARKER)
}

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
  const [printscreenNote, setPrintscreenNote] = useState<string | null>(null)
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
  const printscreenCount = useRef(0)

  useEffect(() => { attempt.current = duringAttempt }, [duringAttempt])

  // Fix round 1, C1 hygiene: the moment a different signed-in user is seen on
  // this browser, drop the previous user's local integrity log outright
  // (mirrors `resetQueryClientForUser` in `src/lib/query/client.ts`, a file
  // this task does not own, hence the separate tracker rather than a shared
  // call). The per-user key (`localLog.ts`) is what actually stops one
  // learner's receipt from ever reading another's events; this only keeps a
  // shared machine from accumulating one orphaned key per historical learner.
  useEffect(() => { syncLocalIntegrityLogUser(userId ?? null) }, [userId])

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

  const logIntegrity = useCallback((type: IntegrityEventType): boolean => {
    if (!enabled) return false
    if (type === 'paste-blocked') {
      // R9.3: a rotating line from the bank, never the same one twice in a
      // row (`line()`'s own no-seed guarantee) -- the single static string
      // this used to be was the owner's complaint verbatim ("the paste block
      // only said 'Type it'").
      setPasteMessage(line('guard.paste'))
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current)
      feedbackTimer.current = setTimeout(() => setPasteMessage(''), 3_500)
    }
    if (!userId) return false
    const now = Date.now()
    // Editor and page handlers may observe the same bubbling event. Coalesce
    // each type, and retain the attempt status at the time it happened.
    if (now - (lastLogged.current.get(type) ?? -Infinity) < 1_000) return false
    lastLogged.current.set(type, now)
    // The same accepted (non-coalesced) event this browser is about to insert
    // is also mirrored into the learner's own local log -- see
    // `src/lib/integrity/localLog.ts` -- so the itemised receipt has
    // something honest to show even on schema 0005, where
    // `my_integrity_breakdown()` does not exist yet.
    recordLocalIntegrityEvent(userId, type, now)
    pending.current.set(type, {
      user_id: userId,
      exercise_id: exerciseId,
      type,
      during_attempt: attempt.current ?? attemptIsActive(),
      created_at: new Date(now).toISOString(),
    })
    return true
  }, [enabled, exerciseId, userId])

  useEffect(() => {
    if (!enabled) return
    mounted.current = true
    let idleCoverTimer: ReturnType<typeof setTimeout>
    let idleLogTimer: ReturnType<typeof setTimeout>
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
    const blur = () => {
      // The grading sandbox stole top-level focus, not the learner leaving the
      // tab -- ignore it outright (no score, no cover) and hand focus back as
      // a backstop alongside `web.ts`'s own restoreFocus (belt and braces:
      // whichever side notices first wins, and blurring an already-blurred
      // element is a harmless no-op).
      if (blurCameFromGradingSandbox()) { (document.activeElement as HTMLIFrameElement).blur(); return }
      setBlurred(true); logIntegrity('blur')
    }
    const focus = () => {
      if (document.hidden) return
      setBlurred(false)
      resetIdle()
    }
    const visibility = () => { if (document.hidden) blur(); else focus() }
    // R9.1: the two-second full-screen cover and the clipboard-clear attempt
    // are gone -- by the time this `keyup` fires, the OS has already
    // rasterised the frame, so that cover protected nothing and only
    // punished a learner who pressed the key for an unrelated reason. The
    // `keyup` listener and the weight-3 `printscreen` row stay: the log is
    // the one genuine thing this guard ever produced.
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== 'PrintScreen' && event.keyCode !== 44) return
      // W2G-2 fix: the press count and the note threshold live above
      // `logIntegrity`'s own per-type coalescing guard (:148, deliberately
      // untouched -- it caps *writes* at one per type per second, globally,
      // for every guard type, not just this one). Gating the count on that
      // guard's return value meant a natural burst of presses -- anything
      // under a second apart -- never advanced past 1, so the note was only
      // reachable at an unnaturally slow, one-per-second cadence. Every raw
      // press still counts; only the write to `integrity_events` coalesces.
      printscreenCount.current += 1
      // R9.2: exactly once, on the third press in this exercise -- a
      // non-blocking note, not a modal or a full-screen anything. Because
      // `printscreenCount` only ever climbs by one and this branch fires on
      // the exact value, later presses in the same exercise say nothing.
      if (printscreenCount.current === PRINTSCREEN_NOTE_AT) setPrintscreenNote(line('guard.printscreen'))
      logIntegrity('printscreen')
    }
    printscreenCount.current = 0
    setPrintscreenNote(null)
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
    overlay: enabled ? (blurred ? 'blur' : idle ? 'idle' : null) as LockdownReason | null : null,
    logIntegrity,
    containerProps,
    resume,
    pasteMessage,
    /** R9.3's "why" affordance -- one honest, variable-free sentence, distinct from the rotating `pasteMessage`. */
    pasteWhy: PASTE_WHY,
    /** R9.2: non-null exactly once per exercise, on the third PrintScreen press. Not a toast -- meant for a
     *  non-blocking inline note (e.g. in the results panel), never a modal or a full-screen overlay. */
    printscreenNote,
    loggingError,
  }
}
