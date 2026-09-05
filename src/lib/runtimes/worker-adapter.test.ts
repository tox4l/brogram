import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerAdapter, type RuntimeWorker } from './worker-adapter'
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
  postMessage(command: WorkerCommand) {
    this.commands.push(command)
    queueMicrotask(() => {
      if (this.terminated) return
      if (command.type === 'prepare' && this.prepare) {
        this.onmessage?.({ data: { type: 'progress', packageName: 'python' } })
        this.onmessage?.({ data: { type: 'ready', id: command.id } })
      } else if (command.type === 'run' && !this.hang) {
        this.onmessage?.({ data: { type: 'result', id: command.id, output: { actual: '1', stdout: '', stderr: '' } } })
      }
    })
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
})
