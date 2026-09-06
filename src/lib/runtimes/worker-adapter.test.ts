import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREPARE_BUDGET_MS, WorkerAdapter, type RuntimeWorker } from './worker-adapter'
import type { WorkerCommand, WorkerReply } from './worker-host'
import type { RunRequest } from '@/lib/contracts'
import { subscribeRuntimeProgress } from './progress'

class ControlledWorker implements RuntimeWorker {
  onmessage: ((event: { data: WorkerReply }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  commands: WorkerCommand[] = []
  terminated = false
  hang = false
  prepare = true
  /** Delays a successful 'prepare' reply; 0 keeps the original instant-microtask behaviour. */
  prepareDelayMs = 0
  postMessage(command: WorkerCommand) {
    this.commands.push(command)
    const respond = () => {
      if (this.terminated) return
      if (command.type === 'prepare' && this.prepare) {
        this.onmessage?.({ data: { type: 'progress', packageName: 'python' } })
        this.onmessage?.({ data: { type: 'ready', id: command.id } })
      } else if (command.type === 'run' && !this.hang) {
        this.onmessage?.({ data: { type: 'result', id: command.id, output: { actual: '1', stdout: '', stderr: '' } } })
      }
    }
    if (command.type === 'prepare' && this.prepareDelayMs > 0) setTimeout(respond, this.prepareDelayMs)
    else queueMicrotask(respond)
  }
  terminate() { this.terminated = true }
}
const request: RunRequest = { language: 'python', code: '', timeoutMs: 5000, tests: [
  { id: 'one', input: '[]', expected: '1', hidden: false },
  { id: 'two', input: '[]', expected: '1', hidden: true },
] }

afterEach(() => vi.useRealTimers())
describe('worker runtime lifecycle', () => {
  it('recovers an idle active worker failure using the ready standby', async () => {
    const workers: ControlledWorker[] = []
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    workers[0].onerror?.({ message: 'Worker crashed' })
    expect((await adapter.run(request)).ok).toBe(true)
    expect(workers[1].commands.some(c => c.type === 'run')).toBe(true)
  })

  it('cuts the test at five seconds and runs immediately on its prepared standby', async () => {
    vi.useFakeTimers()
    const workers: ControlledWorker[] = []
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    workers[0].hang = true
    const run = adapter.run({ ...request, timeoutMs: 9000 })
    await vi.advanceTimersByTimeAsync(4999)
    expect(workers[0].terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await run).results.map(r => r.failureKind)).toEqual(['timeout', 'timeout'])
    expect(workers[0].terminated).toBe(true)
    const next = adapter.run(request)
    await vi.advanceTimersByTimeAsync(0)
    expect((await next).passedCount).toBe(2)
    expect(workers[1].commands.some(c => c.type === 'run')).toBe(true)
  })

  it('preserves completed results when aborting a later test', async () => {
    const workers: ControlledWorker[] = []
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    const original = workers[0].postMessage.bind(workers[0])
    workers[0].postMessage = command => { if (command.type === 'run' && command.test?.id === 'two') workers[0].hang = true; original(command) }
    const pending = adapter.run(request)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    adapter.abort()
    expect((await pending).results.map(r => r.failureKind ?? 'passed')).toEqual(['passed', 'timeout'])
  })

  it('cuts a warmup that never finishes at the prepare budget, not the 5s per-test budget, and reports it as a load failure', async () => {
    vi.useFakeTimers()
    const workers: ControlledWorker[] = []
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); w.prepare = false; workers.push(w); return w })
    const run = adapter.run(request)
    await vi.advanceTimersByTimeAsync(DEFAULT_PREPARE_BUDGET_MS - 1)
    expect(workers[0].terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const result = await run
    expect(result.results.map(r => r.failureKind)).toEqual(['timeout', 'timeout'])
    // The message must not say "Execution timed out": the student's code never ran.
    expect(result.results[0].stderr).toMatch(/failed to load/i)
    expect(workers[0].terminated).toBe(true)
  })

