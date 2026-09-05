import type { PyodideAPI } from 'pyodide'
import { createPyodideEngine } from './pyodide-engine'
import { installWorkerHost } from './worker-host'

const scope = globalThis as unknown as {
  importScripts(url: string): void
  loadPyodide(options: { indexURL: string }): Promise<PyodideAPI>
}
const INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/'
installWorkerHost(createPyodideEngine(async () => {
  scope.importScripts(`${INDEX_URL}pyodide.js`)
  return scope.loadPyodide({ indexURL: INDEX_URL })
}))
