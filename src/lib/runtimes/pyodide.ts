import { WorkerAdapter, type RuntimeWorker } from './worker-adapter'

export class PyodideAdapter extends WorkerAdapter {
  constructor(factory: () => RuntimeWorker = () => new Worker(new URL('./pyodide.worker.ts', import.meta.url))) {
    super('python', factory)
  }
}
