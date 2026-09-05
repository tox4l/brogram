import type { RunRequest, RunResult, RuntimeAdapter, TestResult } from '../contracts'
import { publishRuntimeProgress } from './progress'
import { makeTestResult, summarizeResults, type ExecutionOutput } from './shared'
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

function timeoutOutput(): ExecutionOutput {
  return { actual: '', stdout: '', stderr: 'Web execution stopped after the test deadline or was cancelled.', failureKind: 'timeout' }
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
    element.hidden = true
    element.title = 'Web exercise runtime'
    element.setAttribute('sandbox', 'allow-scripts')
    element.referrerPolicy = 'no-referrer'
    const nonce = crypto.randomUUID()
    let resolveReady!: () => void
    let disposed = false
    const ready = new Promise<void>((resolve) => { resolveReady = resolve })
    const frame: Frame = {
      element, nonce, ready,
      dispose() {
        if (disposed) return
        disposed = true
        clearTimeout(startupTimer)
        window.removeEventListener('message', onMessage)
        element.remove()
        resolveReady()
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
      frame.error = 'The web sandbox could not start.'
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
    if (pending) {
      pending.cancelled = true
      pending.cancelTest?.()
      for (const test of pending.request.tests.slice(pending.results.length)) {
        pending.results.push(makeTestResult(test, timeoutOutput(), 0))
      }
      pending.finish({ ...summarizeResults(pending.results), ok: false, stderr: timeoutOutput().stderr })
      this.promote()
    } else {
      this.active?.dispose()
      this.standby?.dispose()
      this.active = this.standby = undefined
    }
  }
}
