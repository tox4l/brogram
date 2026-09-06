import type { Language, RunRequest, RunResult, RuntimeAdapter, TestResult } from '@/lib/contracts'
import { browserTimeout, errorOutput, makeTestResult, summarizeResults, type ExecutionOutput } from './shared'
import { publishRuntimeProgress } from './progress'
import type { WorkerCommand, WorkerReply } from './worker-host'

export interface RuntimeWorker {
  // Match DOM event-handler variance while consuming only these event fields.
  onmessage: { handle(event: { data: WorkerReply }): void }['handle'] | null
  onerror: { handle(event: { message: string }): void }['handle'] | null
  postMessage(command: WorkerCommand): void
  terminate(): void
}
type Pending = { resolve: (output?: ExecutionOutput) => void; reject: (error: Error) => void }
type Slot = { worker: RuntimeWorker; pending: Map<number, Pending>; prepared: Set<string>; preparation?: Promise<void>; dead: boolean }
type Run = { request: RunRequest; results: TestResult[]; resolve: (result: RunResult) => void; done: boolean; timer?: ReturnType<typeof setTimeout> }
const timeoutOutput: ExecutionOutput = { actual: '', stdout: '', stderr: 'Execution timed out or was aborted.', failureKind: 'timeout' }

/** A run is one optional compile followed by one deadline per test. */
export type RunPhase = 'compile' | 'test'

/** Main-thread deadlines surround one test at a time; student execution never runs here. */
export class WorkerAdapter implements RuntimeAdapter {
  private active?: Slot
  private standby?: Slot
  private current?: Run
  private sequence = 0
  private packages = new Set<string>()
  /** Warmup steps already announced; both workers report the same ones. */
  private announced = new Set<string>()
  /** Set when a worker reports itself unusable; its standby takes over before the next run. */
  private unhealthy = false

  constructor(public readonly language: Language, private readonly factory: () => RuntimeWorker) {}

  private spawn(): Slot {
    const slot: Slot = { worker: this.factory(), pending: new Map(), prepared: new Set(), dead: false }
    slot.worker.onmessage = ({ data }) => {
      if (slot.dead) return
      if (data.type === 'progress') {
        // The active worker and its standby warm up together and report the
        // same steps; a student should see each step once.
        if (this.announced.has(data.packageName)) return
        this.announced.add(data.packageName)
        publishRuntimeProgress({ language: this.language, phase: 'loading', packageName: data.packageName })
        return
      }
      const pending = slot.pending.get(data.id)
      if (!pending) return
      slot.pending.delete(data.id)
      if (data.type === 'error') pending.reject(new Error(data.message))
      else pending.resolve(data.type === 'result' ? data.output : undefined)
    }
    slot.worker.onerror = event => this.terminate(slot, new Error(event.message || 'Runtime worker failed to load.'))
    return slot
  }

  private terminate(slot: Slot, error = new Error('Worker terminated')): void {
    slot.dead = true
    slot.worker.terminate()
    for (const pending of slot.pending.values()) pending.reject(error)
    slot.pending.clear()
  }

  /**
   * Wall-clock budget for one phase. `null` means this runtime has no such
   * phase, so no message is sent for it: only a compiled language overrides
   * 'compile', and a compile must be allowed to outlast a single test.
   */
  protected phaseBudgetMs(phase: RunPhase, request: RunRequest): number | null {
    return phase === 'test' ? browserTimeout(request.timeoutMs) : null
  }

