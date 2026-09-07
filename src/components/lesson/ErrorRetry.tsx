'use client'

import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { line } from '@/lib/voice/lines'

/**
 * The shared error-with-retry banner every screen in spec section 10 is
 * supposed to use ("No screen has an unstyled error state"). No shared one
 * existed anywhere under `src/components` at the time this task started
 * (`onboarding/page.tsx` has its own unexported local copy) -- this is the
 * first one under this task's own path, per the brief's instruction to
 * create it here when it is missing.
 *
 * `message` is optional (T2.7b): every call site today names its own cause,
 * but a caller with no more specific cause to give can fall back to the
 * bank's own honest, cause-then-step `error.load` line instead of inventing
 * another literal.
 */
export function ErrorRetry({ message = line('error.load'), onRetry, secondaryHref, secondaryLabel }: {
  message?: string
  onRetry: () => void
  secondaryHref?: string
  secondaryLabel?: string
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-4">
      <p className="min-w-0 flex-1 text-body">{message}</p>
      <div className="flex items-center gap-2">
        {secondaryHref && secondaryLabel && (
          <Link href={secondaryHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>{secondaryLabel}</Link>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
      </div>
    </div>
  )
}
