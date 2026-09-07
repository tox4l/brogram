import type { RunRequest, RunResult, RuntimeAdapter, TestResult } from '@/lib/contracts'
import { publishRuntimeProgress } from './progress'
import { makeTestResult, prepareTimeoutOutput, summarizeResults, testTimeoutOutput, type ExecutionOutput } from './shared'
import { webFrameDocument } from './web-frame'

type Frame = {
  element: HTMLIFrameElement
  nonce: string
  ready: Promise<void>
  error?: string
  deliver?: (output: ExecutionOutput) => void
  dispose(): void
}

type PendingRun = {
  request: RunRequest
  results: TestResult[]
  cancelled: boolean
  finish(result: RunResult): void
  cancelTest?: () => void
}

// One honest timeout line, shared with WorkerAdapter's languages (./shared) -
// a per-test deadline reads as a stopped test the same way in every runtime.
function timeoutOutput(): ExecutionOutput {
  return testTimeoutOutput
}

/** DOM exercises run in an opaque-origin iframe with no access to parent storage. */
export class WebAdapter implements RuntimeAdapter {
  readonly language = 'web' as const
  private active?: Frame
  private standby?: Frame
  private pending?: PendingRun

  private createFrame(): Frame {
    publishRuntimeProgress({ language: 'web', phase: 'loading', packageName: 'DOM sandbox' })
    const element = document.createElement('iframe')
    // `hidden` (display:none) gives the sandbox no layout box at all, so its
    // content document has no real viewport - Chromium collapses a display:none
    // iframe's content viewport, and `@media (max-width: ...)`/`vw`/`vh` then
    // evaluate against that collapsed size instead of a normal screen. A student's
    // exactly-correct CSS (e.g. a max-width media query) reads back the WRONG
    // computed style purely because of how the sandbox is hidden, not their code -
    // confirmed against a live run: `flexDirection` came back `'column'` for a rule
    // that only applies under `max-width: 600px`. Off-screen-but-laid-out (fixed
    // position, real dimensions) keeps the iframe invisible to the user while
    // giving it the same stable desktop-sized viewport `scripts/verify-exercise.mjs`
    // already grades against (jsdom's own default window size), so authoring and
    // live grading agree.
    element.style.position = 'fixed'
    element.style.top = '0'
    element.style.left = '-10000px'
    element.style.width = '1024px'
    element.style.height = '768px'
    element.style.border = '0'
    element.tabIndex = -1
    element.setAttribute('aria-hidden', 'true')
    element.title = 'Web exercise runtime'
    element.setAttribute('sandbox', 'allow-scripts')
    element.referrerPolicy = 'no-referrer'
    const nonce = crypto.randomUUID()
    let resolveReady!: () => void
    let disposed = false
    const ready = new Promise<void>((resolve) => { resolveReady = resolve })
    const frame: Frame = {
      element, nonce, ready,
      // Arrow function: captures the adapter's `this` so a frame that failed at startup can
      // clear itself out of active/standby, instead of leaving a poisoned slot that a later
      // warmup() or run() reuses forever (dispose() is called from many places by name).
      dispose: () => {
        if (disposed) return
        disposed = true
        clearTimeout(startupTimer)
        window.removeEventListener('message', onMessage)
        element.remove()
        resolveReady()
        if (frame.error) {
          if (this.active === frame) this.active = undefined
          if (this.standby === frame) this.standby = undefined
        }
      },
    }
    const onMessage = (event: MessageEvent) => {
      // Opaque sandbox origins are "null"; source plus a fresh nonce is the boundary.
      if (disposed || event.source !== element.contentWindow || !event.data || event.data.nonce !== nonce) return
      const data = event.data
      if (data.type === 'ready') {
        clearTimeout(startupTimer)
        publishRuntimeProgress({ language: 'web', phase: 'ready', packageName: 'DOM sandbox' })
        resolveReady()
      } else if (data.type === 'result' && typeof data.actual === 'string' && typeof data.stdout === 'string' && typeof data.stderr === 'string') {
        if (data.failureKind !== undefined && data.failureKind !== 'runtime-error') return
        frame.deliver?.({ actual: data.actual, stdout: data.stdout, stderr: data.stderr, failureKind: data.failureKind })
      }
    }
    const startupTimer = setTimeout(() => {
      // Same wording WorkerAdapter uses for its own prepare-phase deadline (./shared):
      // the runtime itself never came up, so this must never read as the student's
      // own code timing out.
      frame.error = prepareTimeoutOutput.stderr
      publishRuntimeProgress({ language: 'web', phase: 'error', packageName: 'DOM sandbox', message: frame.error })
      frame.dispose()
    }, 15_000)
    window.addEventListener('message', onMessage)
    element.srcdoc = webFrameDocument(nonce)
    document.body.appendChild(element)
    return frame
  }

