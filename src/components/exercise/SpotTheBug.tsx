'use client'

import { useId } from 'react'

export function SpotTheBug({ snippet, value, onChange, disabled = false }: {
  snippet: string; value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const snippetId = useId()
  let selected: number[] = []
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) selected = parsed.filter((line): line is number => Number.isInteger(line)) } catch { /* Empty answer. */ }
  return <div className="space-y-4 p-4">
    <p className="text-sm text-muted-foreground">Select every line that contains a bug.</p>
    <div className="overflow-x-auto rounded-lg border border-border py-2">
      {snippet.split('\n').map((line, index) => <button key={index} type="button" aria-label={`Line ${index + 1}`} aria-describedby={`${snippetId}-${index}`} aria-pressed={selected.includes(index + 1)} disabled={disabled}
        onClick={() => onChange(JSON.stringify(selected.includes(index + 1) ? selected.filter((item) => item !== index + 1) : [...selected, index + 1].sort((a, b) => a - b)))}
        className="flex min-w-full items-baseline gap-4 px-3 py-1.5 text-left font-mono text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-emerald-300/10 aria-pressed:text-emerald-300 disabled:opacity-60">
        <span aria-hidden="true" className="w-6 shrink-0 text-right text-xs text-muted-foreground">{index + 1}</span><code id={`${snippetId}-${index}`} className="whitespace-pre">{line || ' '}</code>
      </button>)}
    </div><p className="text-xs text-muted-foreground">{selected.length} {selected.length === 1 ? 'line' : 'lines'} selected</p>
  </div>
}
