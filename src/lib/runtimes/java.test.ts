import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunRequest } from '@/lib/contracts'
import { createJavaEngine, javaProgram, javaSessionPaths, needsCompiler, remapDiagnostics, JAVA_PROGRESS, type CheerpJHost } from './java-engine'
import { JavaAdapter, JAVA_COMPILE_BUDGET_MS } from './java'
import { createEngineWorker } from './engine-worker.test-support'
import type { JavaStructureChecker } from './java-structure'
import smoke from '../../../seed/exercises/smoke.json'

const exercise = smoke.exercises.find(item => item.language === 'java')!

/** What the stub JVM does with one submission: reject it, or answer each stdin. */
interface Program {
  compileError?: string
  compileDelayMs?: number
  runDelayMs?: number
  /** The JVM dies before writing its status file. */
  noStatus?: boolean
  answer?(stdin: string): { stdout?: string; stderr?: string; status?: string }
}

interface Stub { host: CheerpJHost; compiles: number; runs: number; files: Map<string, string>; classDirs: string[]; bootCalls: string[][] }

const sleep = (ms?: number) => (ms ? new Promise<void>(resolve => setTimeout(resolve, ms)) : Promise.resolve())

/**
 * A CheerpJ stand-in: the same file-and-argv protocol Runner.java implements,
 * with an in-memory filesystem, so engine logic is testable without a JVM.
 */
function createStub(program: Program): Stub {
  const files = new Map<string, string>()
  const stub: Stub = { compiles: 0, runs: 0, files, classDirs: [], bootCalls: [], host: undefined as unknown as CheerpJHost }
  stub.host = {
    addStringFile: (path, contents) => { files.set(path, contents) },
    async runMain(className, _classPath, args) {
      // The boot class is named per session and makes the session directory.
      if (className.startsWith('Boot')) { stub.bootCalls.push(args); files.set(args[1], args[2]); return 0 }
      if (className !== 'Runner') return 0
      const [mode] = args
      if (mode === 'ready') { files.set(args[1], args[2]); return 0 }
      if (mode === 'compile') {
        stub.compiles++
        stub.classDirs.push(args[1])
        await sleep(program.compileDelayMs)
        files.set(args[2], program.compileError ?? '')
        files.set(`${args[2]}.status`, program.compileError ? '1' : '0')
        return 0
      }
      stub.runs++
      stub.classDirs.push(args[1])
      await sleep(program.runDelayMs)
      const answer = program.answer?.(files.get(args[2]) ?? '') ?? {}
      if (program.noStatus) { files.set(args[3], answer.stdout ?? ''); return 0 }
      files.set(args[3], answer.stdout ?? '')
      files.set(`${args[3]}.err`, answer.stderr ?? '')
      files.set(`${args[3]}.status`, answer.status ?? '0')
      return 0
    },
    async readTextFile(path) { return files.get(path) ?? null },
  }
  return stub
}

const checker: JavaStructureChecker = {
  check: (source, assertions) => assertions.types.every(type => source.includes(`class ${type.name}`))
    ? { ok: true, failures: [] }
    : { ok: false, failures: [`class ${assertions.types[0].name} is missing.`] },
}

/** One stub JVM per worker, exactly as a real Worker gets its own CheerpJ. */
function createHarness(...programs: Program[]) {
  const stubs: Stub[] = []
  const adapter = new JavaAdapter(() => {
    const stub = createStub(programs[Math.min(stubs.length, programs.length - 1)])
    stubs.push(stub)
    return createEngineWorker(createJavaEngine({ loadCheerpJ: async () => stub.host, loadStructureChecker: async () => checker }))
  })
  const total = (key: 'compiles' | 'runs') => stubs.reduce((sum, stub) => sum + stub[key], 0)
  return { adapter, stubs, compiles: () => total('compiles'), runs: () => total('runs') }
}

const request = (over: Partial<RunRequest> = {}): RunRequest => ({
  language: 'java', code: exercise.referenceSolution, fixture: exercise.fixture, timeoutMs: 5000, tests: exercise.tests, ...over,
})
const structuralTest = { id: 's1', input: '{"structure":{"types":[{"name":"Shape"}]}}', expected: 'ok', hidden: false }

