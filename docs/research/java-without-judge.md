# Java without a judge

Decision record, 2026-09-06. Judge0 was dropped today. This document says how Java exercises get run and graded instead, what changes in the repo, and what to do if the recommendation fails its spike. Every claim that a researcher made and a skeptic corrected appears here in its corrected form.

## 1. Decision summary

Run Java entirely in the browser with CheerpJ 4.3, a WebAssembly JVM loaded from the vendor CDN, which can execute the real OpenJDK `javac` as an ordinary Java program and therefore compiles and runs student source client-side with no server component beyond static hosting — this keeps the architecture rule intact (the browser runs and grades, the server stores and thinks), costs nothing, needs no COOP/COEP headers, and fits the existing `RuntimeAdapter` worker-and-standby pattern almost unchanged. The second choice is the server fallback behind the `JUDGE_PROVIDER` seam that already exists: Vercel Sandbox, which is generally available, boots a Firecracker microVM from a custom JDK image in milliseconds, and on the free plan grants 5 Active-CPU hours, 420 GB-hours, 5,000 sandbox creations and 10 concurrent sandboxes per month with no overage charge — it needs no new vendor account and no privileged VPS. CheerpJ wins on cost, on preserving the client-heavy rule, and on being reachable this week, but it carries two real conditions: the free Community License requires loading the runtime from the vendor's own CDN and excludes redistribution, and in-browser `javac` requires self-hosting an 18.3 MB `tools.jar` (GPLv2 with Classpath Exception) from our own origin, pushing a Java exercise's first load to roughly 28-38 MB. Self-hosted Piston is explicitly out — its public API has denied keys to individual and coursework projects since 2026-02-15, and self-hosting means operating a `--privileged`, cgroup-v2 container that executes arbitrary student code. Whichever runtime wins, it does not solve the deeper problem this research surfaced — 16 of the 16 parked Java `code` exercises are graded only by comparing the stdout of one static `Solution` method, so a flat procedural submission with no classes, no inheritance and no overrides passes every hidden test identically to the intended object-oriented solution — which is why section 4 adds a parser-based structural check as a complement, not an alternative.

## 2. Options compared

| Option | Runs where | License and cost | Size and cold start | javac in browser | Fits `RuntimeAdapter` | Verdict |
|---|---|---|---|---|---|---|
| **A. CheerpJ 4.3** | Browser (Web Worker, iframe fallback) | Proprietary; free Community License for FOSS projects and one-person companies, **CDN-locked**, no redistribution; £100/dev/month otherwise | ~10-20 MB runtime (streamed, cached) + 17.5 MiB self-hosted `tools.jar` ≈ **28-38 MB first load**; cold start unmeasured | **Yes** — runs OpenJDK `javac` as a Java program | Yes: Worker + warm standby + terminate-on-timeout, one ~4-line hook in `worker-adapter.ts` | **Recommended** |
| B1. Vercel Sandbox | Server (Firecracker microVM, our existing host) | Free-plan quota: 5 Active-CPU h, 420 GB-h, 5,000 creations, 10 concurrent per month; no overage charge | Boots "in milliseconds" from a JDK image; JVM compile+run still costs ~1-3 s | n/a | Yes, unchanged — it is the existing `JudgeAdapter` with a new provider | **Second choice / fallback** |
| B2. Vercel Container Images | Server (our own function) | Same Active-CPU pricing; Hobby limits published | Container cold start unmeasured | n/a | Yes | Rejected: student code runs inside our function, **next to our Supabase keys** |
| B3. Self-hosted Piston | VPS (privileged Docker) | $4-6/mo; open source | Warm; JVM run only | n/a | Yes | Rejected: privileged container executing untrusted code; public API denies keys for individual and coursework projects; default run timeout 3000 ms is **below** our 5 s contract |
| B4. Free hosted judges (Wandbox, Glot.io) | Third-party servers | No ToS/SLA; Wandbox warns against same-IP bursts; Glot.io's runner repo was archived 2026-08-26 | n/a | n/a | Yes | Rejected as a launch dependency; a Vercel route calls from a narrow shared IP range, exactly what Wandbox restricts |
| B5. Supabase Edge Functions | n/a | n/a | n/a | No | No | Impossible: "spawning subprocesses is not allowed on Supabase Edge Runtime" |
| C. Structural grading (tree-sitter) | Browser (parse only) | MIT (`web-tree-sitter` + `tree-sitter-java`) | **~762 KiB** self-hosted wasm+JS; parse in single-digit ms | No — never executes | Yes (trivial adapter), or as a pre-check inside `submit` | **Complement, ship alongside** — the only thing that can tell object-oriented code from a procedural fake |
| D. teavm-javac | Browser | Apache-2.0; bundles OpenJDK javac | 3.9 MiB wasm | Yes | Unproven | Thin Plan B; live (pushed 2026-09-04) but 84 stars, no benchmarks, no production use |
| E. DoppioJVM / TeaVM / Bytecoder / JWebAssembly | Browser / build step | n/a | n/a | No | No | Dead ends: Doppio's last commit was 2021-08-04 (dependency bumps only); the other three consume **compiled bytecode only** |

## 3. Recommended option in detail: CheerpJ 4.3 in a Web Worker

### 3.1 License

The exact sentence that governs us, from https://cheerpj.com/docs/licensing.html:

> "The CheerpJ Community License allows unlimited, unmetered use of CheerpJ from the cjrtnc.leaningtech.com domain, such as its usage via npm package manager. For self-hosted options, see the CheerpJ Commercial License."

The free-tier list on the same page begins "You can use CheerpJ for free if you fall into any of the following categories:" and includes both "Individuals, including one-person companies" and "Free and Open-Source Software (FOSS) projects", each carrying the obligation "Give appropriate credits". The Commercial License covers "any business use (with exception of one-person companies), redistribution and OEM use."

