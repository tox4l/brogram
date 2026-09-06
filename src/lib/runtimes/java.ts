import type { RunRequest } from '@/lib/contracts'
import { WorkerAdapter, type RunPhase, type RuntimeWorker } from './worker-adapter'

/**
 * javac needs far more than one test's worth of wall clock: the CheerpJ spike
 * measured 3-7 s for a cold compile and ~1.5 s warm, against a 5 s per-test
 * budget. The compile gets its own deadline; every test still gets 5 s.
 */
export const JAVA_COMPILE_BUDGET_MS = 20_000

export class JavaAdapter extends WorkerAdapter {
  constructor(factory: () => RuntimeWorker = () => new Worker(new URL('./java.worker.ts', import.meta.url))) {
    super('java', factory)
  }

  protected override phaseBudgetMs(phase: RunPhase, request: RunRequest): number | null {
    return phase === 'compile' ? JAVA_COMPILE_BUDGET_MS : super.phaseBudgetMs(phase, request)
  }
}
