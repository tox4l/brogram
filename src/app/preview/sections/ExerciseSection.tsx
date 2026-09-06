'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Editor } from '@/components/exercise/Editor'
import { SchemaEditor } from '@/components/exercise/SchemaEditor'
import { PromptPanel } from '@/components/exercise/PromptPanel'
import { ResultsPanel } from '@/components/exercise/ResultsPanel'
import { FixPlanPanel } from '@/components/exercise/FixPlanPanel'
import { HintButton } from '@/components/exercise/HintButton'
import { LockdownOverlay } from '@/components/exercise/LockdownOverlay'
import type { LockdownReason } from '@/hooks/useLockdown'
import { PredictOutput } from '@/components/exercise/PredictOutput'
import { SpotTheBug } from '@/components/exercise/SpotTheBug'
import { Trace } from '@/components/exercise/Trace'
import {
  fixtureClo, fixtureCodeExercise, fixtureDiagnosis, fixtureHintCooldown, fixtureHintReady, fixtureHints,
  fixturePredictExercise, fixtureResults, fixtureSchemaExercise, fixtureSpotBugExercise, fixtureTraceExercise,
  fixtureTraceVariables, fixtureWrongAttempt,
} from '../fixtures'
import { Section } from './Section'

const noop = () => {}

function LockdownDemo() {
  const [reason, setReason] = useState<LockdownReason | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function show(next: LockdownReason) {
    if (timer.current) clearTimeout(timer.current)
    setReason(next)
    timer.current = setTimeout(() => setReason(null), 2000)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => show('blur')}>Show blur overlay (2s)</Button>
      <Button variant="outline" onClick={() => show('idle')}>Show idle overlay (2s)</Button>
      <LockdownOverlay reason={reason} onResume={() => setReason(null)} />
    </div>
  )
}

export function ExerciseSection() {
  const [code, setCode] = useState(fixtureWrongAttempt)
  const [predictValue, setPredictValue] = useState('')
  const [spotBugValue, setSpotBugValue] = useState('[]')
  const [traceValue, setTraceValue] = useState('{}')
  const [schemaValue, setSchemaValue] = useState(fixtureSchemaExercise.starterCode)

  return (
    <Section id="exercise" title="Exercise screen" caption="The real three-column layout with fixture exercise, attempt, results and diagnosis. The buttons below toggle the real LockdownOverlay's blur and idle states.">
      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-border px-5 pt-4">
        <h3 className="text-base font-medium">{fixtureCodeExercise.title}</h3>
        <p className="font-mono text-xs text-muted-foreground">{fixtureCodeExercise.language} · Difficulty {fixtureCodeExercise.difficulty}/5</p>
      </div>
      <div className="grid min-w-0 gap-6 rounded-xl border border-border p-5 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(22rem,1.7fr)_minmax(14rem,0.9fr)]">
        <div className="min-w-0"><PromptPanel exercise={fixtureCodeExercise} clo={fixtureClo} /></div>
        <section aria-label="Your work" className="min-w-0 self-start overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><h3 className="text-sm font-medium">Your code</h3><span className="text-xs text-muted-foreground">Fixture attempt (wrong)</span></div>
          <Editor value={code} onChange={setCode} language="python" logIntegrity={noop} />
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-3">
            <Button variant="outline" className="transition-none">Run</Button>
            <Button className="bg-emerald-300 text-primary-foreground transition-none hover:bg-emerald-200">Submit</Button>
          </div>
        </section>
        <div className="min-w-0 space-y-5">
          <ResultsPanel exercise={fixtureCodeExercise} results={fixtureResults} stdout="" stderr="" status="failed" />
          <FixPlanPanel diagnosis={fixtureDiagnosis} partialDiagnosis={null} hints={fixtureHints} partialHint={null} />
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">Hint button, cooldown state</p>
            <HintButton {...fixtureHintCooldown} busy={false} onRequest={noop} />
            <p className="text-xs text-muted-foreground">Hint button, ready state</p>
            <HintButton {...fixtureHintReady} busy={false} onRequest={noop} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Lockdown overlay</p>
        <LockdownDemo />
      </div>

      <div className="space-y-4">
        <p className="text-sm font-medium">Non-code exercise kinds</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">Predict output — {fixturePredictExercise.title}</div>
            <PredictOutput snippet={fixturePredictExercise.starterCode} value={predictValue} onChange={setPredictValue} />
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">Spot the bug — {fixtureSpotBugExercise.title}</div>
            <SpotTheBug snippet={fixtureSpotBugExercise.starterCode} value={spotBugValue} onChange={setSpotBugValue} />
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">Trace — {fixtureTraceExercise.title}</div>
            <Trace snippet={fixtureTraceExercise.starterCode} variables={fixtureTraceVariables} value={traceValue} onChange={setTraceValue} />
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">Schema — {fixtureSchemaExercise.title}</div>
            <SchemaEditor value={schemaValue} onChange={setSchemaValue} logIntegrity={noop} />
          </div>
        </div>
      </div>
    </Section>
  )
}