Three consequences, stated plainly because they are conditions and not footnotes:

1. **Load the runtime from `https://cjrtnc.leaningtech.com/4.3/loader.js` and never vendor it.** Self-hosting the runtime requires a paid license. This is architecturally identical to how Pyodide is already loaded from a CDN inside `pyodide.worker.ts`, so it is not a new deployment pattern.
2. **BroGram qualifies on two independent grounds** — MIT/FOSS project, and sole developer — but it ships under a company brand, so the qualification rests on the FOSS bullet more than the one-person-company bullet. Get that in writing (owner: Musa, section 6). The academic route is a documented fallback: the licensing page offers "free or heavily-discounted licenses for classroom" use.
3. **"Redistribution" is commercial-only.** Anyone who forks this MIT repo and redeploys it is shipping a CheerpJ integration under their own license position, not ours. The README must say so, next to the required credit.

Separately, `tools.jar` (OpenJDK's compiler) is **GPLv2 with the Classpath Exception**, not MIT. Serving it from `public/` is permitted but must carry a NOTICE file; it must not be silently vendored into an MIT tree.

### 3.2 Versions and live facts (checked 2026-09-06)

| Fact | Value | How checked |
|---|---|---|
| CheerpJ release | 4.3, released 2026-04-21 | changelog; `HEAD https://cjrtnc.leaningtech.com/4.3/loader.js` returns `last-modified: Mon, 20 Apr 2026 11:45:31 GMT` |
| Java runtimes | 8, 11, 17. Java 21 is planned, not shipped. LTS parity is **not** promised anywhere | FAQ |
| Loader CORS | `access-control-allow-origin: *`, `cross-origin-resource-policy: cross-origin` | live HEAD |
| COOP / COEP / SharedArrayBuffer | **Not required.** The JIT compiles hot paths to JavaScript, not threaded wasm | the Basic Server Setup page states no isolation requirement; this matches the existing no-cross-origin-isolation decision |
| Server requirements that *are* real | The origin serving Java files must support **Range headers**, and `.wasm` must be served as `application/wasm` | Basic Server Setup page. Vercel static hosting satisfies both |
| Entry files | `loader.js` 7,521 B; `cj3.js` 666,055 B; `cj3.wasm` 372,758 B; the rest streamed on demand | live fetch |
| `tools.jar` | 18,307,716 B (17.5 MiB), served with `Accept-Ranges: bytes` | `HEAD https://javafiddle.leaningtech.com/tools.jar` |
| `tools.jar` on the vendor CDN | **Not served.** `https://cjrtnc.leaningtech.com/4.3/tools.jar` returns `204 No Content`, byte-identical to the response for a deliberately bogus path | live HEAD, compared against a nonexistent file |
| Worker support | Since 3.0rc2 (2023-11-29) via plain `importScripts`; the `CheerpJWorker` class was removed. **Anything requiring DOM access is unsupported in a worker** | migration guide |
| Known worker bug | `cheerpj-meta#192`: a Chromium dedicated worker threw "requestAnimationFrame not supported in this Worker" (it worked in Firefox). Closed with no visible fix | GitHub issue |

Java 17 covers everything the launch syllabus needs — classes, encapsulation, static, inheritance, polymorphism, interfaces with default methods, collections, generics, exceptions, streams. Java 21 is not needed.

### 3.3 Loading and execution API

Four documented calls carry the whole design:

```ts
cheerpjInit(options): Promise<void>                                        // once per page or worker
cheerpjRunMain(className: string, classPath: string, ...args: string[]): Promise<number>  // resolves with the exit code
cheerpOSAddStringFile(path: string, data: string | Uint8Array): void       // JS -> virtual filesystem
cjFileBlob(path: string): Promise<Blob>                                    // virtual filesystem -> JS
```

Three virtual mounts matter: `/app/` is the root of our own web server (so `public/tools.jar` is `/app/tools.jar`), `/files/` is read-write, and `/str/` is "a transient mount used to pass data from JavaScript to Java. JavaScript can read and write, Java can only read."

The vendor's own JavaFiddle proves the compile path, and its source is the pattern to copy:

```js
const classPath = '/app/tools.jar:/files/';
const code = await cheerpjRunMain('com.sun.tools.javac.Main', classPath, ...sourceFiles, '-d', '/files/', '-Xlint');
if (code === 0) await cheerpjRunMain(mainClass, classPath);
```

**Where our design deliberately diverges from JavaFiddle.** JavaFiddle captures program output by watching a DOM element (`<pre id="console">`) with a `MutationObserver`. That cannot work in a Worker, where DOM access is unsupported. So the adapter never reads output from the DOM. Instead it compiles one small adapter-owned bootstrap class, `BrogramRunner`, at warmup; from then on every compile and every test runs *inside* that class, which redirects `System.in`, `System.out` and `System.err` in-JVM and writes results into `/files/`, which JavaScript reads back with `cjFileBlob`. This also solves the stdin problem: all 16 parked `code` fixtures read stdin with `Scanner`, and CheerpJ documents no stdin API at all. Because `System.setIn` happens inside our own bootstrap, **not one of the 16 fixtures has to change**.

### 3.4 `JavaRuntimeAdapter` sketch

Three new files plus a four-line hook. Everything else — warm standby, timeout by termination, per-test messaging, progress events — is reused from `worker-adapter.ts` and `worker-host.ts` exactly as Pyodide uses them.

**`src/lib/runtimes/cheerpj.worker.ts`** — the only place that touches the vendor CDN.

```ts
import { createCheerpJEngine } from './cheerpj-engine'
import { installWorkerHost } from './worker-host'

// Community License condition: the runtime loads from the vendor CDN, never self-hosted.
const LOADER = 'https://cjrtnc.leaningtech.com/4.3/loader.js'
const scope = globalThis as unknown as {
  importScripts(url: string): void
  cheerpjInit(options: Record<string, unknown>): Promise<void>
  cheerpjRunMain(className: string, classPath: string, ...args: string[]): Promise<number>
  cheerpOSAddStringFile(path: string, data: string | Uint8Array): void
  cjFileBlob(path: string): Promise<Blob>
}

installWorkerHost(createCheerpJEngine({
  async init() {
    scope.importScripts(LOADER)
    await scope.cheerpjInit({ version: 17, status: 'none' })
  },
  addFile: (path, data) => scope.cheerpOSAddStringFile(path, data),
  runMain: (cls, cp, ...args) => scope.cheerpjRunMain(cls, cp, ...args),
  readFile: async path => (await scope.cjFileBlob(path)).text(),
}))
```

**`src/lib/runtimes/cheerpj-engine.ts`** — the `RuntimeEngine` the worker host drives. It is pure logic over a small host interface, so it is unit-testable offline against a fake host, the same way `engine-worker.test-support.ts` already tests the other engines.

```ts
import type { RunRequest, TestCase } from '@/lib/contracts'
import type { RuntimeEngine } from './worker-host'
import type { ExecutionOutput } from './shared'
import { buildJavaSource } from './java-normalize'

export interface CheerpJHost {
  init(): Promise<void>
  addFile(path: string, data: string): void
  runMain(className: string, classPath: string, ...args: string[]): Promise<number>
  readFile(path: string): Promise<string>
}

const JAVAC = 'com.sun.tools.javac.Main'
const RUNNER_CP = '/app/tools.jar:/files/runner'

// Adapter-owned bootstrap, compiled once at warmup and reused for every submission.
// It exists so grading never reads the DOM: CheerpJ's default stdout sink is a DOM
// element, which does not exist in a Worker. Everything crosses through /files/.
// System.exit is deliberately not called - whether it tears down the shared JVM is
// unspecified - so the exit status is written to a file instead.
const RUNNER_SOURCE = `import java.io.*; import java.lang.reflect.*; import java.net.*;
public class BrogramRunner {
  public static void main(String[] argv) throws Exception {
    String mode = argv[0], dir = "/files/" + argv[1];
    new File(dir).mkdirs();
    int status = 0;
    if (mode.equals("compile")) {
      StringWriter log = new StringWriter();
      status = com.sun.tools.javac.Main.compile(
        new String[]{ "-nowarn", "-d", dir, "/str/Main.java" }, new PrintWriter(log));
      write(dir + "/diag.txt", log.toString());
    } else {
      PrintStream out0 = System.out, err0 = System.err; InputStream in0 = System.in;
      ByteArrayOutputStream out = new ByteArrayOutputStream(), err = new ByteArrayOutputStream();
      try {
        System.setIn(new FileInputStream("/str/stdin.txt"));
        System.setOut(new PrintStream(out, true, "UTF-8"));
        System.setErr(new PrintStream(err, true, "UTF-8"));
        // A fresh loader per submission: the system loader would hand back a stale
        // Main from an earlier attempt. dir is not on RUNNER_CP, so nothing shadows it.
        ClassLoader loader = new URLClassLoader(new URL[]{ new File(dir).toURI().toURL() });
        Method main = loader.loadClass("Main").getMethod("main", String[].class);
        main.invoke(null, (Object) new String[0]);
      } catch (InvocationTargetException e) {
        status = 1; e.getCause().printStackTrace(new PrintStream(err, true, "UTF-8"));
      } finally {
        System.out.flush(); System.err.flush();
        System.setIn(in0); System.setOut(out0); System.setErr(err0);
      }
      write(dir + "/stdout.txt", out.toString("UTF-8"));
      write(dir + "/stderr.txt", err.toString("UTF-8"));
    }
    write(dir + "/status.txt", String.valueOf(status));
  }
  static void write(String p, String s) throws IOException {
    try (Writer w = new OutputStreamWriter(new FileOutputStream(p), "UTF-8")) { w.write(s); }
  }
}`

const fnv = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

export function createCheerpJEngine(host: CheerpJHost): RuntimeEngine {
  let ready = false
  let compiled: { key: string; dir: string; error?: ExecutionOutput } | undefined

  return {
    async warmup(_packages, progress) {
      if (ready) return
      progress('Java 17 (CheerpJ)')
      await host.init()
      progress('javac')
      // Compiling the bootstrap also pulls javac's own classes in, so the first
      // student compile is not the one paying for the compiler's cold start.
      host.addFile('/str/BrogramRunner.java', RUNNER_SOURCE)
      const code = await host.runMain(JAVAC, '/app/tools.jar', '/str/BrogramRunner.java', '-d', '/files/runner')
      if (code !== 0) throw new Error('The Java runtime could not prepare its harness.')
      ready = true
    },

    async execute(request: RunRequest, test?: TestCase): Promise<ExecutionOutput> {
      if (!ready) throw new Error('Java is not ready.')
      // One file, fixture first, Solution de-published: byte-identical to what
      // scripts/verify-exercise.mjs certifies, so a verified exercise stays verified.
      const source = buildJavaSource(request.code, request.fixture)
      const key = fnv(source)

      if (compiled?.key !== key) {
        compiled = { key, dir: `/files/${key}` }
        host.addFile('/str/Main.java', source)
        await host.runMain('BrogramRunner', RUNNER_CP, 'compile', key)
        const [diagnostics, status] = await Promise.all([
          host.readFile(`${compiled.dir}/diag.txt`),
          host.readFile(`${compiled.dir}/status.txt`),
        ])
        if (status.trim() !== '0') {
          compiled.error = {
            actual: '', stdout: '',
            stderr: diagnostics.trim() || 'Compilation failed.',
            failureKind: 'compile-error',
          }
        }
      }
      // javac runs once per submission; every remaining test replays the same
      // diagnostics as a compile-error instead of recompiling broken source.
      if (compiled.error) return compiled.error

      host.addFile('/str/stdin.txt', test?.input ?? '')
      await host.runMain('BrogramRunner', RUNNER_CP, 'run', key)
      const [stdout, stderr, status] = await Promise.all([
        host.readFile(`${compiled.dir}/stdout.txt`),
        host.readFile(`${compiled.dir}/stderr.txt`),
        host.readFile(`${compiled.dir}/status.txt`),
      ])
      const failed = status.trim() !== '0'
      // Same convention the Python engine uses: stdout is compared trimmed on both
      // sides here, then `actual` is set to `expected` so the shared comparison agrees.
      const trimmed = stdout.trim()
      const matches = Boolean(test) && trimmed === (test!.expected ?? '').trim()
      return {
        actual: matches ? test!.expected : trimmed,
        stdout, stderr,
        ...(failed ? { failureKind: 'runtime-error' as const } : {}),
      }
    },
  }
}
```

**`src/lib/runtimes/java.ts`** — the adapter itself, three lines of substance.

```ts
import type { RunRequest } from '@/lib/contracts'
import { WorkerAdapter, type RuntimeWorker } from './worker-adapter'
import { browserTimeout } from './shared'

/** javac needs more than one test's budget; student bytecode still gets exactly 5 s. */
export const JAVA_COMPILE_BUDGET_MS = 20_000

export class JavaAdapter extends WorkerAdapter {
  constructor(factory: () => RuntimeWorker = () => new Worker(new URL('./cheerpj.worker.ts', import.meta.url))) {
    super('java', factory)
  }
  protected override deadlineMs(request: RunRequest, index: number): number {
    return index === 0
      ? Math.max(JAVA_COMPILE_BUDGET_MS, browserTimeout(request.timeoutMs))
      : browserTimeout(request.timeoutMs)
  }
}
```

**`src/lib/runtimes/worker-adapter.ts`** — the only edit to existing runtime code. `execute()` currently arms every test with `browserTimeout(run.request.timeoutMs)`, which `shared.ts` caps at 5000 ms. Give the first test of a run its own budget through an overridable hook:

```diff
+  /** Per-test wall clock. Overridden only where a first-test compile step needs its own budget. */
+  protected deadlineMs(request: RunRequest, _index: number): number { return browserTimeout(request.timeoutMs) }
+
-      for (const test of run.request.tests.length ? run.request.tests : [undefined]) {
+      const plan = run.request.tests.length ? run.request.tests : [undefined]
+      for (const [index, test] of plan.entries()) {
         const start = performance.now()
-        run.timer = setTimeout(() => { if (this.current === run) this.abort() }, browserTimeout(run.request.timeoutMs))
+        run.timer = setTimeout(() => { if (this.current === run) this.abort() }, this.deadlineMs(run.request, index))
```

This keeps the contract honest: `RunRequest.timeoutMs` remains a **5-second per-test limit on student code**, while compilation — our infrastructure, not the student's loop — gets a separate, larger budget. Do not raise `browserTimeout`'s 5000 ms cap; that would silently loosen every other runtime.

**How the guarantees hold.** Timeout: `abort()` already terminates the active worker, resolves every remaining test with `failureKind: 'timeout'`, and calls `promote()`. Standby: `warmup()` prepares an active *and* a standby worker, so the promoted one has already run `cheerpjInit` and compiled `BrogramRunner`; the replacement it then spawns refetches everything from the browser HTTP cache. Compile errors: the engine returns `failureKind: 'compile-error'`, which `makeTestResult` passes through untouched and which `TestResult` already declares. Free runs (the Run button, no tests): `worker-adapter.ts` sends one `run` message with `test: undefined`, the engine feeds empty stdin and returns raw stdout and stderr — identical to every other runtime.

### 3.5 Expected download and warmup

| Item | Bytes | Where from |
|---|---|---|
| `loader.js` | 7,521 | vendor CDN |
| `cj3.js` | 666,055 | vendor CDN |
| `cj3.wasm` | 372,758 | vendor CDN |
| Remaining runtime, streamed on demand | vendor states "typically 10-20MB for many apps" | vendor CDN |
| `tools.jar` | 18,307,716 | **our origin** (`public/tools.jar` becomes `/app/tools.jar`) |
| **First Java exercise, cold** | **≈28-38 MB** | browser-cached afterwards |

For comparison, Pyodide is ~10 MB and already ships. Java's load is roughly three times that, and it is gated behind opening a Java exercise, so no other course pays for it.

There is **no vendor-published cold-start figure in seconds**; the docs only say runtime resources are fetched sequentially unless `preloadResources` is used. That number is exactly what the spike in section 5 exists to produce. Two knobs if it comes back bad: pass `preloadResources` (from `cjGetRuntimeResources`) into `cheerpjInit`, and spawn the Java standby worker lazily instead of eagerly — two JVMs in two workers is real memory, and the standby's value (surviving an infinite loop) does not require it to exist before the first submission.

### 3.6 What changes in the repo

**New files under `src/lib/runtimes/`**

| File | Purpose |
|---|---|
| `cheerpj.worker.ts` | `importScripts` the vendor loader, `cheerpjInit({ version: 17, status: 'none' })`, wire the host into `installWorkerHost` |
| `cheerpj-engine.ts` | `RuntimeEngine`: bootstrap compile at warmup, per-submission compile cache, per-test stdin and stdout through `/str` and `/files`, compile-error mapping |
| `java.ts` | `JavaAdapter extends WorkerAdapter` with the compile-budget override |
| `cheerpj.test.ts` | Offline engine test against a fake `CheerpJHost` — compile-error path, stdin path, cache-reuse path — mirroring `pyodide.test.ts` |

**Edited files**

- `src/lib/runtimes/worker-adapter.ts` — the `deadlineMs` hook above (~4 lines).
- `src/lib/runtimes/index.ts` — `case 'java'` returns `JavaAdapter` when the browser runtime is enabled and `JudgeAdapter` otherwise (see the flag below). `index.test.ts` updates with it.
- `src/lib/runtimes/judge.ts` — **keep entirely.** It is a complete, working `/api/judge` client and it is the fallback seam. Only its gating role changes.
- `public/tools.jar` plus `public/NOTICE-tools-jar.txt` — see the open item in section 6. `tools.jar` exists only in JDK 8 distributions (JDK 9+ moved the compiler into the `jdk.compiler` module), so it must come from an OpenJDK 8 build, and it is worth spiking whether CheerpJ's Java 11/17 runtime resolves `com.sun.tools.javac.Main` on its own, which would delete this 18 MB entirely.
- `README.md` — the required CheerpJ credit, plus a note that forks redistributing this app take their own license position on the CheerpJ runtime.

**Flag handling, precisely**

- **Server, `JUDGE_PROVIDER`: unchanged, stays `none`.** `src/app/api/judge/route.ts:112-113` keeps returning `judge-absent`, no JVM ever runs on Vercel, and the whole provider branch stays intact for fallback B1.
- **Client, `NEXT_PUBLIC_JUDGE_PROVIDER`: stops gating Java.** Today `judgeProviderAbsent()` (`judge.ts:6-9`) returns true when it is unset or `none`; `useExerciseLoop.ts:140` then skips warmup and `useExerciseLoop.ts:447` sets `judgeAbsent`, which makes `exercise/[id]/page.tsx:62` replace Run and Submit with a not-available notice. Add one variable rather than deleting that machinery:

  ```
  NEXT_PUBLIC_JAVA_RUNTIME=cheerpj   # cheerpj | none
  ```

  `getRuntime('java')` returns `JavaAdapter` when this is `cheerpj` (the default) and `JudgeAdapter` otherwise. `judgeProviderAbsent()` becomes "Java has no runtime at all" — true only when `NEXT_PUBLIC_JAVA_RUNTIME` is `none` **and** `NEXT_PUBLIC_JUDGE_PROVIDER` is unset or `none`. The existing not-available notice and its test survive as a same-day production rollback, and nothing else in the exercise loop changes.

**`seed/courses.json`, INFS3102**

```diff
-      "runtime": "judge",
+      "runtime": "browser",
-      "status": "coming-soon",
-      "note": "Bank has only 3 verified exercises; the other 15 sit in seed/exercises/unverified/ until a Judge0 key certifies them. Flip back to live after C6 certifies the Java rows."
+      "status": "live",
+      "note": "Java compiles and runs in the browser via CheerpJ; see docs/research/java-without-judge.md."
```

`Course.runtime` is declared in `contracts.ts` and stored by `seed-load.mjs`, but no application code reads it — flipping it is data hygiene, not behaviour. `status` is what the dashboard reads, and it must not flip to `live` until the parked rows are certified.

**Certifying the parked exercises**

The real numbers, read from the file rather than the stale note: `seed/exercises/unverified/INFS3102.json` holds **18 rows — 16 `code`-kind exercises carrying 103 tests, plus 2 rows that duplicate the already-verified `predict-output` and `spot-the-bug` pair**. Every one of the 16 fixtures defines `class Main` and reads stdin with `Scanner`. `seed/exercises/INFS3102.json` holds the 2 verified answer-form rows, and `seed/exercises/smoke.json` holds one verified Java `code` exercise, "Shapes report".

`scripts/seed-load.mjs` reads only files directly inside `seed/exercises` (`readFolder` filters on `entry.isFile()`), so the `unverified/` subfolder is invisible to the loader. Promotion means merging certified rows into `seed/exercises/INFS3102.json`; ids are deterministic (`uuidv5(clo_id + '|' + title)`), so a promoted row upserts onto its own id and no duplicate appears. Drop the 2 duplicate answer-form rows during the merge rather than promoting them twice.

`scripts/verify-exercise.mjs` cannot drive a browser JVM: its `runJava` posts to Judge0 and, with no key, prints `absent` and skips. Two paths, run in this order:

*Path B first — local JDK, minutes, no network.* This machine already has `javac 25.0.2` and `java 25.0.2` on PATH. Extend `runJava` so that when `JUDGE_PROVIDER !== 'judge0'` and `javac` is available, it writes `buildJavaSource(referenceSolution, fixture)` to `Main.java` in a temp directory, runs `javac --release 17 Main.java`, then for each test runs `java -cp <dir> Main` with `test.input` on stdin under the existing 10 s timeout and compares trimmed stdout. `--release 17` matters: it pins the language level to what CheerpJ actually runs, so an exercise that accidentally uses a newer feature fails here instead of in a student's browser. This certifies the **exercises** — that the reference solutions genuinely produce the expected output across all 103 tests.

*Path A second — Playwright through the real adapter.* This certifies the **runtime** — that CheerpJ produces the same results the local JDK does. Add a development-only page (rendered only when `process.env.NODE_ENV !== 'production'`) that reads a bank injected by `page.addInitScript`, runs each exercise's `referenceSolution` through `getRuntime('java')` against its real tests, and publishes results on `window`. A spec under `e2e/` drives it against `npm run dev`, writes a pass/fail table plus per-exercise compile and run timings, and fails the run if any exercise disagrees with Path B. Playwright is already configured (`playwright.config.ts`, chromium, 120 s timeout, `AGENT_DRY_RUN=true`), so this is a new spec, not new infrastructure. Only after Path A is green does INFS3102 flip to `live`.

## 4. The structural-grading complement

This is not an alternative runtime. It closes a hole that no runtime closes.

**The hole, measured.** All 16 parked `code` exercises are graded by a `Main.java` fixture that reads stdin and calls exactly one static method on `Solution`, comparing stdout. The fixture never references `Employee`, `Manager`, `Vehicle`, `Playlist`, `Shape` or any other class the exercise is meant to teach. A submission that flattens "Payroll bonus total" into one `if/else` chain on role strings — no `Employee` class, no inheritance, no override — passes every hidden test identically to the intended abstract-class-with-dispatch solution. A working JVM does not fix that. Only reading the code's structure does.

**Coverage by outcome**

| Outcome | Structural check covers | Still needs execution |
|---|---|---|
| Encapsulation | Almost entirely — "no public fields, state reached only through methods" is a modifier read | Nothing meaningful |
| Interfaces | Mostly — interface declares, class implements and defines every member | Return values |
| UML to code | Almost entirely — classes, fields, associations, multiplicities, generalization | Rarely any output to run |
| Exceptions | Declaration shape: `extends RuntimeException`, `throws X`, `catch (X)` | Whether it throws under the right condition |
| Streams | **Only** structure can enforce "use the stream API, not a hand-rolled loop" — stdout can never see the difference | Pipeline results |
| Design patterns | Shape: private constructor plus static accessor; a context field typed to the strategy interface; a factory returning a supertype | Whether the wiring actually delegates |
| Classes, static, inheritance, polymorphism, collections | Shape only | Behaviour — keep the stdout tests |

**Test JSON shape.** Carry the assertion as JSON in `TestCase.expected`, exactly as `spot-the-bug`, `trace` and `schema` already do, with a sentinel in `input` so the grader can tell it apart from an execution test. For "Shapes report":

```json
{
  "id": "s1",
  "input": "__structure__",
  "hidden": false,
  "name": "shape hierarchy",
  "expected": "{\"require\":[{\"class\":\"Shape\",\"isAbstract\":true,\"methods\":[{\"name\":\"area\",\"isAbstract\":true}]},{\"class\":\"Circle\",\"extends\":\"Shape\",\"overrides\":[\"area\"]},{\"class\":\"Square\",\"extends\":\"Shape\",\"overrides\":[\"area\"]}],\"forbid\":[{\"class\":\"Solution\",\"methodBodyMatches\":\"Math\\\\.PI\"}]}"
}
```

The `forbid` clause is the half that actually bites: it fails the flattened submission that computes the circle's area directly inside `Solution` instead of delegating to a `Circle`. Write assertions loosely enough to admit equivalent valid designs — over-literal assertions turn this into a stricter version of the stdout problem rather than a fix for it.

**Parser.** Use `web-tree-sitter` 0.27.0 (MIT) with the **official** `tree-sitter-java` 0.23.5 (MIT), which ships its own prebuilt grammar and a `queries/` directory. Real footprint: `web-tree-sitter.wasm` 209,613 B plus JS glue 156,132 B plus `tree-sitter-java.wasm` 414,641 B equals **780,386 B (762 KiB)**, self-hosted from `public/` — an order of magnitude under Pyodide, and unlike Pyodide it is not a third-party fetch. Do **not** pull the `tree-sitter-wasms` community bundle: it drags roughly 51.8 MB of every-language grammars into `node_modules` to obtain one. The alternative, `java-parser` 3.0.1 (Apache-2.0), is genuinely good — it ships typed CST nodes per Java production in `api.d.ts`, and its grammar tracks Java 21 including preview features — but it pins `chevrotain` 11.0.3 (1,347,066 B unpacked) plus six sub-packages, which is heavier than the entire tree-sitter route. Load whichever is chosen lazily, only when a Java course is active.

**Mapping onto existing kinds.** Do **not** reuse `kind: 'schema'`. Its only implementation (`sql-engine.ts`) means "execute the student's DDL for real, then introspect", an invariant `sql.test.ts` encodes, and both `grading.ts:4` and `useExerciseLoop.ts:98,141,150` hard-route `kind === 'schema'` to the SQL runtime. Two honest options:

- **This week:** no new kind. Add `src/lib/exercise/structure.ts`, and have `submit` run structural tests (those whose `input` is `__structure__`) before handing the rest to the runtime; a structural failure short-circuits with `failureKind: 'wrong-answer'` and its own message. Existing `code` exercises simply gain extra tests. No contract change, no migration, no UI change.
- **Properly, later:** add a sixth `ExerciseKind`, `'design'`. The database does not object — `supabase/migrations/0001_init.sql:35` declares `kind text not null` with no CHECK and no enum, so no migration is needed. The touchpoints are the type in `contracts.ts`, `grading.ts`, `useExerciseLoop.ts` (3 sites), `exercise/[id]/page.tsx` (3 sites), `PromptPanel.tsx`, `ResultsPanel.tsx`, `bank.ts`, the zod enum at `author.ts:45`, `seed/validate.mjs`, and `scripts/verify-exercise.mjs`.

Prior art worth borrowing vocabulary from, none of it usable as-is: a fluent architecture-rule library expresses exactly these assertions but runs on the JVM over compiled bytecode; the closest working autograder combined unit tests with parse-tree analysis but was archived in July 2025 and its README now states it is no longer developed; the canonical execution-free design-pattern detector (IEEE TSE 32(11), 2006) scores subgraph similarity against per-pattern template graphs, which is the right mental model for the `require` and `forbid` shape above.

## 5. The spike, and the fallback if it fails

**Spike name: `e2e/java-runtime.spec.ts` — "Shapes report smoke".** One Playwright page, one exercise, one afternoon.

What it does:

1. Load the dev harness page; call `getRuntime('java').warmup()`; record wall-clock warmup ms and total transfer size from the network log.
2. Take the Java exercise in `seed/exercises/smoke.json`, "Shapes report" (`INFS3102-3`, pattern `inheritance-dispatch`, abstract `Shape` with `Circle` and `Square`), and run its `referenceSolution` against all five of its tests through the adapter.
3. Assert 5/5 pass, and record: compile ms (first test), per-test run ms for tests 2 through 5, total ms.
4. Submit a deliberately broken source (`return "";` with a missing brace) and assert every result carries `failureKind: 'compile-error'` with real javac diagnostics in `stderr`.
5. Submit `while (true) {}` inside `describe` and assert the test resolves as `timeout` within its budget, that the standby takes over, and that the next submission still passes.
6. Repeat step 2 in Firefox as well as Chromium, because the one known worker bug (`cheerpj-meta#192`) was Chromium-only.

Pass criteria: 5/5 correct; compile under 20 s; each subsequent test under 5 s; compile errors mapped; timeout recovers. If warmup exceeds roughly 30 s, or per-test run time exceeds 5 s on a normal connection, the runtime is not shippable as-is — try `preloadResources` and a lazy standby, then re-measure once before falling back.

**Fallbacks, in order.**

1. **The Worker fails but everything else works** (the Chromium `requestAnimationFrame` bug, or any other DOM dependency): move CheerpJ into a same-origin sandboxed iframe, reusing the frame lifecycle already written in `web.ts` and `web-frame.ts` — create, `postMessage`, terminate by removing the element, keep a standby frame. That frame's CSP must allow `script-src https://cjrtnc.leaningtech.com` plus connections to it and to our own origin, which is a different policy from `web-frame.ts`'s `default-src 'none'`. Cost: about a day.
2. **CheerpJ fails outright, or the licensing answer comes back wrong:** ship Java as a **structural-only** course. Section 4 needs no JVM. The 2 answer-form exercises stay live, the 16 `code` rows stay parked, and INFS3102 goes live with design-style content instead of execution. This is the only fallback that costs nothing and needs nobody's permission.
3. **Execution is required and must leave the browser:** Vercel Sandbox behind the existing seam. Set `JUDGE_PROVIDER=vercel-sandbox`, add a provider branch in `src/app/api/judge/route.ts` beside `runJudge0`, boot a JDK image from the container registry, and set `NEXT_PUBLIC_JUDGE_PROVIDER` so the client `JudgeAdapter` re-enables. Design around the published free-plan limits: 10 concurrent sandboxes and 5,000 creations per month means **one sandbox per submission running all of its tests**, never one per test. Do not use Vercel Container Images for this — student code would run inside our own function, able to read our Supabase keys.
4. **Last resort:** a small VPS runner. If it is Piston, raise `PISTON_RUN_TIMEOUT` — its default 3000 ms run cap sits **below** our 5-second-per-test contract — and accept operating a privileged container that executes untrusted code, behind authentication and per-user rate limits designed in from the start rather than added after abuse.
5. **Curiosity, not a plan:** `teavm-javac` bundles OpenJDK's javac into a 4,126,432-byte wasm module (a tenth of CheerpJ plus `tools.jar`), is Apache-2.0 with no CDN condition, and was pushed as recently as 2026-09-04 — but it has 84 stars, no benchmarks and no production use. Worth an hour only if CheerpJ's licensing answer is a no.

## 6. Risks and open items

| # | Item | Why it matters | Owner | Resolve by |
|---|---|---|---|---|
| 1 | **Get written confirmation that this project qualifies for the free Community License.** The free tier excludes "any business use (with exception of one-person companies)" and disallows redistribution and OEM use; the product carries a company brand, so the qualification rests on the FOSS bullet. The academic route ("free or heavily-discounted licenses for classroom") is the documented fallback | Legal exposure across the whole recommendation | Musa | Before public launch; the spike proceeds meanwhile |
| 2 | **Source a JDK 8 `tools.jar` and license it correctly.** JDK 9+ has no `tools.jar`; it must come from an OpenJDK 8 build. It is GPLv2 with Classpath Exception inside an MIT repo, needs a NOTICE, and at 18.3 MB should be fetched at install time rather than committed. **First check whether CheerpJ's Java 11/17 runtime resolves `com.sun.tools.javac.Main` without it** — that would remove the file, the 18 MB, and this entire row | Blocks compilation; it is 18 MB of the 28-38 MB budget | Musa | Day one of the spike |
| 3 | **No published cold-start figure exists.** The vendor gives no seconds, and runtime resources are fetched sequentially by default | If warmup takes tens of seconds the course is unusable | Astra | The spike measures it |
| 4 | **Worker reliability is the least-travelled path.** CheerpJ's centre of gravity is main-thread Swing and AWT; DOM access is unsupported in workers, and `cheerpj-meta#192` shows a Chromium worker failure closed with no visible fix | Decides Worker versus iframe | Astra | The spike, in both Chromium and Firefox |
| 5 | **Two warm JVMs.** `warmup()` prepares active *and* standby. Two CheerpJ instances is real memory on a student laptop | May force a lazy standby, which weakens infinite-loop recovery on the first submission | Astra | The spike records memory |
| 6 | **`System.exit` semantics are unspecified** under CheerpJ. The bootstrap avoids it and writes status to a file; confirm that a student's own `System.exit(0)` does not tear down the shared JVM for later tests | A single call in student code could poison the worker | Astra | The spike, as a sixth case |
| 7 | **CDN dependency.** The free tier is contractually locked to the vendor CDN, so every Java run depends on a third party's uptime, and it cannot be mirrored or cached without a paid license | Offline use and outage resilience | Musa | Accepted risk; document it |
| 8 | **16 exercises, 103 tests, never executed anywhere.** They were authored against a judge that no longer exists | The course cannot go live on unverified content | Claude (fix failures) / Astra (verifier paths) | Path B this week, Path A before the flip |
| 9 | **Structural blindness persists regardless of runtime.** All 16 `code` exercises can be passed with no classes at all | The course would teach object-oriented design and grade procedural code | Claude | Section 4, in parallel |
| 10 | **`browserTimeout`'s 5000 ms cap must not be raised** to accommodate compilation | It would silently loosen the timeout guarantee for Python, JS, SQL, Mongo and web | Astra | Code review of the `deadlineMs` hook |
| 11 | **Java 21 is not supported** by CheerpJ 4.3, and LTS parity has no published date | Records and modern pattern matching are unavailable; nothing in the launch syllabus needs them | Claude | Keep exercise authoring at Java 17 |

## 7. Sources

https://cheerpj.com/docs/licensing.html
https://cheerpj.com/licensing/
https://cheerpj.com/docs/changelog
https://cheerpj.com/docs/faq
https://cheerpj.com/docs/reference/cheerpjInit.html
https://cheerpj.com/docs/reference/cheerpjRunMain.html
https://cheerpj.com/docs/reference/cheerpOSAddStringFile.html
https://cheerpj.com/docs/reference/cjFileBlob.html
https://cheerpj.com/docs/guides/filesystem.html
https://cheerpj.com/docs/guides/basic-server-setup.html
https://cheerpj.com/docs/guides/Startup-time-optimization.html
https://cheerpj.com/docs/migrating-from-cheerpj2
https://cheerpj.com/compatibility/
https://labs.leaningtech.com/blog/cheerpj-3-deep-dive
https://labs.leaningtech.com/blog/cheerpj-30rc2
https://cjrtnc.leaningtech.com/4.3/loader.js
https://cjrtnc.leaningtech.com/4.3/cj3.js
https://cjrtnc.leaningtech.com/4.3/cj3.wasm
https://github.com/leaningtech/javafiddle
https://raw.githubusercontent.com/leaningtech/javafiddle/main/src/lib/CheerpJ.svelte
https://javafiddle.leaningtech.com/tools.jar
https://github.com/leaningtech/cheerpj-meta/issues/192
https://github.com/konsoletyper/teavm-javac
https://teavm.org/
https://teavm.org/playground/compiler.wasm
https://mirkosertic.github.io/Bytecoder/
https://github.com/i-net-software/JWebAssembly
https://github.com/plasma-umass/doppio/commits/master
https://github.com/plasma-umass/doppio/issues/299
https://vercel.com/docs/functions/runtimes
https://vercel.com/docs/functions/container-images
https://vercel.com/docs/container-registry/limits-and-pricing
https://vercel.com/docs/sandbox
https://vercel.com/docs/sandbox/pricing
https://github.com/orgs/supabase/discussions/36800
https://github.com/engineer-man/piston
https://raw.githubusercontent.com/engineer-man/piston/master/readme.md
https://raw.githubusercontent.com/engineer-man/piston/master/docker-compose.yaml
https://raw.githubusercontent.com/engineer-man/piston/master/docs/configuration.md
https://github.com/engineer-man/piston/issues/745
https://fly.io/docs/about/pricing/
https://fly.io/docs/reference/suspend-resume/
https://docs.cloud.google.com/run/docs/configuring/execution-environments
https://docs.cloud.google.com/free/docs/free-cloud-features
https://aws.amazon.com/lambda/pricing/
https://aws.amazon.com/blogs/aws/run-isolated-sandboxes-with-full-lifecycle-control-aws-lambda-introduces-microvms/
https://aws.amazon.com/about-aws/whats-new/2025/11/aws-lambda-java-25/
https://www.hetzner.com/news/new-cx-plans/
https://www.digitalocean.com/pricing/droplets
https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/
https://wandbox.org/api/list.json
https://github.com/melpon/wandbox
https://glot.io/
https://github.com/prasmussen/glot-run2
https://sphere-engine.com/pricing
https://onecompiler.com/apis/pricing
https://www.jdoodle.com/docs/compiler-apis/jdoodle-api-quickstart/rest-apis/
https://www.w3schools.com/java/java_compiler.asp
https://registry.npmjs.org/web-tree-sitter/latest
https://unpkg.com/web-tree-sitter@0.27.0/?meta
https://registry.npmjs.org/tree-sitter-java/latest
https://unpkg.com/tree-sitter-java@0.23.5/?meta
https://registry.npmjs.org/java-parser/3.0.1
https://unpkg.com/java-parser@3.0.1/api.d.ts
https://raw.githubusercontent.com/jhipster/prettier-java/main/CHANGELOG.md
https://registry.npmjs.org/chevrotain/11.0.3
https://registry.npmjs.org/java-ast
https://github.com/mazko/jsjavaparser
https://www.archunit.org/userguide/html/000_Index.html
https://github.com/jacquard-autograder/jacquard
https://web-cat.org/
https://onlinelibrary.wiley.com/doi/abs/10.1002/cae.22464
https://dl.acm.org/doi/10.1109/TSE.2006.112
https://github.com/umple/umple
https://dl.acm.org/doi/10.1145/3636515
