'use client'

import { useEffect, useId, useRef, type RefObject } from 'react'
import type { Focusable } from './LockdownOverlay'

export function SpotTheBug({ snippet, value, onChange, disabled = false, focusRef }: {
  snippet: string; value: string; onChange: (value: string) => void; disabled?: boolean
  /** X6 (wave 2 review): see `PredictOutput`'s own comment on this prop -- same shared ref,
   *  attached here to the first line's button, the first focusable control this kind renders. */
  focusRef?: RefObject<Focusable | null>
}) {
  const snippetId = useId()
  const firstButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!focusRef) return
    focusRef.current = { focus: () => firstButtonRef.current?.focus() }
    return () => { focusRef.current = null }
  }, [focusRef])
  let selected: number[] = []
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) selected = parsed.filter((line): line is number => Number.isInteger(line)) } catch { /* Empty answer. */ }
  return <div className="space-y-4 p-4">
    <p className="text-small text-muted-foreground">Select every line that contains a bug.</p>
    {/* T4.7: a marked line is a selection state, the same role `--primary` already carries for
        every other "this one is active" control in the app -- not a verdict, so it never
        borrows `--success`/`--destructive`. */}
    <div className="overflow-x-auto rounded-lg border border-rule bg-lesson-code-surface py-2">
      {snippet.split('\n').map((line, index) => <button key={index} ref={index === 0 ? firstButtonRef : undefined} type="button" aria-label={`Line ${index + 1}`} aria-describedby={`${snippetId}-${index}`} aria-pressed={selected.includes(index + 1)} disabled={disabled}
        onClick={() => onChange(JSON.stringify(selected.includes(index + 1) ? selected.filter((item) => item !== index + 1) : [...selected, index + 1].sort((a, b) => a - b)))}
        // Fix round I2: hover/focus-visible were `bg-muted`, which in Folio equals
        // `bg-lesson-code-surface` (this list's own ground) byte for byte -- a Folio learner got
        // no hover response at all on this kind's primary interaction. `bg-rule` steps against
        // the code surface in all five palettes; see Editor.tsx's matching fix for the same bug.
        // Fix round M2 (Ruling W4.12): same ligature kill as Editor.tsx's `.cm-scroller` -- this
        // is the one place in the app a learner reads code they did not type themselves.
        className="flex min-w-full items-baseline gap-4 px-3 py-2 text-left font-mono text-code text-code-variable outline-none hover:bg-rule focus-visible:bg-rule focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-primary/10 aria-pressed:text-primary disabled:opacity-60 [font-feature-settings:'liga'_0,_'calt'_0]">
        <span aria-hidden="true" className="w-6 shrink-0 text-right text-micro text-code-comment">{index + 1}</span><code id={`${snippetId}-${index}`} className="whitespace-pre">{line || ' '}</code>
      </button>)}
    </div><p className="text-small text-muted-foreground">{selected.length} {selected.length === 1 ? 'line' : 'lines'} selected</p>
  </div>
}