afterEach(() => vi.useRealTimers())

describe('java source assembly', () => {
  it('builds one compilation unit with the student first and public stripped from Solution', () => {
    const program = javaProgram(request())
    expect(program.source).toContain('public class Main')
    expect(program.source).toContain('class Solution')
    expect(program.source).not.toContain('public class Solution')
    expect(program.source.indexOf('class Solution')).toBeLessThan(program.source.indexOf('public class Main'))
  })

  it('hoists imports from both halves and keeps the student line numbering', () => {
    const code = 'class Solution {\n    static List<String> pick() { return new ArrayList<>(); }\n}\n'
    const program = javaProgram(request({ code, fixture: 'import java.util.*;\npublic class Main { public static void main(String[] a) { } }\n' }))
    const lines = program.source.split('\n')
    expect(lines[0]).toBe('import java.util.*;')
    // One hoisted import, so the student's first line is file line 2 - and the
    // range the engine reports errors against says exactly that.
    expect(program.codeStart).toBe(2)
    expect(lines[program.codeStart - 1]).toBe('class Solution {')
    expect(program.source.slice(program.source.indexOf('public class Main'))).not.toContain('import')
  })

  it('rewrites compiler line numbers onto the file the student is editing', () => {
    const program = { source: '', codeStart: 2, codeEnd: 5, importOrigins: [{ file: 'Solution.java' as const, line: 3 }] }
    expect(remapDiagnostics('/str/Main.java:4: error: \';\' expected', program)).toBe("Solution.java:3: error: ';' expected")
    expect(remapDiagnostics('/str/Main.java:7: error: bad', program)).toBe('Main.java:2: error: bad')
    // A hoisted import maps back to the line the student actually typed it on.
    expect(remapDiagnostics('/str/Main.java:1: error: package nope does not exist', program)).toBe('Solution.java:3: error: package nope does not exist')
    // Notes carry no line number and must not leak the internal path.
    expect(remapDiagnostics('Note: /str/Main.java uses unchecked or unsafe operations.', program)).toBe('Note: Solution.java uses unchecked or unsafe operations.')
  })

  it('points a bad import back at the student half or the fixture half', () => {
    const program = javaProgram(request({
      code: 'import nope.Missing;\nclass Solution { }\n',
      fixture: 'import java.util.*;\npublic class Main { public static void main(String[] a) { } }\n',
    }))
    expect(program.importOrigins).toEqual([{ file: 'Solution.java', line: 1 }, { file: 'Main.java', line: 1 }])
    expect(remapDiagnostics('/str/Main.java:1: error: package nope does not exist', program)).toBe('Solution.java:1: error: package nope does not exist')
    expect(remapDiagnostics('/str/Main.java:2: error: broken', program)).toBe('Main.java:1: error: broken')
  })

  it('treats a fixtureless submission as the whole program', () => {
    expect(javaProgram(request({ fixture: undefined, code: 'public class Main {}' }))).toMatchObject({ source: 'public class Main {}', codeStart: 1, codeEnd: 1 })
  })

  it('gives every engine its own directory under the shared, persistent /files', () => {
    const one = javaSessionPaths()
    const two = javaSessionPaths()
    expect(one.session).not.toBe(two.session)
    for (const paths of [one, two]) {
      expect(paths.id).toMatch(/^[a-zA-Z0-9]+$/)
      for (const path of [paths.classDir, paths.diagnostics, paths.stdout, paths.ready]) {
        expect(path.startsWith(`${paths.session}/`)).toBe(true)
      }
      // The bootstrap class file is the one thing outside the session directory
      // (javac will not create a missing -d directory), so its name is unique.
      expect(paths.bootClassFile).toBe(`/files/Boot${paths.id}.class`)
      expect(paths.classPath.endsWith(paths.session)).toBe(true)
    }
  })

  it('leads every session id with a fixed-width creation timestamp a later id sorts after', async () => {
    const earlier = javaSessionPaths()
    await new Promise(resolve => setTimeout(resolve, 5))
    const later = javaSessionPaths()
    // The boot class's stale-directory sweep compares this prefix as a plain
    // string; both ids must be the same width and the later one must compare
    // greater, with no timestamp parsing needed on the Java side.
    expect(earlier.id.slice(0, 9)).toHaveLength(9)
    expect(later.id.slice(0, 9)).toHaveLength(9)
    expect(later.id.slice(0, 9) >= earlier.id.slice(0, 9)).toBe(true)
  })

  it('needs the compiler unless every test is structural', () => {
    expect(needsCompiler([structuralTest])).toBe(false)
    expect(needsCompiler([])).toBe(true)
    expect(needsCompiler([structuralTest, exercise.tests[0]])).toBe(true)
  })
})

