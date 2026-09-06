'use client'

import type { LockdownReason } from '@/hooks/useLockdown'
import { Button } from '@/components/ui/button'

export function LockdownOverlay({ reason, onResume }: { reason: LockdownReason | null; onResume?: () => void }) {
  if (!reason) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="lockdown-overlay"
      data-reason={reason}
      className={`pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center p-6 text-foreground ${reason === 'idle' ? 'bg-background/85 backdrop-blur-2xl' : 'bg-background'}`}
    >
      <div className="max-w-sm space-y-4 text-center">
        <p className="text-xl font-medium tracking-tight">{reason === 'printscreen' ? 'Keep your work here' : 'Come back to continue'}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {reason === 'idle' ? 'Your exercise is still here. Move your mouse or press a key when you are ready.' : reason === 'blur' ? 'Return to this window to resume your exercise.' : 'Your exercise will return in a moment.'}
        </p>
        {reason === 'idle' && <Button type="button" onClick={onResume}>Continue exercise</Button>}
      </div>
    </div>
  )
}
