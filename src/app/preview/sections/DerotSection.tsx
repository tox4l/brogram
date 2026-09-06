'use client'

import { useState } from 'react'
import type { DrillKind, DrillResult } from '@/lib/contracts'
import { DrillRunner } from '@/components/derot/DrillRunner'
import { cn } from '@/lib/utils'
import { DRILL_KIND_LABELS, DRILL_KINDS, fixtureDrillItems } from '../fixtures'
import { Section } from './Section'

export function DerotSection() {
  const [active, setActive] = useState<DrillKind>('predict-output')
  const [results, setResults] = useState<Partial<Record<DrillKind, DrillResult>>>({})

  return (
    <Section id="derot" title="De-rot" caption="One seed item per drill kind, run through the real DrillRunner. Each completed drill's onResult payload is shown as JSON beneath it.">
      <div role="tablist" aria-label="De-rot drill kind" className="flex flex-wrap gap-2">
        {DRILL_KINDS.map((kind) => (
          <button key={kind} type="button" role="tab" aria-selected={active === kind} onClick={() => setActive(kind)}
            className={cn('rounded-full border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              active === kind ? 'border-emerald-300 bg-emerald-300/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
            {DRILL_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      <div className="space-y-4 rounded-xl border border-border p-5">
        <DrillRunner key={active} item={fixtureDrillItems[active]} onResult={(result) => setResults((current) => ({ ...current, [active]: result }))} />
        {results[active] && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">onResult payload</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{JSON.stringify(results[active], null, 2)}</pre>
          </div>
        )}
      </div>
    </Section>
  )
}
