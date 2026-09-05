import type { RunRequest, TestCase } from '@/lib/contracts'
import { errorOutput, type ExecutionOutput } from './shared'

export interface RuntimeEngine {
  warmup(packages: string[], progress: (packageName: string) => void): Promise<void>
  execute(request: RunRequest, test?: TestCase): Promise<ExecutionOutput>
}
export type WorkerCommand =
  | { type: 'prepare'; id: number; packages: string[] }
  | { type: 'run'; id: number; request: RunRequest; test?: TestCase }
export type WorkerReply =
  | { type: 'ready'; id: number }
  | { type: 'progress'; packageName: string }
  | { type: 'result'; id: number; output: ExecutionOutput }
  | { type: 'error'; id: number; message: string }

/** Also used by offline engine tests; only the transport is replaced there. */
export async function handleWorkerCommand(engine: RuntimeEngine, command: WorkerCommand, send: (reply: WorkerReply) => void): Promise<void> {
  try {
    if (command.type === 'prepare') {
      await engine.warmup(command.packages, packageName => send({ type: 'progress', packageName }))
      send({ type: 'ready', id: command.id })
    } else {
      let output: ExecutionOutput
      try { output = await engine.execute(command.request, command.test) } catch (error) { output = errorOutput(error) }
      send({ type: 'result', id: command.id, output })
    }
  } catch (error) {
    send({ type: 'error', id: command.id, message: errorOutput(error).stderr })
  }
}
export function installWorkerHost(engine: RuntimeEngine): void {
  const scope = globalThis as unknown as {
    onmessage: ((event: { data: WorkerCommand }) => void) | null
    postMessage(message: WorkerReply): void
  }
  // Serialize preparations and execution even if a caller queues messages quickly.
  let queue = Promise.resolve()
  scope.onmessage = event => { queue = queue.then(() => handleWorkerCommand(engine, event.data, reply => scope.postMessage(reply))) }
}
