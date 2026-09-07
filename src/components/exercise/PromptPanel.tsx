import { Fragment } from 'react'
import type { Clo, ExercisePublic } from '@/lib/contracts'

// Fix round M2 (Ruling W4.12): the editor kills ligatures on `.cm-scroller`, but this file's own
// `<pre>`/`<code>` sites render Geist Mono on the same code surface with no feature-settings --
// a Python brief containing `!=` rendered it as a ligature glyph in the brief while the editor
// beside it renders the two characters the learner must type. Not a shared `globals.css` utility
// (that file is outside this task's owned paths); the arbitrary-value class is self-contained.
const NO_LIGATURES = "[font-feature-settings:'liga'_0,_'calt'_0]"

function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('`')
    ? <code key={index} className={`rounded-lg bg-muted px-1 font-mono text-code text-foreground ${NO_LIGATURES}`}>{part.slice(1, -1)}</code>
    : part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>)
}

/** Render the bank's text as React nodes; never execute HTML supplied by an agent. */
function PromptText({ text }: { text: string }) {
  return text.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (part.startsWith('```')) return <pre key={index} className={`overflow-x-auto rounded-xl bg-lesson-code-surface p-3 font-mono text-code text-code-variable ${NO_LIGATURES}`}><code>{part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre>
    return part.split(/\n\s*\n/).filter(Boolean).map((paragraph, paragraphIndex) => (
      // T4.7 / spec section 9: "brief prose is Geist Sans at --text-body in every palette" --
      // this is the primary task description, so it reads in `--foreground`, not the muted
      // tier the brief used to be demoted to (the same over-demotion the wave's diagnosis
      // calls out for lesson prose).
      <p key={`${index}-${paragraphIndex}`} className="whitespace-pre-wrap break-words font-normal text-body text-foreground">{inline(paragraph.replace(/^#{1,6}\s/gm, ''))}</p>
    ))
  })
}

export function PromptPanel({ exercise, clo }: { exercise: ExercisePublic; clo?: Clo | null }) {
  const examples = exercise.kind === 'code' || exercise.kind === 'schema' ? exercise.tests.filter((test) => !test.hidden) : []
  return (
    <section aria-label="Rep prompt" className="min-w-0 space-y-4">
      <div className="space-y-3"><h2 className="text-micro uppercase tracking-[0.06em] text-muted-foreground">The task</h2><PromptText text={exercise.prompt} /></div>
      {examples.length > 0 && <div className="space-y-3 border-t border-rule pt-4">
        <h3 className="text-micro uppercase tracking-[0.06em] text-muted-foreground">Examples</h3>
        {examples.map((test, index) => <div key={test.id} className="space-y-2 rounded-xl bg-muted/40 p-3 text-small">
          <p className="font-medium">{test.name ?? `Example ${index + 1}`}</p>
          <dl className="space-y-2"><div><dt className="text-muted-foreground">Input</dt><dd className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">{test.input || '(none)'}</dd></div>
            <div><dt className="text-muted-foreground">Expected</dt><dd className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">{test.expected}</dd></div></dl>
        </div>)}
      </div>}
      {clo && <p className="border-t border-rule pt-4 text-small text-muted-foreground">{clo.outcome}</p>}
    </section>
  )
}
