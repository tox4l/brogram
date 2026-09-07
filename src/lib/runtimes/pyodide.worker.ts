import type { PyodideAPI } from 'pyodide'
import { createPyodideEngine } from './pyodide-engine'
import { installWorkerHost } from './worker-host'

const INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/'

/**
 * Root cause (confirmed against the real CDN asset in a real browser, not
 * assumed from the changelog): Pyodide 314's own runtime-environment probe
 * (`getGlobalRuntimeEnv` in both pyodide.js and pyodide.mjs) calls
 * `globalThis.importScripts("data:text/javascript,")` inside a try/catch to
 * decide whether it is running in a "classic" (non-module) dedicated worker;
 * if that call succeeds, Pyodide deliberately throws "Classic web workers
 * are not supported" rather than booting - a breaking change in this
 * release, not a bug on our side, and not what CDN-reachability checks
 * (pyodide.js/pyodide.mjs/pyodide.asm.wasm all 200) would ever surface.
 *
 * This worker is bundled by Turbopack via `new Worker(new URL('./pyodide.worker.ts',
 * import.meta.url))` (pyodide.ts), and Turbopack's dev bootstrap for that
 * pattern loads the compiled worker chunks with its own `importScripts()`
 * call before any of this module's own code runs - confirmed by fetching
 * that loader chunk directly and by reproducing the exact failure with a
 * plain `new Worker(blobURL)` (no bundler involved at all) against this same
 * CDN URL. Passing `{ type: 'module' }` to that `new Worker()` call (see
 * pyodide.ts) does not change this: the loader chunk this Turbopack version
 * emits still bootstraps with `importScripts()` either way, so `self` here
 * genuinely has a working `importScripts` by the time this file runs, and
 * loading pyodide.mjs via a dynamic `import()` instead of pyodide.js via
 * `importScripts()` is not by itself enough - confirmed directly: pyodide.mjs
 * throws the identical "Classic web workers are not supported" error when
 * dynamically imported into a worker whose `importScripts` still works.
 *
 * The fix that does not depend on Turbopack ever supporting real module
 * workers: shadow `self.importScripts` with a throwing stub before Pyodide's
 * probe can call it. Turbopack's own use of `importScripts` to bootstrap this
 * chunk has already completed by the time this top-level code runs - this
 * module is itself one of the chunks that call loaded - so overwriting it
 * here can't break Turbopack's own loading; it only has to fool Pyodide's
 * later probe, which it does since a shadowed own-property wins over
 * whatever the environment provided. `delete self.importScripts` was tried
 * first and does NOT work - `importScripts` lives on the worker global's
 * prototype, and `delete` on a non-own property is a silent no-op, leaving
 * the prototype method (and Pyodide's probe) untouched.
 */
declare const self: typeof globalThis
;(self as { importScripts?: unknown }).importScripts = () => {
  throw new Error('importScripts is disabled in this worker: Pyodide 314 requires a non-classic-worker environment to boot.')
}

installWorkerHost(createPyodideEngine(async () => {
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${INDEX_URL}pyodide.mjs`) as { loadPyodide(options: { indexURL: string }): Promise<PyodideAPI> }
  return mod.loadPyodide({ indexURL: INDEX_URL })
}))
