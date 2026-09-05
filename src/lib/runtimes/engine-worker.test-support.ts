import { handleWorkerCommand, type RuntimeEngine, type WorkerCommand, type WorkerReply } from './worker-host'
import type { RuntimeWorker } from './worker-adapter'

/** Real engine and wire handler; replaces only browser Worker transport for offline tests. */
export function createEngineWorker(engine: RuntimeEngine): RuntimeWorker {
  let terminated = false
  let queue = Promise.resolve()
  const worker: RuntimeWorker = {
    onmessage: null,
    onerror: null,
    postMessage(command: WorkerCommand) {
      queue = queue.then(async () => {
        if (terminated) return
        await handleWorkerCommand(engine, command, (data: WorkerReply) => {
          if (!terminated) worker.onmessage?.({ data })
        })
      })
    },
    terminate() { terminated = true },
  }
  return worker
}
