import { WorkerAdapter, type RuntimeWorker } from './worker-adapter'

export class SqlAdapter extends WorkerAdapter {
  constructor(factory: () => RuntimeWorker = () => new Worker(new URL('./sql.worker.ts', import.meta.url))) {
    super('sql', factory)
  }
}