  async warmup(): Promise<void> {
    this.active ??= this.createFrame()
    this.standby ??= this.createFrame()
    const active = this.active
    await Promise.all([active.ready, this.standby.ready])
    if (active.error) throw new Error(active.error)
  }

  private promote(): void {
    this.active?.dispose()
    this.active = this.standby
    this.standby = this.createFrame()
  }

  run(request: RunRequest): Promise<RunResult> {
    if (this.pending) this.abort()
    return new Promise<RunResult>((resolve) => {
      const pending: PendingRun = {
        request, results: [], cancelled: false,
        finish: (result) => {
          if (this.pending === pending) this.pending = undefined
          resolve(result)
        },
      }
      this.pending = pending
      void this.execute(pending)
    })
  }

  private async execute(pending: PendingRun): Promise<void> {
    const { request } = pending
    try {
      this.active ??= this.createFrame()
      this.standby ??= this.createFrame()
      const tests = request.tests.length ? request.tests : [null]
      for (const test of tests) {
        const frame = this.active!
        await frame.ready
        if (pending.cancelled) return
        if (frame.error) throw new Error(frame.error)
        const started = performance.now()
        const output = await new Promise<ExecutionOutput>((resolve) => {
          const complete = (result: ExecutionOutput) => {
            clearTimeout(timer)
            frame.deliver = undefined
            pending.cancelTest = undefined
            resolve(result)
          }
          const limit = Number.isFinite(request.timeoutMs) ? Math.max(1, Math.min(5_000, request.timeoutMs)) : 5_000
          const timer = setTimeout(() => complete(timeoutOutput()), limit)
          pending.cancelTest = () => complete(timeoutOutput())
          frame.deliver = complete
          frame.element.contentWindow!.postMessage({
            type: 'run', nonce: frame.nonce, code: request.code,
            fixture: request.fixture ?? '', input: test?.input ?? null,
          }, '*')
        })
        if (pending.cancelled) return
        this.promote()
        if (test) {
          pending.results.push(makeTestResult(test, output, performance.now() - started))
          if (output.failureKind === 'timeout') {
            for (const remaining of request.tests.slice(pending.results.length)) {
              pending.results.push(makeTestResult(remaining, timeoutOutput(), 0))
            }
            break
          }
        } else {
          pending.finish({ ok: !output.failureKind, results: [], passedCount: 0, totalCount: 0, runtime: 'browser', stdout: output.stdout, stderr: output.stderr })
          return
        }
      }
      pending.finish(summarizeResults(pending.results))
    } catch (error) {
      if (pending.cancelled) return
      const stderr = error instanceof Error ? error.message : String(error)
      for (const test of request.tests.slice(pending.results.length)) {
        pending.results.push(makeTestResult(test, { actual: '', stdout: '', stderr, failureKind: 'runtime-error' }, 0))
      }
      pending.finish({ ...summarizeResults(pending.results), ok: false, stderr })
    }
  }

  abort(): void {
    const pending = this.pending
    // Matches WorkerAdapter.abort(): nothing to cancel means nothing to do, rather than
    // tearing down two warm frames a caller may just be about to reuse.
    if (!pending) return
    pending.cancelled = true
    pending.cancelTest?.()
    for (const test of pending.request.tests.slice(pending.results.length)) {
      pending.results.push(makeTestResult(test, timeoutOutput(), 0))
    }
    pending.finish({ ...summarizeResults(pending.results), ok: false, stderr: timeoutOutput().stderr })
    this.promote()
  }
}
