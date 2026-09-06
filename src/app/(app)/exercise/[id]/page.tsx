'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Play, Send } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { useSession } from '@/store/session'
import { useExerciseLoop } from '@/hooks/useExerciseLoop'
import { useLockdown } from '@/hooks/useLockdown'
import { Editor } from '@/components/exercise/Editor'
import { SchemaEditor } from '@/components/exercise/SchemaEditor'
import { PromptPanel } from '@/components/exercise/PromptPanel'
import { ResultsPanel } from '@/components/exercise/ResultsPanel'
import { FixPlanPanel } from '@/components/exercise/FixPlanPanel'
import { HintButton } from '@/components/exercise/HintButton'
import { LockdownOverlay } from '@/components/exercise/LockdownOverlay'
import { PredictOutput } from '@/components/exercise/PredictOutput'
import { SpotTheBug } from '@/components/exercise/SpotTheBug'
import { Trace } from '@/components/exercise/Trace'

function ExerciseWorkspace({ id }: { id: string }) {
  const loop = useExerciseLoop(id)
  const lockdown = useLockdown(id, { duringAttempt: loop.duringAttempt, enabled: Boolean(loop.exercise) })
  const exercise = loop.exercise
  if (!exercise) return <section aria-label="Exercise" className="mx-auto max-w-xl space-y-4 py-12">
    <h1 className="text-2xl font-medium tracking-tight">{loop.status === 'loading' ? 'Opening your exercise' : 'This exercise could not open'}</h1>
    <p role={loop.error ? 'alert' : 'status'} className="text-sm leading-relaxed text-muted-foreground">{loop.error ?? 'Loading your prompt and starting code.'}</p>
    <div className="flex gap-3">{loop.error && <Button onClick={() => void loop.retry()} variant="outline">Try again</Button>}<Link href="/dashboard" className={buttonVariants({ variant: 'ghost' })}>Back to courses</Link></div>
  </section>

  const disabled = loop.controlsDisabled
  const answerProps = { value: loop.code, onChange: loop.setCode, disabled }
  let variables: string[] = []
  if (exercise.kind === 'trace') {
    try {
      const expected: unknown = JSON.parse(exercise.tests[0]?.expected ?? '{}')
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) variables = Object.keys(expected)
    } catch { /* The loop reports malformed grading data on submit. */ }
  }

  return <div {...lockdown.containerProps} className="relative min-w-0 space-y-5" data-testid="exercise-workspace" data-exercise-id={exercise.id} data-pattern={exercise.pattern}>
    <div className="space-y-3" inert={Boolean(lockdown.overlay)}>
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-3" aria-hidden="true" />Courses</Link>
      <div className="flex flex-wrap items-start justify-between gap-3"><h1 className="min-w-0 max-w-4xl text-2xl font-medium tracking-tight">{exercise.title}</h1><p className="pt-1 font-mono text-xs text-muted-foreground">{exercise.language} · Difficulty {exercise.difficulty}/5</p></div>
    </div>

    {loop.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3 text-sm"><p className="min-w-0 flex-1">{loop.error}</p><Button variant="outline" disabled={loop.busy} onClick={() => void loop.retry()} className="transition-none">Try again</Button></div>}
    {lockdown.pasteMessage && <p role="status" className="text-sm text-muted-foreground">{lockdown.pasteMessage}</p>}
    {lockdown.loggingError && <p role="alert" className="text-sm text-muted-foreground">{lockdown.loggingError}</p>}

    <div inert={Boolean(lockdown.overlay)} className="grid min-w-0 gap-6 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(22rem,1.7fr)_minmax(14rem,0.9fr)]">
      <div className="min-w-0 xl:max-h-[calc(100dvh-17rem)] xl:overflow-y-auto xl:pr-1"><PromptPanel exercise={exercise} clo={loop.clo} /></div>
      <section aria-label="Your work" className="min-w-0 self-start overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 className="text-sm font-medium">{exercise.kind === 'code' || exercise.kind === 'schema' ? 'Your code' : 'Your answer'}</h2><span className="text-xs text-muted-foreground">Type your own work</span></div>
        {exercise.kind === 'predict-output' ? <PredictOutput snippet={exercise.starterCode} {...answerProps} />
          : exercise.kind === 'spot-the-bug' ? <SpotTheBug snippet={exercise.starterCode} {...answerProps} />
          : exercise.kind === 'trace' ? <Trace snippet={exercise.starterCode} variables={variables} {...answerProps} />
          : exercise.kind === 'schema' ? <SchemaEditor {...answerProps} logIntegrity={lockdown.logIntegrity} />
          : <Editor {...answerProps} language={exercise.language} logIntegrity={lockdown.logIntegrity} />}
        <div className="space-y-3 border-t border-border p-3">
          {/* Java's warmup reports whole steps ("Fetching the compiler (18 MB, once)"), not package names. */}
          {loop.progress?.phase === 'loading' && <p role="status" className="break-words text-xs leading-relaxed text-muted-foreground">{exercise.language === 'java' ? loop.progress.packageName : `Loading ${loop.progress.packageName}`}{loop.progress.message ? ` · ${loop.progress.message}` : ''}</p>}
          {loop.judgeAbsent
            ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm"><p className="text-muted-foreground">Java exercises are not available yet. Pick another course for now.</p><Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>Back to dashboard</Link></div>
            : <div className="flex flex-wrap items-center justify-end gap-2">
                {(exercise.kind === 'code' || exercise.kind === 'schema') && <Button variant="outline" onClick={() => void loop.run()} disabled={disabled} className="transition-none active:translate-y-0"><Play aria-hidden="true" />{loop.status === 'running' ? 'Running…' : 'Run'}</Button>}
                <Button onClick={() => void loop.submit()} disabled={disabled} className="bg-emerald-300 text-primary-foreground transition-none hover:bg-emerald-200 active:translate-y-0"><Send aria-hidden="true" />{loop.status === 'submitting' ? 'Checking…' : loop.status === 'passed' ? 'Passed' : 'Submit'}</Button>
              </div>}
        </div>
      </section>
      <div className="min-w-0 space-y-5 xl:max-h-[calc(100dvh-17rem)] xl:overflow-y-auto xl:pr-1">
        <ResultsPanel exercise={exercise} results={loop.results} stdout={loop.stdout} stderr={loop.stderr} status={loop.status} review={loop.review} pointsEarned={loop.pointsEarned} />
        <FixPlanPanel diagnosis={loop.diagnosis} partialDiagnosis={loop.partialDiagnosis} hints={loop.hints} partialHint={loop.partialHint} />
        {loop.diagnosis && loop.status !== 'passed' && <HintButton available={loop.hintAvailable} waitSeconds={loop.hintWaitSeconds} count={loop.hintCount} busy={loop.busy} onRequest={() => void loop.requestHint()} />}
        {loop.status === 'passed' && <div className="space-y-3 border-t border-border pt-4"><p className="text-sm leading-relaxed text-muted-foreground">{loop.closed ? 'Outcome complete. Your next steps are ready.' : loop.nextExercise ? 'Keep going with a different pattern.' : loop.busy ? 'Preparing your next exercise.' : 'Your pass is saved.'}</p><Button onClick={() => void loop.next()} disabled={loop.busy} className="w-full transition-none active:translate-y-0">{loop.closed ? 'Back to your path' : 'Next exercise'}<ArrowRight aria-hidden="true" /></Button></div>}
      </div>
    </div>
    <LockdownOverlay reason={lockdown.overlay} onResume={lockdown.resume} />
  </div>
}

export default function ExercisePage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useSession()
  if (!profile || profile.account_status === 'restricted' || profile.account_status === 'banned') return <section className="space-y-4 py-10"><h1 className="text-2xl font-medium">Exercises are paused</h1><p className="text-sm text-muted-foreground">Your account cannot open an exercise right now.</p><Link className={buttonVariants({ variant: 'outline' })} href="/dashboard">Back to dashboard</Link></section>
  return <ExerciseWorkspace key={id} id={id} />
}
