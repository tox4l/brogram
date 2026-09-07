import type { ExercisePublic, ReviewerReply, TestResult } from '@/lib/contracts'

export function ResultsPanel({ exercise, results, stdout, stderr, status, review, pointsEarned = 0 }: {
  exercise: ExercisePublic; results: TestResult[]; stdout: string; stderr: string; status: string;
  review?: ReviewerReply | null; pointsEarned?: number
}) {
  return <section aria-label="Results" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-micro uppercase tracking-[0.06em] text-muted-foreground">Results</h2>
      {results.length > 0 && <p role="status" className="font-mono text-small text-muted-foreground">{results.filter((result) => result.passed).length} / {results.length} passed</p>}
    </div>
    {results.length === 0 && !stdout && !stderr && <p className="font-normal text-body text-muted-foreground">{status === 'running' || status === 'submitting' ? 'Running your work. Results will appear here.' : 'Run to explore your output, or submit when you are ready to check your work.'}</p>}
    {/* Fix round M2 (Ruling W4.12): both run-output blocks sit on the code surface in Geist
        Mono and need the same ligature kill Editor.tsx's `.cm-scroller` carries. */}
    {(stdout || stderr) && <div className="space-y-2"><h3 className="text-micro uppercase tracking-[0.06em] text-muted-foreground">Run output</h3>{stdout && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-lesson-code-surface p-3 font-mono text-code text-code-variable [font-feature-settings:'liga'_0,_'calt'_0]">{stdout}</pre>}{stderr && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-rule bg-lesson-code-surface p-3 font-mono text-code text-destructive [font-feature-settings:'liga'_0,_'calt'_0]">{stderr}</pre>}</div>}
    {/* T4.7: results rows sit on `--rule`, per the exercise screen's own spec line. */}
    <ul className="divide-y divide-rule">
      {results.map((result, index) => {
        const test = exercise.tests.find((item) => item.id === result.testId)
        const hidden = !test || test.hidden
        const details = !hidden && (exercise.kind === 'code' || exercise.kind === 'schema')
        return <li key={`${result.testId}-${index}`} className="py-3 text-small">
          <div className="flex justify-between gap-3"><span>{hidden ? 'Hidden test' : test.name ?? `Test ${index + 1}`}</span><span className={result.passed ? 'font-medium text-success' : 'text-muted-foreground'}>{result.passed ? 'Passed' : 'Needs work'}</span></div>
          {!result.passed && <p className="mt-1 text-muted-foreground">{result.failureKind === 'timeout' ? 'Time limit reached.' : result.failureKind === 'compile-error' ? 'Could not compile.' : result.failureKind === 'runtime-error' ? 'Could not finish running.' : 'The result does not match.'}</p>}
          {details && !result.passed && <dl className="mt-3 space-y-2">
            <div><dt className="text-muted-foreground">Actual</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono">{result.actual || '(no output)'}</dd></div>
            <div><dt className="text-muted-foreground">Expected</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono">{result.expected}</dd></div>
            {result.stderr && <div><dt className="text-muted-foreground">Error</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono">{result.stderr}</dd></div>}
          </dl>}
        </li>
      })}
    </ul>
    {review && <div className="space-y-3 border-t border-rule pt-4"><p className="font-medium text-body text-success">{review.praise}</p><p className="font-mono text-micro text-muted-foreground">+{pointsEarned} points · Quality {review.quality}/100</p><ul className="list-disc space-y-2 pl-4 text-small text-muted-foreground">{review.improvements.map((improvement, index) => <li key={index}>{improvement}</li>)}</ul></div>}
  </section>
}
