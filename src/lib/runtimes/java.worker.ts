import { createJavaEngine, type CheerpJHost } from './java-engine'
import { createJavaStructureChecker } from './java-structure'
import { installWorkerHost } from './worker-host'

interface CheerpJScope {
  importScripts(url: string): void
  cheerpjInit(options: { version: number; status: string }): Promise<void>
  cheerpOSAddStringFile(path: string, contents: string): void
  cheerpjRunMain(className: string, classPath: string, ...args: string[]): Promise<number>
  cjFileBlob(path: string): Promise<Blob | null>
}
const scope = globalThis as unknown as CheerpJScope

// The CheerpJ Community License requires the runtime to be loaded from the
// vendor's own CDN; it is never self-hosted or vendored into this repository.
// See public/java/README.md. Workers are supported since CheerpJ 3.0rc2 through
// plain importScripts, and everything below stays inside java.io, so nothing on
// this path needs a DOM.
const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js'

installWorkerHost(createJavaEngine({
  async loadCheerpJ(): Promise<CheerpJHost> {
    scope.importScripts(CHEERPJ_LOADER)
    // version 8, not 17: tools.jar is JDK 8's compiler and it throws a
    // NullPointerException resolving a boot classpath a Java 17 runtime does not
    // have. See docs/research/cheerpj-spike.md.
    await scope.cheerpjInit({ version: 8, status: 'none' })
    return {
      addStringFile: (path, contents) => scope.cheerpOSAddStringFile(path, contents),
      runMain: (className, classPath, args) => scope.cheerpjRunMain(className, classPath, ...args),
      readTextFile: async path => {
        const blob = await scope.cjFileBlob(path)
        return blob ? blob.text() : null
      },
    }
  },
  loadStructureChecker: () => createJavaStructureChecker({
    runtimeWasm: '/java/web-tree-sitter.wasm',
    grammarWasm: '/java/tree-sitter-java.wasm',
  }),
}))
