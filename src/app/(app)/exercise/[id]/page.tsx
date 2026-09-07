'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useLayoutEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, Play, Send, X } from 'lucide-react'
import { line, lineWith } from '@/lib/voice/lines'
import { angleWord, difficultyWord, repWord } from '@/lib/voice/glossary'
import { Button, buttonVariants } from '@/components/ui/button'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { useExerciseLoop } from '@/hooks/useExerciseLoop'
import { useLockdown } from '@/hooks/useLockdown'
import { PromptPanel } from '@/components/exercise/PromptPanel'
import { ResultsPanel } from '@/components/exercise/ResultsPanel'
import { FixPlanPanel } from '@/components/exercise/FixPlanPanel'
import { HintButton } from '@/components/exercise/HintButton'
import { LockdownOverlay } from '@/components/exercise/LockdownOverlay'
import { PredictOutput } from '@/components/exercise/PredictOutput'
import { SpotTheBug } from '@/components/exercise/SpotTheBug'
import { Trace } from '@/components/exercise/Trace'
import type { Focusable } from '@/components/exercise/LockdownOverlay'
import { Celebration } from '@/components/rewards/Celebration'
import { ChainPips } from '@/components/rewards/ChainPips'
import { XpCounter } from '@/components/rewards/XpCounter'

/**
 * Step 7 / spec 5.5: `Editor` (and `SchemaEditor`, which wraps it) become
 * `next/dynamic` with `ssr: false` here in `page.tsx`, not inside the shared
 * component itself (not owned by this task) -- exactly the split the spec's
 * own file reference (`exercise/[id]/page.tsx:10`) names. CodeMirror's core
 * plus its React glue never sits in this route's initial chunk; the skeleton
 * mirrors the editor's real chrome (a header bar plus gutter-shaped lines)
 * rather than a bare sentence, so the layout does not jump when it resolves.
 */
function EditorSkeleton() {
  return <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5"><div className="h-3 w-16 rounded bg-muted" /></div>
    <div className="min-h-[360px] space-y-2.5 bg-background p-4">
      {[0, 1, 2, 3, 4, 5, 6].map((row) => <div key={row} className="flex items-center gap-3"><div className="h-3 w-4 shrink-0 rounded bg-muted/70" /><div className="h-3 rounded bg-muted/70" style={{ width: `${45 + (row * 7) % 40}%` }} /></div>)}
    </div>
  </div>
}
const DynamicEditor = dynamic(() => import('@/components/exercise/Editor').then((mod) => mod.Editor), { ssr: false, loading: EditorSkeleton })
const DynamicSchemaEditor = dynamic(() => import('@/components/exercise/SchemaEditor').then((mod) => mod.SchemaEditor), { ssr: false, loading: EditorSkeleton })

