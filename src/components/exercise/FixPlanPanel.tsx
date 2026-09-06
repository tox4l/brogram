import type { CoachReply, DiagnoserReply } from '@/lib/contracts'

export function FixPlanPanel({ diagnosis, partialDiagnosis, hints, partialHint }: {
  diagnosis: DiagnoserReply | null; partialDiagnosis: Partial<DiagnoserReply> | null;
  hints: CoachReply[]; partialHint: Partial<CoachReply> | null
}) {
  const shown = partialDiagnosis ?? diagnosis
  if (!shown && hints.length === 0 && !partialHint) return null
  return <section aria-label="Fix plan" className="min-w-0 space-y-4 border-t border-border pt-5" aria-busy={Boolean(partialDiagnosis || partialHint)}>
    <h2 className="text-sm font-medium">Fix plan</h2>
    {typeof shown?.intent === 'string' && <p className="text-xs leading-relaxed text-muted-foreground">{shown.intent}</p>}
    {typeof shown?.rootCause === 'string' && <p className="text-sm leading-relaxed">{shown.rootCause}</p>}
    {Array.isArray(shown?.fixPlan) && <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">{shown.fixPlan.filter((step) => typeof step === 'string').map((step, index) => <li key={index}>{step}</li>)}</ol>}
    {hints.map((hint, index) => <div key={index} className="space-y-2 border-l-2 border-emerald-300/50 pl-3"><h3 className="text-xs font-medium text-muted-foreground">Hint {index + 1} · Step {hint.planStep}</h3><p className="text-sm leading-relaxed">{hint.hint}</p>{hint.codeLine && <code className="block whitespace-pre-wrap break-all font-mono text-xs">{hint.codeLine}</code>}</div>)}
    {typeof partialHint?.hint === 'string' && <p className="border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">{partialHint.hint}</p>}
    {(partialDiagnosis || partialHint) && <p role="status" className="text-xs text-muted-foreground">Thinking through your work…</p>}
  </section>
}
