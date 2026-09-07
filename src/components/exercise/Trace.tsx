'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { Input } from '@/components/ui/input'
import type { Focusable } from './LockdownOverlay'

export function Trace({ snippet, variables, value, onChange, disabled = false, focusRef }: {
  snippet: string; variables: string[]; value: string; onChange: (value: string) => void; disabled?: boolean
  /**
   * X6 (wave 2 review): see `PredictOutput`'s own comment on this prop. Focused via the
   * container rather than a ref on the shadcn `Input` directly -- that wrapper spreads its props
   * onward rather than declaring its own `ref` parameter, so a `ref` handed to it is not
   * guaranteed to reach the underlying `<input>`; querying the DOM for the first rendered input
   * inside this component's own container makes no assumption about that either way.
   */
  focusRef?: RefObject<Focusable | null>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusRef) return
    focusRef.current = { focus: () => containerRef.current?.querySelector('input')?.focus() }
    return () => { focusRef.current = null }
  }, [focusRef])
  let cells: Record<string, string> = {}
  try { const parsed: unknown = JSON.parse(value); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cells = parsed as Record<string, string> } catch { /* Empty answer. */ }
  return <div ref={containerRef} className="space-y-4 p-4">
    {/* Fix round M2 (Ruling W4.12): same fix as Editor.tsx's `.cm-scroller`. */}
    <pre className="overflow-x-auto rounded-xl bg-lesson-code-surface p-4 font-mono text-code text-code-variable [font-feature-settings:'liga'_0,_'calt'_0]"><code>{snippet}</code></pre>
    <p className="text-small text-muted-foreground">Enter each variable’s value at the step described in the task.</p>
    <div className="grid gap-4 sm:grid-cols-2">{variables.map((variable) => <label key={variable} className="space-y-2"><span className="block font-mono text-small">{variable}</span>
      <Input aria-label={variable} value={typeof cells[variable] === 'string' ? cells[variable] : ''} disabled={disabled} spellCheck={false} autoComplete="off" className="font-mono transition-none"
        onChange={(event) => onChange(JSON.stringify({ ...cells, [variable]: event.target.value }))} />
    </label>)}</div>
  </div>
}
