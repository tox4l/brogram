import type { RunRequest } from '@/lib/contracts'
import { WorkerAdapter, type RunPhase, type RuntimeWorker } from './worker-adapter'

/**
 * A live course (DSAI2201) loads numpy, pandas, matplotlib and scikit-learn at
 * warmup, tens of megabytes of wheels on top of the Pyodide runtime itself.
 * The default prepare budget (30 s, sized for a plain interpreter boot) fails
 * that cold, and a Run clicked while the mount-time warmup is still in flight
 * shares this same wait. 90 s covers a cold fetch-and-compile of all four
 * packages; a warm cache resolves in a fraction of that.
 */
export const PYODIDE_PREPARE_BUDGET_MS = 90_000

export class PyodideAdapter extends WorkerAdapter {
  constructor(factory: () => RuntimeWorker = () => new Worker(new URL('./pyodide.worker.ts', import.meta.url))) {
    super('python', factory)
  }

  protected override phaseBudgetMs(phase: RunPhase, request: RunRequest): number | null {
    return phase === 'prepare' ? PYODIDE_PREPARE_BUDGET_MS : super.phaseBudgetMs(phase, request)
  }
}
