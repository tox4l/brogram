'use client'

export function PredictOutput({ snippet, value, onChange, disabled = false }: {
  snippet: string; value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  return <div className="space-y-5 p-4">
    <pre className="overflow-x-auto rounded-md bg-muted/50 p-4 font-mono text-sm leading-7"><code>{snippet}</code></pre>
    <label className="block space-y-2"><span className="text-sm font-medium">Predicted output</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" rows={7} className="w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
    </label><p className="text-xs text-muted-foreground">Read the snippet and type what it prints.</p>
  </div>
}
