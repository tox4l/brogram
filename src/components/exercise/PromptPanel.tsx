import { Fragment } from 'react'
import type { Clo, ExercisePublic } from '@/lib/contracts'

function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('`')
    ? <code key={index} className="rounded bg-muted px-1 font-mono text-[0.9em] text-foreground">{part.slice(1, -1)}</code>
    : part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>)
}

/** Render the bank's text as React nodes; never execute HTML supplied by an agent. */
function PromptText({ text }: { text: string }) {
  return text.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (part.startsWith('```')) return <pre key={index} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed"><code>{part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>
    return part.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => (
      <p key={`${index}-${paragraphIndex}`} className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{inline(paragraph.replace(/^#{1,6}\s/gm, ''))}</p>
    ))
  })
}

export function PromptPanel({ exercise, clo }: { exercise: ExercisePublic; clo?: Clo | null }) {
  const examples = exercise.kind === 'code' || exercise.kind === 'schema' ? exercise.tests.filter((test) => !test.hidden) : []
  return (
    <section aria-label="Exercise prompt" className="min-w-0 space-y-5">
      <div className="space-y-3"><h2 className="text-sm font-medium">The task</h2><PromptText text={exercise.prompt} /></div>
      {examples.length > 0 && <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-medium text-muted-foreground">Examples</h3>
        {examples.map((test, index) => <div key={test.id} className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
          <p className="font-medium">{test.name ?? `Example ${index + 1}`}</p>
          <dl className="space-y-2"><div><dt className="text-muted-foreground">Input</dt><dd className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">{test.input || '(none)'}</dd></div>
            <div><dt className="text-muted-foreground">Expected</dt><dd className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">{test.expected}</dd></div></dl>
        </div>)}
      </div>}
      {clo && <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">{clo.outcome}</p>}
    </section>
  )
}
