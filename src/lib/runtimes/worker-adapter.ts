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
type Run = { request: RunRequest; results: TestResult[]; resolve: (result: RunResult) => void; done: boolean; timer?: ReturnType<typeof setTimeout>; phase?: RunPhase }
const timeoutOutput: ExecutionOutput = { actual: '', stdout: '', stderr: 'Execution timed out or was aborted.', failureKind: 'timeout' }
// A prepare-phase deadline means the runtime itself never came up (a stalled
// CDN, a missing asset) - the student's code never ran, so "Execution timed
// out" would misattribute the failure to their program.
const prepareTimeoutOutput: ExecutionOutput = { actual: '', stdout: '', stderr: 'The runtime failed to load in time. Try again.', failureKind: 'timeout' }

/** A run is one warmup wait, one optional compile, then one deadline per test. */
export type RunPhase = 'prepare' | 'compile' | 'test'
/**
 * Default ceiling for spawning and preparing a worker with no packages: a
 * cold Worker script fetch plus an interpreter boot on a slow connection.
 * Adapters with heavier warmups (Java's javac bootstrap, Pyodide with
 * scientific packages) override phaseBudgetMs('prepare', ...) instead of
 * relying on this.
 */
export const DEFAULT_PREPARE_BUDGET_MS = 30_000

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
   * 'prepare' bounds the warmup wait every adapter goes through and must
   * never come from the exercise's own timeoutMs - that budget belongs to
   * one graded test, not to downloading and booting the runtime.
   */
  protected phaseBudgetMs(phase: RunPhase, request: RunRequest): number | null {
    switch (phase) {
      case 'prepare': return DEFAULT_PREPARE_BUDGET_MS
      case 'test': return browserTimeout(request.timeoutMs)
      case 'compile': return null
    }
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
    // Spawning at least one fresh slot means this warmup cycle's steps have
    // never been announced yet - even if every step name was already seen by
    // a worker pair from an earlier life of this adapter (both dead and
    // replaced). Without this reset a cold reload publishes no progress at
    // all: every step name is already in `announced`.
    let spawned = false
    if (!this.active || this.active.dead) { this.active = this.spawn(); spawned = true }
    if (!this.standby || this.standby.dead) { this.standby = this.spawn(); spawned = true }
    if (spawned) this.announced.clear()
    await Promise.all([this.prepare(this.active), this.prepare(this.standby)])
  }

  private promote(): void {
    // A worker that already reported itself unusable is being replaced right
    // now; the flag must not also trigger a second promotion on the very
    // next run; that would tear down the freshly promoted, already-warm
    // worker and start over on a cold standby.
    this.unhealthy = false
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

  /**
   * Resolves the in-flight run as timed out, without promoting a standby.
   * Returns false when there was nothing to abort - callers must not
   * promote in that case, or every run() would spawn a spurious promotion
   * from the unconditional abort() at its own start.
   */
  private finishAsTimedOut(): boolean {
    const run = this.current
    if (!run || run.done) return false
    const output = run.phase === 'prepare' ? prepareTimeoutOutput : timeoutOutput
    const remaining = run.request.tests.slice(run.results.length).map(t => makeTestResult(t, output, browserTimeout(run.request.timeoutMs)))
    const result = summarizeResults([...run.results, ...remaining])
    if (!run.request.tests.length) Object.assign(result, { ok: false, stdout: '', stderr: output.stderr })
    this.finish(run, result)
    return true
  }

  abort(): void {
    if (this.finishAsTimedOut()) this.promote()
  }

  /**
   * Releases both workers. A later warmup() or run() spawns fresh ones. A
   * runtime this heavy (CheerpJ holds an 18 MB JVM per worker) needs a way to
   * be let go when a page is done with it; nothing else frees a Worker.
   *
   * This does not go through abort(): abort() calls promote(), which spawns
   * a replacement standby and starts preparing it - dispose() would then
   * immediately terminate that replacement, and its rejected prepare would
   * publish a spurious `phase: 'error'` progress event to every subscriber.
   * Dispose means "stop entirely", so nothing new is spawned here at all.
   */
  dispose(): void {
    this.finishAsTimedOut()
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
    // promote() itself clears `unhealthy`, so a later abort-driven promotion
    // in the same run cannot trigger a second one here.
    if (this.unhealthy) this.promote()
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
      // This budget is the adapter's own (phaseBudgetMs('prepare', ...)),
      // never the exercise's timeoutMs - that 5 s belongs to one graded test,
      // not to downloading and booting the whole runtime.
      run.phase = 'prepare'
      const prepareBudget = this.phaseBudgetMs('prepare', run.request) ?? DEFAULT_PREPARE_BUDGET_MS
      run.timer = setTimeout(() => { if (this.current === run) this.abort() }, prepareBudget)
      if (needsBoth) await this.warmup()
      else await this.prepare(this.active!)
      clearTimeout(run.timer)
      if (run.done) return
      run.phase = 'compile'
      const compileBudget = this.phaseBudgetMs('compile', run.request)
      if (compileBudget !== null) {
        run.timer = setTimeout(() => { if (this.current === run) this.abort() }, compileBudget)
        await this.send(this.active!, { type: 'compile', request: run.request })
        clearTimeout(run.timer)
        if (run.done) return
      }
      run.phase = 'test'
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
