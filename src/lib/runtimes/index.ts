import type { Language, RuntimeAdapter } from '@/lib/contracts'
import { PyodideAdapter } from './pyodide'
import { JsAdapter } from './js'
import { WebAdapter } from './web'
import { SqlAdapter } from './sql'
import { MongoAdapter } from './mongo'
import { JudgeAdapter, browserJavaEnabled } from './judge'
import { JavaAdapter } from './java'

export { subscribeRuntimeProgress, type RuntimeProgress } from './progress'
export { judgeProviderAbsent } from './judge'
const runtimes = new Map<Language, RuntimeAdapter>()

/** Lazy, stable adapters: importing this module does not download WASM or start a worker. */
export function getRuntime(language: Language): RuntimeAdapter {
  const existing = runtimes.get(language)
  if (existing) return existing
  let adapter: RuntimeAdapter
  switch (language) {
    case 'python': adapter = new PyodideAdapter(); break
    case 'javascript': case 'typescript': adapter = new JsAdapter(language); break
    case 'web': adapter = new WebAdapter(); break
    case 'sql': adapter = new SqlAdapter(); break
    case 'mongo': adapter = new MongoAdapter(); break
    // NEXT_PUBLIC_JUDGE_PROVIDER=browser compiles and runs Java on the client
    // with CheerpJ; every other value keeps the remote-judge seam untouched.
    case 'java': adapter = browserJavaEnabled() ? new JavaAdapter() : new JudgeAdapter(); break
    default: throw new Error(`Unsupported runtime: ${language}`)
  }
  runtimes.set(language, adapter)
  return adapter
}