describe('java engine', () => {
  it('reports warmup steps in order and refuses to run when the compiler never answers', async () => {
    const stub = createStub({})
    const steps: string[] = []
    const engine = createJavaEngine({ loadCheerpJ: async () => stub.host, loadStructureChecker: async () => checker })
    await engine.warmup([], step => steps.push(step))
    expect(steps).toEqual([JAVA_PROGRESS.engine, JAVA_PROGRESS.compiler, JAVA_PROGRESS.ready])

    const broken = createJavaEngine({
      loadCheerpJ: async () => ({ ...stub.host, runMain: async () => 0, readTextFile: async () => null }),
      loadStructureChecker: async () => checker,
    })
    await expect(broken.warmup([], () => {})).rejects.toThrow(/tools\.jar/)
  })

  it('gives the boot class the shared /files root and a sweep cutoff for stale sessions', async () => {
    const stub = createStub({})
    const engine = createJavaEngine({ loadCheerpJ: async () => stub.host, loadStructureChecker: async () => checker })
    await engine.warmup([], () => {})
    expect(stub.bootCalls).toHaveLength(1)
    const [session, ready, token, bootClassFile, filesRoot, cutoff] = stub.bootCalls[0]
    expect(session).toBe(engine.paths.session)
    expect(ready).toBe(engine.paths.ready)
    expect(token).toBeTruthy()
    expect(bootClassFile).toBe(engine.paths.bootClassFile)
    expect(filesRoot).toBe('/files')
    // A fixed-width, string-comparable cutoff in the past: strictly less than
    // this engine's own (later) session id, so the boot never sweeps itself.
    expect(cutoff).toHaveLength(9)
    expect(cutoff < engine.paths.id.slice(0, 9)).toBe(true)
  })

  it('compiles once for a whole submission and grades trimmed stdout', async () => {
    const harness = createHarness({ answer: stdin => ({ stdout: `${stdin.split(' ')[0]}:x\n  ` }) })
    const result = await harness.adapter.run(request({ tests: [{ id: 't1', input: 'square 2', expected: 'square:x', hidden: false }, { id: 't2', input: 'circle 1', expected: 'circle:x', hidden: true }] }))
    expect(result.passedCount).toBe(2)
    expect(harness.compiles()).toBe(1)
    expect(harness.runs()).toBe(2)
  })

  it('recompiles when the submitted code changes', async () => {
    const harness = createHarness({ answer: () => ({ stdout: 'ok' }) })
    const tests = [{ id: 't1', input: '', expected: 'ok', hidden: false }]
    await harness.adapter.run(request({ tests }))
    await harness.adapter.run(request({ tests }))
    expect(harness.compiles()).toBe(1)
    await harness.adapter.run(request({ tests, code: 'class Solution { }' }))
    expect(harness.compiles()).toBe(2)
  })

  it('maps a javac failure to one compile-error result per test', async () => {
    const harness = createHarness({ compileError: '/str/Solution.java:3: error: ";" expected\n1 error' })
    const result = await harness.adapter.run(request())
    expect(result.ok).toBe(false)
    expect(result.results).toHaveLength(exercise.tests.length)
    expect(result.results.every(item => item.failureKind === 'compile-error')).toBe(true)
    expect(result.results[0].stderr).toContain('error: ";" expected')
    expect(harness.compiles()).toBe(1)
  })

  it('reports a thrown exception as a runtime error and keeps its stack', async () => {
    const { adapter } = createHarness({ answer: () => ({ status: '1', stderr: 'java.lang.NullPointerException' }) })
    const result = await adapter.run(request({ tests: [{ id: 't1', input: '', expected: 'x', hidden: false }] }))
    expect(result.results[0]).toMatchObject({ failureKind: 'runtime-error', stderr: 'java.lang.NullPointerException' })
  })

  it('returns free-run stdout without manufacturing a graded test', async () => {
    const { adapter } = createHarness({ answer: () => ({ stdout: 'hello\n' }) })
    expect(await adapter.run(request({ tests: [] }))).toMatchObject({ ok: true, totalCount: 0, stdout: 'hello\n' })
  })

  it('fails loudly on a malformed structural test instead of grading it as stdin', async () => {
    const harness = createHarness({ answer: () => ({ stdout: 'anything' }) })
    const broken = { id: 's1', input: '{"structure": {"types": []}}', expected: 'ok', hidden: false }
    const result = await harness.adapter.run(request({ tests: [broken] }))
    expect(result.results[0]).toMatchObject({ passed: false, failureKind: 'runtime-error' })
    expect(result.results[0].stderr).toContain('structural check')
    expect(harness.runs()).toBe(0)
  })

  it('reports a JVM that died mid-test and replaces the worker before the next run', async () => {
    const dying: Program = { noStatus: true }
    const healthy: Program = { answer: () => ({ stdout: 'ok' }) }
    const harness = createHarness(dying, healthy)
    const tests = [{ id: 't1', input: '', expected: 'ok', hidden: false }]
    const first = await harness.adapter.run(request({ tests }))
    expect(first.results[0]).toMatchObject({ passed: false, failureKind: 'runtime-error' })
    // `fatal` steers the adapter; it must never be stored on the graded result.
    expect(Object.hasOwn(first.results[0], 'fatal')).toBe(false)
    expect((await harness.adapter.run(request({ tests }))).passedCount).toBe(1)
  })

  it('routes a structural test to the checker instead of the compiler', async () => {
    const harness = createHarness({})
    const passed = await harness.adapter.run(request({ tests: [structuralTest] }))
    expect(passed).toMatchObject({ ok: true, passedCount: 1 })
    expect(harness.compiles()).toBe(0)
    expect(harness.runs()).toBe(0)

    const failed = await harness.adapter.run(request({ tests: [structuralTest], code: 'class Solution { }' }))
    expect(failed.results[0]).toMatchObject({ passed: false, failureKind: 'wrong-answer', actual: 'class Shape is missing.' })
  })
})

