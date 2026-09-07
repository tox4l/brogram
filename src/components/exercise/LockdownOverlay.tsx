'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { LockdownReason } from '@/hooks/useLockdown'
import { Button } from '@/components/ui/button'
import { line } from '@/lib/voice/lines'

/** How long the paste toast stays up once nothing (no "why" panel) is keeping it open. */
const PASTE_TOAST_MS = 3_500

/** The minimal shape `returnFocusRef` needs -- an `HTMLElement` already has
 *  this; a custom imperative handle (e.g. a CodeMirror wrapper) only needs
 *  to implement it. */
export interface Focusable {
  focus: () => void
}

export interface LockdownOverlayProps {
  reason: LockdownReason | null
  onResume?: () => void
  /**
   * R9.2: a non-blocking, once-only note ("Screenshots aren't something a
   * website can block...") for the third PrintScreen press in an exercise.
   * Deliberately rendered as a plain line, not a modal and not inside the
   * full-screen `reason` overlay above -- PrintScreen no longer gets an
   * overlay of its own (R9.1).
   */
  printscreenNote?: string | null
  /**
   * R9.3: the rotating paste-block toast, with an optional "why" sentence
   * behind a small expand affordance -- no shake, no motion, no sound.
   * Fix round 2, N2: whenever `pasteWhy` is supplied, the toast never
   * auto-dismisses on a timer at all (it stays until the next distinct
   * blocked-paste event replaces it), so a keyboard or screen-reader user
   * can reach "Why?" no matter how long that takes.
   */
  pasteMessage?: string
  pasteWhy?: string
  /**
   * Fix round 1, I4: focus is returned through this ref (a) the instant the
   * full-screen overlay lifts (`reason` goes from `'blur'`/`'idle'` to
   * `null` -- the exercise content sits behind `inert` while the overlay is
   * up, which force-blurs whatever had focus and does not restore it on its
   * own) and (b) the instant the paste "why" explanation closes. This
   * component has no reference of its own to the actual editable surface
   * (`Editor`/`SchemaEditor` -- a different file, not owned by this task) --
   * the caller supplies one. Left unset, this is a no-op: today's behaviour.
   */
  returnFocusRef?: RefObject<Focusable | null>
  /**
   * X6 (wave 2 review): a floor for the two effects below, tried only when
   * `returnFocusRef` itself has nothing to focus (a kind whose own component
   * never populated it, a future kind that forgets to). Intended for the
   * exercise workspace container (`page.tsx`'s own `data-testid="exercise-workspace"`,
   * given a `tabIndex={-1}`) so focus never lands on `<body>` for any kind,
   * even one this component has no specific knowledge of.
   */
  fallbackFocusRef?: RefObject<Focusable | null>
}