  private send(slot: Slot, command: Omit<Extract<WorkerCommand, { type: 'prepare' }>, 'id'> | Omit<Extract<WorkerCommand, { type: 'compile' }>, 'id'> | Omit<Extract<WorkerCommand, { type: 'run' }>, 'id'>): Promise<ExecutionOutput | undefined> {
    if (slot.dead) return Promise.reject(new Error('Runtime worker is unavailable.'))
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      slot.pending.set(id, { resolve, reject })
      try { slot.worker.postMessage({ ...command, id }) } catch (error) { slot.pending.delete(id); reject(error) }
    })
  }

  private prepare(slot: Slot): Promise<void> {
    const names = [...this.packages]
    const key = names.join('\0')
    if (slot.prepared.has(key)) return Promise.resolve()
    if (slot.preparation) return slot.preparation.then(() => this.prepare(slot))
    slot.preparation = this.send(slot, { type: 'prepare', packages: names }).then(() => {
      slot.prepared.add(key)
      publishRuntimeProgress({ language: this.language, phase: 'ready', packageName: names.length ? names.join(', ') : this.language })
    }).finally(() => { slot.preparation = undefined })
    return slot.preparation
  }

  async warmup(): Promise<void> {
    if (!this.active || this.active.dead) this.active = this.spawn()
    if (!this.standby || this.standby.dead) this.standby = this.spawn()
    await Promise.all([this.prepare(this.active), this.prepare(this.standby)])
  }

  private promote(): void {
    if (this.active) this.terminate(this.active)
    this.active = this.standby
    this.standby = undefined
    // Replenishment must not hold the next run when the promoted worker is already ready.
    try {
      this.standby = this.spawn()
      void this.prepare(this.standby).catch(error => publishRuntimeProgress({ language: this.language, phase: 'error', packageName: this.language, message: errorOutput(error).stderr }))
    } catch { /* A later warmup retries worker construction. */ }
  }

  private finish(run: Run, result: RunResult): void {
    if (run.done) return
    run.done = true
    clearTimeout(run.timer)
    if (this.current === run) this.current = undefined
    run.resolve(result)
  }

  abort(): void {
    const run = this.current
    if (!run || run.done) return
    const remaining = run.request.tests.slice(run.results.length).map(t => makeTestResult(t, timeoutOutput, browserTimeout(run.request.timeoutMs)))
    const result = summarizeResults([...run.results, ...remaining])
    if (!run.request.tests.length) Object.assign(result, { ok: false, stdout: '', stderr: timeoutOutput.stderr })
    this.finish(run, result)
    this.promote()
  }

  /**
   * Releases both workers. A later warmup() or run() spawns fresh ones. A
   * runtime this heavy (CheerpJ holds an 18 MB JVM per worker) needs a way to
   * be let go when a page is done with it; nothing else frees a Worker.
   */
  dispose(): void {
    this.abort()
    if (this.active) this.terminate(this.active)
    if (this.standby) this.terminate(this.standby)
    this.active = undefined
    this.standby = undefined
    this.announced.clear()
    this.unhealthy = false
  }

  run(request: RunRequest): Promise<RunResult> {
    this.abort()
    // A worker that reported itself unusable is replaced between runs, not
    // mid-run: the fresh one has to compile before it can answer anything.
    if (this.unhealthy) { this.unhealthy = false; this.promote() }
    if (this.active?.dead && this.standby && !this.standby.dead) this.promote()
    const priorPackages = [...this.packages].join('\0')
    request.packages?.forEach(p => this.packages.add(p))
    const needsBoth = !this.active || this.active.dead || !this.standby || this.standby.dead || [...this.packages].join('\0') !== priorPackages
    return new Promise(resolve => {
      const run: Run = { request, results: [], resolve, done: false }
      this.current = run
      void this.execute(run, needsBoth)
    })
  }

  private async execute(run: Run, needsBoth: boolean): Promise<void> {
    try {
      // Loading a runtime is a network operation: a stalled CDN or a missing
      // asset would otherwise hang run() forever, with no timer armed yet.
      const prepareBudget = this.phaseBudgetMs('compile', run.request) ?? browserTimeout(run.request.timeoutMs)
      run.timer = setTimeout(() => { if (this.current === run) this.abort() }, prepareBudget)
      if (needsBoth) await this.warmup()
      else await this.prepare(this.active!)
      clearTimeout(run.timer)
      if (run.done) return
      const compileBudget = this.phaseBudgetMs('compile', run.request)
      if (compileBudget !== null) {
        run.timer = setTimeout(() => { if (this.current === run) this.abort() }, compileBudget)
        await this.send(this.active!, { type: 'compile', request: run.request })
        clearTimeout(run.timer)
        if (run.done) return
      }
      const testBudget = this.phaseBudgetMs('test', run.request) ?? browserTimeout(run.request.timeoutMs)
      for (const test of run.request.tests.length ? run.request.tests : [undefined]) {
        const start = performance.now()
        run.timer = setTimeout(() => { if (this.current === run) this.abort() }, testBudget)
        const output = await this.send(this.active!, { type: 'run', request: run.request, test })
        clearTimeout(run.timer)
        if (run.done) return
        if (!output) throw new Error('Runtime worker returned no output.')
        if (output.fatal) this.unhealthy = true
        if (test) run.results.push(makeTestResult(test, output, performance.now() - start))
        else {
          this.finish(run, { ...summarizeResults([]), ok: !output.failureKind, stdout: output.stdout, stderr: output.stderr })
          return
        }
      }
      this.finish(run, summarizeResults(run.results))
    } catch (error) {
      if (run.done) return
      const output = errorOutput(error)
      const remaining = run.request.tests.slice(run.results.length).map(t => makeTestResult(t, output, 0))
      this.finish(run, { ...summarizeResults([...run.results, ...remaining]), ok: false, stderr: output.stderr })
      this.promote()
    }
  }
}
