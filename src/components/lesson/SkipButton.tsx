'use client'

import { Button } from '@/components/ui/button'

/** The "skip this" affordance, always present in the header (R3.3) -- a
 *  walkthrough is a strong default, never a lock. */
export function SkipButton({ onSkip, disabled = false }: { onSkip: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onSkip} disabled={disabled}>
      I&apos;ve got this
    </Button>
  )
}