describe('java adapter lifecycle', () => {
  it('lets a compile outlast the per-test budget without touching the test budget', async () => {
    vi.useFakeTimers()
    const { adapter } = createHarness({ compileDelayMs: 12_000, answer: () => ({ stdout: 'ok' }) })
    const run = adapter.run(request({ tests: [{ id: 't1', input: '', expected: 'ok', hidden: false }] }))
    await vi.advanceTimersByTimeAsync(12_000)
    expect((await run).passedCount).toBe(1)
  })

  it('times out a compile that overruns the compile budget and promotes the standby', async () => {
    vi.useFakeTimers()
    const slow: Program = { compileDelayMs: JAVA_COMPILE_BUDGET_MS + 5_000, answer: () => ({ stdout: 'ok' }) }
    const fast: Program = { answer: () => ({ stdout: 'ok' }) }
    // Only the first worker stalls in javac; the warm standby behind it is healthy.
    const { adapter } = createHarness(slow, fast)
    const tests = [{ id: 't1', input: '', expected: 'ok', hidden: false }, { id: 't2', input: '', expected: 'ok', hidden: true }]
    const run = adapter.run(request({ tests }))
    await vi.advanceTimersByTimeAsync(JAVA_COMPILE_BUDGET_MS)
    expect((await run).results.map(item => item.failureKind)).toEqual(['timeout', 'timeout'])

    const next = adapter.run(request({ tests }))
    await vi.advanceTimersByTimeAsync(JAVA_COMPILE_BUDGET_MS + 5_000)
    expect((await next).passedCount).toBe(2)
  })

  it('still cuts a single test at five seconds', async () => {
    vi.useFakeTimers()
    const { adapter } = createHarness({ runDelayMs: 30_000 })
    const run = adapter.run(request({ tests: [{ id: 't1', input: '', expected: 'ok', hidden: false }] }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await run).results[0].failureKind).toBe('timeout')
  })
})