export function LockdownOverlay({ reason, onResume, printscreenNote, pasteMessage, pasteWhy, returnFocusRef, fallbackFocusRef }: LockdownOverlayProps) {
  const [toastMessage, setToastMessage] = useState('')
  const [toastSeenMessage, setToastSeenMessage] = useState('')
  const [toastDismissed, setToastDismissed] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)

  // R9.3 / fix round 1, I3: React's own "adjusting state when a prop
  // changes" pattern (docs: "You Might Not Need an Effect") -- called during
  // render, never inside a `useEffect`, so it cannot cascade an extra effect
  // pass and the React Compiler's set-state-in-effect rule does not apply.
  // `toastSeenMessage` is compared, not `toastDismissed`/`whyOpen` directly,
  // because the bank's rotation can legitimately repeat a string several
  // blocks later -- what marks a *new* block is the prop actually changing
  // value, not whatever text it happens to carry this time. A fresh,
  // non-empty message always restarts the toast's visible lifetime and
  // always arrives with "why" collapsed -- previously `whyOpen` survived
  // into the next block even though it carries a different rotating line.
  if (pasteMessage && pasteMessage !== toastSeenMessage) {
    setToastSeenMessage(pasteMessage)
    setToastMessage(pasteMessage)
    setToastDismissed(false)
    setWhyOpen(false)
  }

  const toastVisible = Boolean(toastMessage) && !toastDismissed

  // Fix round 2, N2: reaching "Why?" itself has to happen inside the old
  // fixed window -- pausing the timer only once `whyOpen` was already true
  // (fix round 1's own fix) cannot save a keyboard user who has not yet
  // Tabbed there, since the card already unmounted before their focus ever
  // arrives. `pasteWhy` existing at all means there is a control worth
  // protecting, so the dismiss timer never starts in that case: the toast
  // (message and the "Why?" control together) stays mounted and reachable
  // until superseded by the next distinct blocked-paste event (the
  // render-time adjustment above), never on a clock. A caller with no
  // `pasteWhy` keeps the original fixed-window behaviour, since there is no
  // control there to protect from a timed unmount. `setToastDismissed` here
  // runs inside a `setTimeout` callback, not synchronously in the effect
  // body, which is exactly the sanctioned "subscribe to an external timer" shape.
  useEffect(() => {
    if (!toastVisible || whyOpen || pasteWhy) return
    const timer = setTimeout(() => setToastDismissed(true), PASTE_TOAST_MS)
    return () => clearTimeout(timer)
  }, [toastVisible, whyOpen, toastMessage, pasteWhy])

  // Fix round 1, I4: return focus once the "why" panel closes. X6 (wave 2 review): falls back to
  // `fallbackFocusRef` when `returnFocusRef` has nothing to focus (a kind whose own component
  // never populated it), so focus never lands on `<body>` regardless of which kind is on screen.
  const wasWhyOpen = useRef(false)
  useEffect(() => {
    if (wasWhyOpen.current && !whyOpen) (returnFocusRef?.current ?? fallbackFocusRef?.current)?.focus()
    wasWhyOpen.current = whyOpen
  }, [whyOpen, returnFocusRef, fallbackFocusRef])

  // Fix round 1, I4: return focus once the full-screen overlay lifts. X6: same fallback as above.
  const wasShowingOverlay = useRef(false)
  useEffect(() => {
    if (wasShowingOverlay.current && !reason) (returnFocusRef?.current ?? fallbackFocusRef?.current)?.focus()
    wasShowingOverlay.current = Boolean(reason)
  }, [reason, returnFocusRef, fallbackFocusRef])

  // Fix round 1, I1: the bank's own honest line, picked once per transition
  // -- not on every re-render while the overlay stays up -- via `useMemo`
  // keyed on `reason`. `line()`'s no-seed path carries process-global
  // rotation state and is documented client-only; safe here because `reason`
  // is `null` through every server-rendered pass (`useLockdown`'s own
  // initial state), so this never runs during SSR in practice.
  const overlayMessage = useMemo(() => {
    if (!reason) return ''
    return reason === 'idle' ? line('guard.idle') : line('guard.blur')
  }, [reason])

  return (
    <>
      {reason && (
        <div
          role="status"
          aria-live="polite"
          data-testid="lockdown-overlay"
          data-reason={reason}
          className={`pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center p-6 text-foreground ${reason === 'idle' ? 'bg-background/85 backdrop-blur-2xl' : 'bg-background'}`}
        >
          <div className="max-w-sm space-y-4 text-center">
            <p className="text-base leading-relaxed">{overlayMessage}</p>
            {reason === 'idle' && <Button type="button" onClick={onResume}>Continue rep</Button>}
          </div>
        </div>
      )}
      {toastVisible && (
        // Fix round 1, presentation: pinned near the top of the viewport
        // instead of wherever this component happens to sit in the page's
        // normal flow, so the explanation for a paste just blocked in the
        // editor is never buried below the results panel or the fold.
        // Fix round 2, N7: `top-16`, not `top-4` -- now that the card can
        // stay up indefinitely (see the effect above), it must clear the app
        // header rather than sit over it.
        <div className="pointer-events-none fixed inset-x-0 top-16 z-[90] flex justify-center px-4">
          <div className="pointer-events-auto max-w-md rounded-lg border border-border bg-background px-4 py-3 shadow-sm">
            <p role="status" className="text-sm text-foreground">{toastMessage}</p>
            {pasteWhy && (
              <div className="mt-1.5 flex flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={() => setWhyOpen((open) => !open)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {whyOpen ? 'Hide why' : 'Why?'}
                </button>
                {whyOpen && <p className="text-xs leading-relaxed text-muted-foreground">{pasteWhy}</p>}
              </div>
            )}
          </div>
        </div>
      )}
      {printscreenNote && <p role="status" className="text-sm leading-relaxed text-muted-foreground">{printscreenNote}</p>}
    </>
  )
}
