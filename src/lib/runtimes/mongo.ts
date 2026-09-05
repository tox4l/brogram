import { WorkerAdapter, type RuntimeWorker } from './worker-adapter'

export class MongoAdapter extends WorkerAdapter {
  constructor(factory: () => RuntimeWorker = () => new Worker(new URL('./mongo.worker.ts', import.meta.url))) {
    super('mongo', factory)
  }
}