  it('does not fail the run when a slow warmup still finishes inside the prepare budget', async () => {
    vi.useFakeTimers()
    const workers: ControlledWorker[] = []
    const delay = DEFAULT_PREPARE_BUDGET_MS - 1000
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); w.prepareDelayMs = delay; workers.push(w); return w })
    const run = adapter.run(request)
    await vi.advanceTimersByTimeAsync(delay)
    const result = await run
    expect(result.ok).toBe(true)
    expect(workers.every(w => !w.terminated)).toBe(true)
  })

  it('releases both workers on dispose and spawns fresh ones on the next run', async () => {
    const workers: ControlledWorker[] = []
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    expect(workers).toHaveLength(2)
    adapter.dispose()
    expect(workers.every(w => w.terminated)).toBe(true)
    expect((await adapter.run(request)).ok).toBe(true)
    expect(workers.length).toBeGreaterThan(2)
    expect(workers.slice(2).some(w => w.commands.some(c => c.type === 'run'))).toBe(true)
  })

  it('announces each warmup step once even though both workers report it', async () => {
    const events: string[] = []
    const unsubscribe = subscribeRuntimeProgress(e => { if (e.phase === 'loading') events.push(e.packageName) })
    const adapter = new WorkerAdapter('python', () => new ControlledWorker())
    await adapter.warmup()
    expect(events).toEqual(['python'])
    unsubscribe()
  })

  it('settles abort during package preparation and emits package names', async () => {
    const workers: ControlledWorker[] = []
    const events: string[] = []
    const unsubscribe = subscribeRuntimeProgress(e => events.push(e.packageName))
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    workers.forEach(w => { w.prepare = false })
    const pending = adapter.run({ ...request, packages: ['pandas'] })
    await Promise.resolve()
    adapter.abort()
    expect((await pending).results.every(r => r.failureKind === 'timeout')).toBe(true)
    expect(events).toContain('python')
    unsubscribe()
  })

  it('preloads requested packages on both workers before executing and reuses that standby', async () => {
    vi.useFakeTimers()
    const workers: ControlledWorker[] = []
    const adapter = new WorkerAdapter('python', () => {
      const w = new ControlledWorker()
      if (workers.length >= 2) w.prepare = false
      workers.push(w)
      return w
    })
    const first = adapter.run({ ...request, packages: ['numpy', 'pandas'] })
    await vi.advanceTimersByTimeAsync(0)
    expect((await first).ok).toBe(true)
    for (const worker of workers) {
      expect(worker.commands.find(c => c.type === 'prepare')).toMatchObject({ packages: ['numpy', 'pandas'] })
    }
    workers[0].hang = true
    const timedOut = adapter.run({ ...request, packages: ['numpy', 'pandas'], timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(100)
    expect((await timedOut).ok).toBe(false)
    // Simulate a slow replacement download: promotion must still run immediately.
    const next = adapter.run({ ...request, packages: ['numpy', 'pandas'] })
    await vi.advanceTimersByTimeAsync(0)
    expect((await next).passedCount).toBe(2)
  })

  it('does not double-promote: an abort-driven promotion after a fatal result is not repeated on the next run', async () => {
    vi.useFakeTimers()
    const workers: ControlledWorker[] = []
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    const original = workers[0].postMessage.bind(workers[0])
    workers[0].postMessage = command => {
      if (command.type === 'run' && command.test?.id === 'one') {
        workers[0].commands.push(command)
        queueMicrotask(() => workers[0].onmessage?.({ data: { type: 'result', id: command.id, output: { actual: '1', stdout: '', stderr: '', fatal: true } } }))
        return
      }
      if (command.type === 'run' && command.test?.id === 'two') workers[0].hang = true
      original(command)
    }
    const run = adapter.run(request)
    await vi.advanceTimersByTimeAsync(5000)
    await run
    // The fatal result promoted the standby; the freshly-promoted worker must
    // survive, and nothing beyond the one replenished standby is spawned.
    expect(workers).toHaveLength(3)
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].terminated).toBe(false)

    const next = adapter.run(request)
    await vi.advanceTimersByTimeAsync(0)
    expect((await next).passedCount).toBe(2)
    // A leftover `unhealthy` flag would promote a second time here, tearing
    // down the worker that was just promoted and spawning a fourth.
    expect(workers).toHaveLength(3)
    expect(workers[1].terminated).toBe(false)
  })

  it('re-announces warmup steps after both workers are lost and replaced by a fresh pair', async () => {
    const workers: ControlledWorker[] = []
    const events: string[] = []
    const unsubscribe = subscribeRuntimeProgress(e => { if (e.phase === 'loading') events.push(e.packageName) })
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    expect(events).toEqual(['python'])
    workers[0].onerror?.({ message: 'gone' })
    workers[1].onerror?.({ message: 'gone' })
    expect((await adapter.run(request)).ok).toBe(true)
    // A cold reload (both workers gone) must publish progress again, not stay
    // silent because every step name was already seen in this adapter's
    // earlier life.
    expect(events).toEqual(['python', 'python'])
    unsubscribe()
  })

  it('does not publish a spurious runtime-progress error when dispose() cuts off an in-flight run', async () => {
    const workers: ControlledWorker[] = []
    const phases: string[] = []
    const unsubscribe = subscribeRuntimeProgress(e => phases.push(e.phase))
    const adapter = new WorkerAdapter('python', () => { const w = new ControlledWorker(); workers.push(w); return w })
    await adapter.warmup()
    workers[0].hang = true
    const pending = adapter.run(request)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    adapter.dispose()
    await pending
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(phases).not.toContain('error')
    unsubscribe()
  })
})
