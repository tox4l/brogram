import type { PyodideAPI } from 'pyodide'
import type { RunRequest, TestCase } from '@/lib/contracts'
import type { RuntimeEngine } from './worker-host'
import type { ExecutionOutput } from './shared'

// The plan's harness, executed for one test per worker message so the parent can
// terminate at each test's deadline. Every message gets a fresh globals dict.
const HARNESS = `
import json, sys, io, traceback
results = []
for t in TESTS:
    out = io.StringIO(); err = io.StringIO()
    old = (sys.stdout, sys.stderr); sys.stdout, sys.stderr = out, err
    try:
        exec(CODE, globals())
        if FN:
            args = json.loads(t["input"])
            actual = json.dumps(globals()[FN](*args), default=str)
            passed = actual == t["expected"]
            if not passed:
                try:
                    passed = json.loads(actual) == json.loads(t["expected"])
                except (ValueError, TypeError):
                    pass
        else:
            actual = out.getvalue().strip()
            passed = actual == t["expected"].strip()
        results.append({"testId": t["id"], "passed": passed, "actual": actual, "expected": t["expected"], "stdout": out.getvalue(), "stderr": err.getvalue(), "failureKind": None if passed else "wrong-answer"})
    except Exception:
        results.append({"testId": t["id"], "passed": False, "actual": "", "expected": t["expected"], "stdout": out.getvalue(), "stderr": err.getvalue() + traceback.format_exc(), "failureKind": "runtime-error"})
    finally:
        sys.stdout, sys.stderr = old
RESULT_JSON = json.dumps(results)
`

/** Counts declared parameters, ignoring *args/**kwargs; a default value still counts as one param. */
function paramCount(signature: string): number {
  const trimmed = signature.trim()
  if (!trimmed) return 0
  return trimmed.split(',').map(p => p.trim()).filter(p => p && !p.startsWith('*')).length
}

/**
 * Picks the entry point among a request's top-level defs. An exercise's helpers commonly sit
 * after the entry point (e.g. "Discount then tax" defines checkout_total first, then the two
 * helpers it calls), so the LAST def is not a safe default. Instead: prefer the def whose
 * parameter count matches the first test's JSON argument count (first match wins); otherwise
 * fall back to the first top-level def, matching the starterCode convention of defining the
 * entry point before its helpers.
 */
function entryPointName(request: RunRequest): string {
  const defs = [...request.code.matchAll(/^def\s+(\w+)\s*\(([^)]*)\)/gm)].map(m => ({ name: m[1], params: m[2] }))
  if (!defs.length) return ''
  const firstTest = request.tests[0]
  if (firstTest) {
    try {
      const args = JSON.parse(firstTest.input)
      if (Array.isArray(args)) {
        const match = defs.find(d => paramCount(d.params) === args.length)
        if (match) return match.name
      }
    } catch { /* not a JSON argument array; fall through to the starterCode convention */ }
  }
  return defs[0].name
}

function functionName(request: RunRequest, test?: TestCase): string {
  // RunRequest has no mode/fnName. JSON argument arrays select function mode.
  // An explicit leading '# brogram:stdin' handles programs reading JSON arrays.
  if (!test || /^\s*#\s*brogram:stdin\b/m.test(request.code)) return ''
  try { if (!Array.isArray(JSON.parse(test.input))) return '' } catch { return '' }
  return entryPointName(request)
}

export function createPyodideEngine(load: () => Promise<PyodideAPI>): RuntimeEngine {
  let python: PyodideAPI | undefined
  const packages = new Set<string>()
  return {
    async warmup(names, progress) {
      if (!python) { progress('Python 3.14 (Pyodide)'); python = await load() }
      for (const name of names) {
        if (packages.has(name)) continue
        progress(name)
        await python.loadPackage([name], { messageCallback: message => progress(message) })
        packages.add(name)
      }
    },
    async execute(request, test): Promise<ExecutionOutput> {
      if (!python) throw new Error('Python is not ready.')
      const input = (test?.input ?? '').split('\n')
      let line = 0
      python.setStdin({ stdin: () => line < input.length ? input[line++] : null })
      const globals = python.toPy({
        CODE: [request.fixture, request.code].filter(Boolean).join('\n'),
        FN: functionName(request, test),
        TESTS: [test ?? { id: 'free', input: '', expected: '' }],
      })
      try {
        python.runPython(HARNESS, { globals })
        const [result] = JSON.parse(globals.get('RESULT_JSON')) as Array<ExecutionOutput & { passed: boolean }>
        // Graded comparisons are centralized; stdin follows stripped stdout.
        // The Python harness itself compares exact strings or parsed JSON.
        return {
          actual: result.actual,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.failureKind === 'runtime-error' ? { failureKind: result.failureKind } : {}),
          ...(test && result.passed && !functionName(request, test) ? { actual: test.expected } : {}),
        }
      } finally {
        globals.destroy()
        python.setStdin({ error: true })
      }
    },
  }
}