function ExerciseWorkspace({ id }: { id: string }) {
  // V4 / A11Y-03 (wave 2 review): a bare `useReducedMotion()` call means 'system' -- it can never
  // see a learner who set Reduced (or Full) in the app on an OS reporting no preference either
  // way, which is exactly the load-bearing case the pass-moment celebration exists to respect.
  // `(app)/layout.tsx` already seeds the resolved wellness row into the query cache (the same
  // pattern `ThemeQuickSwitch`/the dashboard already use), so this costs zero extra requests.
  const wellnessQuery = useWellness()
  const motionPref = resolveWellnessPrefs(wellnessQuery.data?.prefs).motion
  const loop = useExerciseLoop(id, motionPref)
  const router = useRouter()
  const resultsRef = useRef<HTMLDivElement>(null)
  // Fix round 3 (T2.8's returnFocusRef, previously wired nowhere): the same ref goes into the
  // editor (which populates it once its CodeMirror view exists) and into LockdownOverlay (which
  // calls `.focus()` on it the instant the overlay lifts or the paste "why" panel closes).
  // X6 (wave 2 review): the three answer-form kinds below now populate it too -- it used to stay
  // permanently null on `predict-output`/`spot-the-bug`/`trace`, making both of LockdownOverlay's
  // return-focus effects silent no-ops on those kinds.
  const editorFocusRef = useRef<Focusable | null>(null)
  // X6: the floor `LockdownOverlay` falls back to when `returnFocusRef` has nothing to focus --
  // focus never lands on `<body>` regardless of the exercise kind on screen.
  const workspaceRef = useRef<HTMLDivElement>(null)
  // A11Y-05 (wave 2 review): the heading is a focus target for every exercise transition -- an
  // in-place `next()` swap unmounts the "Next rep" button the learner just activated (`outcome`
  // resets to null) with no route change and no `document.title` change for the App Router's own
  // announcer to react to, so without this focus drops to `<body>` on the single most repeated
  // action in the product. A layout effect keeps the move inside the same paint the swap itself
  // commits in. Fires on a genuine mount too (a fresh load, or the store-hydrated remount `next()`
  // causes), which is harmless -- the same behaviour a route change would already produce.
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Fix round 5 (T2.2 review of round 4, C1, belt and braces): `router.replace()` is back for the
  // in-place transition (see the hook's own comment), so the URL param genuinely does update on
  // `next()` -- but this reads the LOADED exercise, not the param, anyway: every event `logIntegrity`
  // writes is keyed on whichever id this hook is given, and a raw param read here is one more place
  // that could silently drift from what is actually on screen if this page's own routing ever
  // changes again. `loop.exercise` is the single source of truth for what the learner sees; falling
  // back to `id` only covers the instant before the very first exercise has loaded.
  const lockdown = useLockdown(loop.exercise?.id ?? id, { duringAttempt: loop.duringAttempt, enabled: Boolean(loop.exercise) })
  const exercise = loop.exercise
  useLayoutEffect(() => {
    if (exercise) headingRef.current?.focus()
    // Keyed on the exercise's identity only: a re-render that leaves the same exercise on
    // screen (a retry, an in-flight save reconciling) must not steal focus back to the heading
    // a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise?.id])
  if (!exercise) return <section aria-label="Rep" className="mx-auto max-w-xl space-y-4 py-12">
    <h1 className="text-2xl font-medium tracking-tight">{loop.status === 'loading' ? 'Opening your rep' : 'This rep could not open'}</h1>
    <p role={loop.error ? 'alert' : 'status'} className="text-sm leading-relaxed text-muted-foreground">{loop.error ?? 'Loading your prompt and starting code.'}</p>
    <div className="flex gap-3">{loop.error && <Button onClick={() => void loop.retry()} variant="outline">Try again</Button>}<Link href="/dashboard" className={buttonVariants({ variant: 'ghost' })}>Back to courses</Link></div>
  </section>

  const disabled = loop.controlsDisabled
  const answerProps = { value: loop.code, onChange: loop.setCode, disabled }
  let variables: string[] = []
  // A `trace` exercise with no plain-object `expected` (three bank rows carry a single value,
  // en route to becoming `predict-output`) has nothing for Trace to render an input for -- fall
  // back to the same typed-answer path `predict-output` already uses rather than an empty form
  // the learner cannot answer.
  let traceUnanswerable = false
  if (exercise.kind === 'trace') {
    try {
      const expected: unknown = JSON.parse(exercise.tests[0]?.expected ?? '{}')
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) variables = Object.keys(expected)
      else traceUnanswerable = true
    } catch { traceUnanswerable = true }
  }

  return <div {...lockdown.containerProps} ref={workspaceRef} tabIndex={-1} className="relative min-w-0 space-y-5 outline-none" data-testid="exercise-workspace" data-exercise-id={exercise.id} data-pattern={exercise.pattern}>
    {/* A11Y-05: the visible heading (focused above) already carries the new title, but a
        screen-reader user is not guaranteed to hear a plain focused heading read out reliably in
        every browser/AT combination -- this sr-only line (mirroring `RunSummary.tsx`'s own
        "announce it, don't rely on focus alone" pattern) is the load-bearing half, since neither
        the in-place swap nor the store-hydrated remount changes `document.title` for the App
        Router's own announcer to react to. */}
    <p role="status" aria-live="polite" className="sr-only">{`Rep opened. ${exercise.title}.`}</p>
    <div className="space-y-3" inert={Boolean(lockdown.overlay)}>
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-3" aria-hidden="true" />Courses</Link>
      <div className="flex flex-wrap items-start justify-between gap-3"><h1 ref={headingRef} tabIndex={-1} className="min-w-0 max-w-4xl text-2xl font-medium tracking-tight outline-none">{exercise.title}</h1><p className="pt-1 font-mono text-xs text-muted-foreground">{exercise.language} · {difficultyWord(exercise.difficulty)}</p></div>
    </div>

    {loop.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3 text-sm"><p className="min-w-0 flex-1">{loop.error}</p><Button variant="outline" disabled={loop.busy} onClick={() => void loop.retry()} className="transition-none">Try again</Button></div>}
    {lockdown.loggingError && <p role="alert" className="text-sm text-muted-foreground">{lockdown.loggingError}</p>}

    <div inert={Boolean(lockdown.overlay)} className="grid min-w-0 gap-6 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(22rem,1.7fr)_minmax(14rem,0.9fr)]">
      {/* Step 4: named so an in-place `next()` crossfades only this panel; the editor and its
          warm runtime sit outside it and never re-enter a transition. */}
      <div className="min-w-0 xl:max-h-[calc(100dvh-17rem)] xl:overflow-y-auto xl:pr-1" style={{ viewTransitionName: 'exercise-prompt' }}><PromptPanel exercise={exercise} clo={loop.clo} /></div>
      <section aria-label="Work" className="min-w-0 self-start overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 className="text-sm font-medium">{exercise.kind === 'code' || exercise.kind === 'schema' ? 'Code' : 'Answer'}</h2></div>
        {exercise.kind === 'predict-output' || (exercise.kind === 'trace' && traceUnanswerable) ? <PredictOutput snippet={exercise.starterCode} {...answerProps} focusRef={editorFocusRef} />
          : exercise.kind === 'spot-the-bug' ? <SpotTheBug snippet={exercise.starterCode} {...answerProps} focusRef={editorFocusRef} />
          : exercise.kind === 'trace' ? <Trace snippet={exercise.starterCode} variables={variables} {...answerProps} focusRef={editorFocusRef} />
          : exercise.kind === 'schema' ? <DynamicSchemaEditor {...answerProps} logIntegrity={lockdown.logIntegrity} focusRef={editorFocusRef} />
          : <DynamicEditor {...answerProps} language={exercise.language} logIntegrity={lockdown.logIntegrity} focusRef={editorFocusRef} />}
        <div className="space-y-3 border-t border-border p-3">
          {/* Java's warmup reports whole steps ("Fetching the compiler (18 MB, once)"), not package names. */}
          {loop.progress?.phase === 'loading' && <p role="status" className="break-words text-xs leading-relaxed text-muted-foreground">{exercise.language === 'java' ? loop.progress.packageName : `Loading ${loop.progress.packageName}`}{loop.progress.message ? ` · ${loop.progress.message}` : ''}</p>}
          {loop.judgeAbsent
            ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm"><p className="text-muted-foreground">Java reps aren&apos;t available yet. Pick another course for now.</p><Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>Back to dashboard</Link></div>
            : <div className="flex flex-wrap items-center justify-end gap-2">
                {(exercise.kind === 'code' || exercise.kind === 'schema') && <Button variant="outline" onClick={() => void loop.run()} disabled={disabled} className="transition-none active:translate-y-0"><Play aria-hidden="true" />{loop.status === 'running' ? 'Running…' : 'Run'}</Button>}
                <Button onClick={() => void loop.submit()} disabled={disabled} className="bg-emerald-300 text-primary-foreground transition-none hover:bg-emerald-200 active:translate-y-0"><Send aria-hidden="true" />{loop.outcome === 'passed' ? 'Passed' : loop.status === 'submitting' ? 'Checking…' : 'Submit'}</Button>
              </div>}
        </div>
      </section>
      <div ref={resultsRef} className="min-w-0 space-y-5 xl:max-h-[calc(100dvh-17rem)] xl:overflow-y-auto xl:pr-1">
        {/* Steps 1, 2 & 8: the verdict, the XP figure and the chain pip render the instant
            grading resolves -- `loop.outcome` flips before any network call, not after the
            eight-stage background chain. The hairline under the number marks it provisional
            (neutral quality 70) until the Reviewer's real quality lands and the counter tweens
            to it; that tween is the only "reconciliation" a learner ever sees (spec 5.3). */}
        {loop.outcome && <div role="status" aria-live="polite" data-testid="verdict-banner" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={`flex size-6 shrink-0 items-center justify-center rounded-full ${loop.outcome === 'passed' ? 'bg-emerald-300/20 text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
              {/* Fix round I2: a failed verdict was drawing the pass checkmark too -- only the
                  ring colour changed. A distinct glyph per outcome, not a shared one. */}
              {loop.outcome === 'passed' ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
            </span>
            <span className="text-sm font-medium">{loop.outcome === 'passed' ? 'Passed' : 'Needs work'}</span>
          </div>
          {loop.outcome === 'passed' && <div className="flex items-center gap-4">
            <ChainPips count={loop.chain} motionPref={motionPref} />
            <span className={loop.pointsProvisional ? 'border-b border-dashed border-muted-foreground/50' : undefined}>
              <XpCounter value={loop.pointsEarned} label="points earned" className="font-mono text-sm" motionPref={motionPref} />
            </span>
          </div>}
        </div>}
        <ResultsPanel exercise={exercise} results={loop.results} stdout={loop.stdout} stderr={loop.stderr} status={loop.status} review={loop.review} pointsEarned={loop.pointsEarned} />
        <FixPlanPanel diagnosis={loop.diagnosis} partialDiagnosis={loop.partialDiagnosis} hints={loop.hints} partialHint={loop.partialHint} />
        {/* Step 5: the hint card's skeleton appears on click, the same frame the "hints left"
            pip already decrements in, rather than nothing until the first streamed token. */}
        {loop.hintPending && <div aria-hidden="true" className="animate-pulse space-y-2 border-t border-border pt-4 motion-reduce:animate-none"><div className="h-3 w-24 rounded bg-muted" /><div className="h-3 w-full rounded bg-muted" /><div className="h-3 w-2/3 rounded bg-muted" /></div>}
        {loop.diagnosis && loop.outcome !== 'passed' && <HintButton available={loop.hintAvailable} waitSeconds={loop.hintWaitSeconds} count={loop.hintCount} busy={loop.busy} onRequest={() => void loop.requestHint()} />}
        {/* This section shows the instant `outcome` flips to 'passed' -- it no longer waits for
            the full eight-stage background chain (spec 5.4's "Pass -> next exercise" row).
            Fix round C2: the button is disabled on `!loop.canAdvance`, not `loop.busy` -- a
            background save that fails AFTER `completed.current` was already set (a CLO-close
            Planner outage, say) used to leave the button looking enabled while `next()`'s own
            guard silently no-op'd every click; `canAdvance` mirrors that guard honestly. The
            copy tells the truth about a failed save too, instead of claiming it landed. */}
        {loop.outcome === 'passed' && <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {loop.error
              ? line('error.save', loop.lastRewardAttempt?.id ?? 'save-error')
              : loop.closed
              // T2.7b review, I1: `Clo.outcome` is a full curriculum sentence (up to 25 words),
              // never a skill name -- interpolating it here blew past voice rule 1 (under twelve
              // words). The bundle carries no short CLO title, so this stays the bank's own
              // generic subject rather than fabricate one from a sentence fragment.
              ? lineWith('clo.close', { skill: 'That skill' }, loop.clo?.id ?? exercise.id)
              : loop.nextExercise
              ? `Keep going with a different ${angleWord()}.`
              : loop.busy
              ? `Preparing your next ${repWord()}.`
              : 'Pass saved.'}
          </p>
          <Button onClick={() => void loop.next()} disabled={!loop.canAdvance} className="w-full transition-none active:translate-y-0">{loop.closed ? 'Back to your path' : `Next ${repWord()}`}<ArrowRight aria-hidden="true" /></Button>
        </div>}
      </div>
    </div>
    {/* T2.8's rotating paste explanation and once-only PrintScreen note (pasteWhy/printscreenNote)
        were built and tested but never threaded through this page -- wired here so the "Why?"
        toggle and the note are actually visible, not just logged underneath. `returnFocusRef`
        (fix round 3) is the same ref the editor above populates, so focus comes back to it the
        instant the overlay lifts or the "why" explanation closes, instead of staying lost.
        `fallbackFocusRef` (X6) is the workspace container itself, tried only when a kind never
        populated `returnFocusRef` -- focus never lands on `<body>` for any kind. */}
    <LockdownOverlay reason={lockdown.overlay} onResume={lockdown.resume} pasteMessage={lockdown.pasteMessage} pasteWhy={lockdown.pasteWhy} printscreenNote={lockdown.printscreenNote} returnFocusRef={editorFocusRef} fallbackFocusRef={workspaceRef} />
    <Celebration motionPref={motionPref} onOpenShelf={() => router.push('/account#trophies')} resultsAnchorRef={resultsRef} />
  </div>
}

export default function ExercisePage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useSession()
  if (!profile || profile.account_status === 'restricted' || profile.account_status === 'banned') return <section className="space-y-4 py-10"><h1 className="text-2xl font-medium">Reps are paused</h1><p className="text-sm text-muted-foreground">This account cannot open a rep right now.</p><Link className={buttonVariants({ variant: 'outline' })} href="/dashboard">Back to dashboard</Link></section>
  // Step 4: no `key={id}` -- the same workspace instance (and its mounted Editor) survives an
  // in-place `next()` between exercises; only a genuinely different route unmounts it.
  return <ExerciseWorkspace id={id} />
}
