import type { Language } from '@/lib/contracts'

export interface RuntimeProgress {
  language: Language
  phase: 'loading' | 'ready' | 'error'
  packageName: string
  message?: string
}
const listeners = new Set<(event: RuntimeProgress) => void>()

/** Subscribe before warmup/run; package names can be rendered without changing the frozen adapter contract. */
export function subscribeRuntimeProgress(listener: (event: RuntimeProgress) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function publishRuntimeProgress(event: RuntimeProgress): void {
  for (const listener of listeners) {
    try { listener(event) } catch { /* A view subscriber must not break execution. */ }
  }
}
