'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { LessonPublicBlock, RunResult, TestResult } from '@/lib/contracts'
import { gradeCheck, type CheckAnswer, type CheckVerdict } from '@/lib/lesson/grade'
import { getRuntime, subscribeRuntimeProgress, type RuntimeProgress } from '@/lib/runtimes'
import { play } from '@/lib/sound/manager'
import { DynamicEditor } from './DynamicEditor'

type CheckBlockData = Extract<LessonPublicBlock, { type: 'check' }>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not run your code.'
}

/** Every code line is a focusable control whose accessible name is the line
 *  number and its text (spec 10.5 accessibility item a). Roving tabindex:
 *  arrow keys move the single tab stop, Enter/Space toggles the focused
 *  line -- a mouse is never required. */
function SpotTheBugLines({ code, selected, onToggle, disabled }: {
  code: string
  selected: number[]
  onToggle: (line: number) => void
  disabled: boolean
}) {
  const lines = code.split('\n')
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [focusIndex, setFocusIndex] = useState(0)

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = Math.min(index + 1, lines.length - 1)
      setFocusIndex(next)
      refs.current[next]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = Math.max(index - 1, 0)
      setFocusIndex(prev)
      refs.current[prev]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(index + 1)
    }
  }

  return (
    <div role="group" aria-label="Select every line with a bug" className="overflow-x-auto rounded-lg border border-border py-1">
      {lines.map((line, index) => {
        const lineNumber = index + 1
        const checked = selected.includes(lineNumber)
        return (
          <button
            key={index}
            ref={(el) => { refs.current[index] = el }}
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={`Line ${lineNumber}: ${line.trim() || 'blank line'}`}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={disabled}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onToggle(lineNumber)}
            className={`flex w-full items-baseline gap-3 px-3 py-1 text-left font-mono text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 ${checked ? 'bg-primary/10 text-primary' : ''}`}
          >
            <span aria-hidden="true" className="w-6 shrink-0 text-right text-xs text-muted-foreground">{lineNumber}</span>
            <code className="whitespace-pre">{line || ' '}</code>
          </button>
        )
      })}
    </div>
  )
}

function FillBlankTemplate({ template, values, onChange, disabled }: {
  template: string
  values: Record<string, string>
  onChange: (id: string, value: string) => void
  disabled: boolean
}) {
  const parts = template.split(/__(\d+)__/g)
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm">
      {parts.map((part, index) => (
        index % 2 === 1
          ? <Input key={index} aria-label={`Blank ${part}`} value={values[part] ?? ''} disabled={disabled} className="inline-flex w-28 font-mono" onChange={(event) => onChange(part, event.target.value)} />
          : <span key={index} className="whitespace-pre">{part}</span>
      ))}
    </p>
  )
}

/**
 * Step 4/5/6/7: every check kind, graded in place, unlimited attempts, a
 * verdict that never relies on colour alone, and the reveal that follows it
 * in DOM order. `reduced` gates only the shake -- the verdict text itself
 * never changes with motion preference.
 */
