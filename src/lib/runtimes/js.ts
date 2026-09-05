import { WorkerAdapter, type RuntimeWorker } from './worker-adapter'

export class JsAdapter extends WorkerAdapter {
  constructor(language: 'javascript' | 'typescript' = 'javascript', factory: () => RuntimeWorker = () => new Worker(new URL('./js.worker.ts', import.meta.url))) {
    super(language, factory)
  }
}
