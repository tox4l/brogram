'use client'

import { Input } from '@/components/ui/input'

export function Trace({ snippet, variables, value, onChange, disabled = false }: {
  snippet: string; variables: string[]; value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  let cells: Record<string, string> = {}
  try { const parsed: unknown = JSON.parse(value); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cells = parsed as Record<string, string> } catch { /* Empty answer. */ }
  return <div className="space-y-5 p-4">
    <pre className="overflow-x-auto rounded-md bg-muted/50 p-4 font-mono text-sm leading-7"><code>{snippet}</code></pre>
    <p className="text-sm text-muted-foreground">Enter each variable’s value at the step described in the task.</p>
    <div className="grid gap-4 sm:grid-cols-2">{variables.map((variable) => <label key={variable} className="space-y-2"><span className="block font-mono text-sm">{variable}</span>
      <Input aria-label={variable} value={typeof cells[variable] === 'string' ? cells[variable] : ''} disabled={disabled} spellCheck={false} autoComplete="off" className="font-mono transition-none"
        onChange={(event) => onChange(JSON.stringify({ ...cells, [variable]: event.target.value }))} />
    </label>)}</div>
  </div>
}
