import type { ExercisePublic, ReviewerReply, TestResult } from '@/lib/contracts'

export function ResultsPanel({ exercise, results, stdout, stderr, status, review, pointsEarned = 0 }: {
  exercise: ExercisePublic; results: TestResult[]; stdout: string; stderr: string; status: string;
  review?: ReviewerReply | null; pointsEarned?: number
}) {
  return <section aria-label="Results" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-medium">Results</h2>
      {results.length > 0 && <p role="status" className="font-mono text-xs text-muted-foreground">{results.filter((result) => result.passed).length} / {results.length} passed</p>}
    </div>
    {results.length === 0 && !stdout && !stderr && <p className="text-sm leading-relaxed text-muted-foreground">{status === 'running' || status === 'submitting' ? 'Running your work. Results will appear here.' : 'Run to explore your output, or submit when you are ready to check your work.'}</p>}
    {(stdout || stderr) && <div className="space-y-2"><h3 className="text-xs text-muted-foreground">Run output</h3>{stdout && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{stdout}</pre>}{stderr && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-destructive/40 p-3 font-mono text-xs">{stderr}</pre>}</div>}
    <ul className="divide-y divide-border">
      {results.map((result, index) => {
        const test = exercise.tests.find((item) => item.id === result.testId)
        const hidden = !test || test.hidden
        const details = !hidden && (exercise.kind === 'code' || exercise.kind === 'schema')
        return <li key={`${result.testId}-${index}`} className="py-3 text-xs">
          <div className="flex justify-between gap-3"><span>{hidden ? 'Hidden test' : test.name ?? `Test ${index + 1}`}</span><span className={result.passed ? 'text-emerald-300' : 'text-muted-foreground'}>{result.passed ? 'Passed' : 'Needs work'}</span></div>
          {!result.passed && <p className="mt-1 text-muted-foreground">{result.failureKind === 'timeout' ? 'Time limit reached.' : result.failureKind === 'compile-error' ? 'Could not compile.' : result.failureKind === 'runtime-error' ? 'Could not finish running.' : 'The result does not match.'}</p>}
          {details && !result.passed && <dl className="mt-3 space-y-2">
            <div><dt className="text-muted-foreground">Your result</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono">{result.actual || '(no output)'}</dd></div>
            <div><dt className="text-muted-foreground">Expected</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono">{result.expected}</dd></div>
            {result.stderr && <div><dt className="text-muted-foreground">Error</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono">{result.stderr}</dd></div>}
          </dl>}
        </li>
      })}
    </ul>
    {review && <div className="space-y-3 border-t border-border pt-4"><p className="text-sm font-medium text-emerald-300">{review.praise}</p><p className="font-mono text-xs text-muted-foreground">+{pointsEarned} points · Quality {review.quality}/100</p><ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-muted-foreground">{review.improvements.map((improvement, index) => <li key={index}>{improvement}</li>)}</ul></div>}
  </section>
}
