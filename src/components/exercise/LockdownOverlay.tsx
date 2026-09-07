'use client'

import { useState } from 'react'
import type { LockdownReason } from '@/hooks/useLockdown'
import { Button } from '@/components/ui/button'

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
  /** R9.3: the rotating paste-block toast, with an optional "why" sentence
   *  behind a small, inert expand affordance -- no shake, no motion, no sound. */
  pasteMessage?: string
  pasteWhy?: string
}

export function LockdownOverlay({ reason, onResume, printscreenNote, pasteMessage, pasteWhy }: LockdownOverlayProps) {
  const [whyOpen, setWhyOpen] = useState(false)

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
            <p className="text-xl font-medium tracking-tight">Come back to continue</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {reason === 'idle' ? 'Your exercise is still here. Move your mouse or press a key when you are ready.' : 'Return to this window to resume your exercise.'}
            </p>
            {reason === 'idle' && <Button type="button" onClick={onResume}>Continue exercise</Button>}
          </div>
        </div>
      )}
      {pasteMessage && (
        <p role="status" className="text-sm text-muted-foreground">
          {pasteMessage}
          {pasteWhy && (
            <>
              {' '}
              <button type="button" onClick={() => setWhyOpen((open) => !open)} className="underline underline-offset-2">
                Why?
              </button>
              {whyOpen && <span className="mt-1 block">{pasteWhy}</span>}
            </>
          )}
        </p>
      )}
      {printscreenNote && <p role="status" className="text-sm leading-relaxed text-muted-foreground">{printscreenNote}</p>}
    </>
  )
}
