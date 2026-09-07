'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LessonPublicBlock, RunResult } from '@/lib/contracts'
import { getRuntime, subscribeRuntimeProgress, type RuntimeProgress } from '@/lib/runtimes'
import { play } from '@/lib/sound/manager'
import { CodeGuide, type GuideSpan } from './CodeGuide'
import { DynamicEditor } from './DynamicEditor'

type SnippetBlockData = Extract<LessonPublicBlock, { type: 'snippet' }>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'This snippet could not run.'
}

/** Ruling W4.21: `LessonSnippet.highlight` (1-indexed inclusive `[start,
 *  end]` pairs) becomes `CodeGuide`'s `passive` prop -- a static tint, never
 *  a stepped `active` band. Only meaningful for the static `<pre>` render
 *  below; a runnable snippet's code is edited live in `DynamicEditor`
 *  (CodeMirror), where a highlight authored against the ORIGINAL code would
 *  drift out of position the moment a learner types. */
function passiveSpans(highlight: [number, number][] | undefined): GuideSpan[] | undefined {
  return highlight?.map(([start, end]): GuideSpan => ({ line: start === end ? start : [start, end] }))
}

/**
 * Step 3 (R3.4): a runnable snippet calls the exact free-run path the
 * exercise Run button already uses -- `getRuntime(language).run({ ...,
 * tests: [] })` -- nothing is graded here, ever. Java snippets are always
 * `runnable: false` at the content layer (the validator rejects otherwise),
 * so the honest one-liner below only ever shows next to static code.
 */
export function SnippetBlock({ block, packages, reduced }: { block: SnippetBlockData; packages: string[]; reduced: boolean }) {
  const [code, setCode] = useState(block.code)
  const [stdout, setStdout] = useState('')
  const [stderr, setStderr] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RuntimeProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // M8: gated on `!runnable`, not on language alone -- if a Java snippet ever
  // ships `runnable: true` (the CheerpJ adapter is live per C1), a learner
  // must never see both a working Run button and "read-only for now" at once.
  const isJavaStatic = block.language === 'java' && !block.runnable
  // Fix round 1 (M6): wires CodeGuide's `idPrefix` to something -- the
  // caption points back at the code region it describes via aria-describedby.
  const idPrefix = `snippet-${block.id}`

  async function run() {
    setRunning(true)
    setError(null)
    setProgress(null)
    const unsubscribe = subscribeRuntimeProgress((event) => {
      if (event.language === block.language) setProgress(event)
    })
    try {
      // Wave 1 gate fix (C1): the course's Pyodide packages (numpy, pandas, ...
      // for DSAI2201) only mean anything to the Python runtime -- passing them
      // to any other language's adapter is meaningless at best. A snippet may
      // still name its own extra `packages` (the field is "usually omitted"
      // but not removed) -- union rather than replace, so an author's
      // explicit choice is never silently dropped.
      const result: RunResult = await getRuntime(block.language).run({
        language: block.language,
        code,
        tests: [],
        timeoutMs: 5000,
        packages: block.language === 'python' ? [...new Set([...packages, ...(block.packages ?? [])])] : undefined,
      })
      setStdout(result.stdout ?? '')
      setStderr(result.stderr ?? '')
      play('run.go')
    } catch (runError) {
      setError(messageOf(runError))
    } finally {
      unsubscribe()
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <section aria-label="Code example" className="overflow-hidden rounded-xl border border-border">
      {block.runnable
        ? <DynamicEditor value={code} onChange={setCode} language={block.language} logIntegrity={() => {}} label="Example code" />
        : (
          <CodeGuide
            code={code}
            language={block.language}
            active={null}
            passive={passiveSpans(block.highlight)}
            reduced={reduced}
            label="Code"
            idPrefix={idPrefix}
          />
        )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
        {block.caption && <p className="text-micro text-muted-foreground" aria-describedby={block.runnable ? undefined : idPrefix}>{block.caption}</p>}
        {block.runnable && (
          <Button type="button" variant="outline" size="sm" onClick={() => void run()} disabled={running}>
            <Play aria-hidden="true" />{running ? 'Running…' : 'Run'}
          </Button>
        )}
      </div>
      {isJavaStatic && <p role="note" className="border-t border-border px-3 py-2 text-micro text-muted-foreground">This one&apos;s read-only for now — Java runs land soon.</p>}
      {running && progress?.phase === 'loading' && (
        <p role="status" className="border-t border-border px-3 py-2 text-micro text-muted-foreground">Loading {progress.packageName}…</p>
      )}
      {error && <p role="alert" className="border-t border-border px-3 py-2 text-small text-destructive">{error}</p>}
      {(stdout || stderr) && (
        <div className="space-y-2 border-t border-border p-3">
          {stdout && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-code">{stdout}</pre>}
          {stderr && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-destructive/40 p-2 font-mono text-code">{stderr}</pre>}
        </div>
      )}
    </section>
  )
}