export function CheckBlock({ block, reduced, onAnswered }: {
  block: CheckBlockData
  reduced: boolean
  onAnswered: (right: boolean) => void
}) {
  const [attempts, setAttempts] = useState(0)
  const [verdict, setVerdict] = useState<CheckVerdict | null>(null)
  const [predictText, setPredictText] = useState('')
  const [chosenIndex, setChosenIndex] = useState<number | null>(null)
  const [bugLines, setBugLines] = useState<number[]>([])
  const [blankValues, setBlankValues] = useState<Record<string, string>>({})
  const [code, setCode] = useState(block.kind === 'micro-code' ? block.starterCode : '')
  const [results, setResults] = useState<TestResult[]>([])
  const [running, setRunning] = useState(false)
  const [runtimeProgress, setRuntimeProgress] = useState<RuntimeProgress | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)

  const locked = verdict?.right === true

  function grade(answer: CheckAnswer) {
    const attemptNumber = attempts + 1
    setAttempts(attemptNumber)
    const result = gradeCheck(block, answer, attemptNumber)
    setVerdict(result)
    play(result.right ? 'drill.hit' : 'drill.miss')
    if (!result.right && !reduced) {
      setShaking(true)
      window.setTimeout(() => setShaking(false), 150)
    } else {
      setShaking(false)
    }
    onAnswered(result.right)
  }

  async function runMicroCode() {
    if (block.kind !== 'micro-code' || locked || running) return
    setRunning(true)
    setRunError(null)
    const unsubscribe = subscribeRuntimeProgress((event) => {
      if (event.language === block.language) setRuntimeProgress(event)
    })
    try {
      const result: RunResult = await getRuntime(block.language).run({
        language: block.language,
        code,
        tests: block.tests,
        timeoutMs: 5000,
      })
      setResults(result.results)
      grade({ kind: 'micro-code', results: result.results })
    } catch (error) {
      setRunError(messageOf(error))
    } finally {
      unsubscribe()
      setRunning(false)
      setRuntimeProgress(null)
    }
  }

  return (
    <section aria-label="Check" className="space-y-4 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">{block.prompt}</p>

      {block.kind === 'predict-output' && (
        <div className="space-y-3">
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-6"><code>{block.code}</code></pre>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">What does this print?</span>
            <textarea
              value={predictText}
              onChange={(event) => setPredictText(event.target.value)}
              disabled={locked}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              rows={3}
              className="w-full resize-y rounded-lg border border-input bg-background p-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
          </label>
          {!locked && <Button type="button" size="sm" onClick={() => grade({ kind: 'predict-output', text: predictText })}>Check answer</Button>}
        </div>
      )}

      {block.kind === 'choose' && (
        <div className="space-y-2" role="radiogroup" aria-label={block.prompt}>
          {block.options.map((option, index) => {
            const picked = chosenIndex === index
            return (
              <div key={index}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={locked}
                  onClick={() => { setChosenIndex(index); grade({ kind: 'choose', index }) }}
                  className={`w-full rounded-lg border p-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${picked ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
                >
                  {option}
                </button>
                {picked && verdict?.why && <p className="mt-1.5 px-1 text-xs text-muted-foreground">{verdict.why}</p>}
              </div>
            )
          })}
        </div>
      )}

      {block.kind === 'spot-the-bug' && (
        <div className="space-y-3">
          <SpotTheBugLines
            code={block.code}
            selected={bugLines}
            disabled={locked}
            onToggle={(line) => setBugLines((current) => current.includes(line) ? current.filter((item) => item !== line) : [...current, line].sort((a, b) => a - b))}
          />
          {!locked && <Button type="button" size="sm" disabled={bugLines.length === 0} onClick={() => grade({ kind: 'spot-the-bug', lines: bugLines })}>Check answer</Button>}
        </div>
      )}

      {block.kind === 'fill-blank' && (
        <div className="space-y-3">
          <FillBlankTemplate
            template={block.template}
            values={blankValues}
            disabled={locked}
            onChange={(id, value) => setBlankValues((current) => ({ ...current, [id]: value }))}
          />
          {!locked && <Button type="button" size="sm" onClick={() => grade({ kind: 'fill-blank', values: blankValues })}>Check answer</Button>}
        </div>
      )}

      {block.kind === 'micro-code' && (
        <div className="overflow-hidden rounded-lg border border-border">
          <DynamicEditor value={code} onChange={setCode} language={block.language} logIntegrity={() => {}} disabled={locked} label="Your code" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
            <p className="text-xs text-muted-foreground">{block.tests.length} visible {block.tests.length === 1 ? 'test' : 'tests'}</p>
            {!locked && <Button type="button" size="sm" onClick={() => void runMicroCode()} disabled={running}>{running ? 'Running…' : 'Run tests'}</Button>}
          </div>
          {running && runtimeProgress?.phase === 'loading' && (
            <p role="status" className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Loading {runtimeProgress.packageName}…</p>
          )}
          {runError && <p role="alert" className="border-t border-border px-3 py-2 text-xs text-destructive">{runError}</p>}
          {results.length > 0 && (
            <ul className="divide-y divide-border border-t border-border text-xs">
              {block.tests.map((test, index) => {
                const result = results.find((item) => item.testId === test.id)
                return (
                  <li key={test.id} className="flex items-center justify-between gap-3 p-3">
                    <span>{test.name ?? `Test ${index + 1}`}</span>
                    <span className={result?.passed ? 'text-success' : 'text-warning'}>{result?.passed ? 'Passed' : 'Needs work'}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div aria-live="polite">
        {verdict && (
          <p className={`flex items-center gap-2 text-sm font-medium ${verdict.right ? 'text-success' : 'text-warning'} ${shaking ? 'lesson-shake' : ''}`}>
            {verdict.right ? <Check aria-hidden="true" className="size-4" /> : <X aria-hidden="true" className="size-4" />}
            {verdict.right ? 'Right' : 'Not yet'}
          </p>
        )}
      </div>
      {verdict?.reveal === 'hint' && <p className="text-sm text-muted-foreground">{block.hint}</p>}
      {verdict?.reveal === 'explain' && <p className="text-sm text-muted-foreground">{block.explain}</p>}
    </section>
  )
}
