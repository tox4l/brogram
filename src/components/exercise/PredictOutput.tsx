'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { Focusable } from './LockdownOverlay'

export function PredictOutput({ snippet, value, onChange, disabled = false, focusRef }: {
  snippet: string; value: string; onChange: (value: string) => void; disabled?: boolean
  /**
   * X6 (wave 2 review): the same shared ref `page.tsx` passes into `LockdownOverlay`'s
   * `returnFocusRef` for the `code`/`schema` kinds (`Editor.tsx`'s own `focusRef` prop) --
   * without it here, focus returning through that ref was a permanent no-op on this kind, so
   * the lockdown overlay lifting (or the paste "why" panel closing) dropped focus to `<body>`.
   */
  focusRef?: RefObject<Focusable | null>
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!focusRef) return
    focusRef.current = { focus: () => textareaRef.current?.focus() }
    return () => { focusRef.current = null }
  }, [focusRef])
  return <div className="space-y-4 p-4">
    {/* Fix round M2 (Ruling W4.12): same fix as Editor.tsx's `.cm-scroller` -- this snippet sits
        on the same code surface in the same mono face and needs the same ligature kill. */}
    <pre className="overflow-x-auto rounded-xl bg-lesson-code-surface p-4 font-mono text-code text-code-variable [font-feature-settings:'liga'_0,_'calt'_0]"><code>{snippet}</code></pre>
    <label className="block space-y-2"><span className="text-micro uppercase tracking-[0.06em] text-muted-foreground">Predicted output</span>
      <textarea ref={textareaRef} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" rows={7} className="w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-body outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
    </label><p className="text-small text-muted-foreground">Read the snippet and type what it prints.</p>
  </div>
}
