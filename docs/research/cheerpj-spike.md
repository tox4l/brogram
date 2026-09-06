# CheerpJ in-browser Java spike — results

Spike record, 2026-09-06. Follows the recommendation in `docs/research/java-without-judge.md` section 5 ("Shapes report smoke"), scoped to the exercise described there: the fixture-plus-reference-solution combination in `seed/exercises/smoke.json` (`INFS3102-3`, "Shapes report"), compiled and run five times through a real in-browser `javac`. This is a narrower run than the doc's full six-case spike (no broken-source, no infinite-loop, no cross-browser pass) — see "Not covered" below.

## What was built

- `public/spikes/cheerpj/index.html` — a standalone page (no framework, no build step) that loads the CheerpJ 4.3 loader from the vendor CDN, calls `cheerpjInit` on the main thread, writes `Main.java` (the fixture) and `Solution.java` (the reference solution) plus a small `Runner.java` bootstrap to the CheerpJ virtual filesystem, compiles all three with `com.sun.tools.javac.Main` against `tools.jar`, then runs `Runner` once per test to feed stdin and capture stdout. Results are exposed on `window.__spike` and rendered as a table.
- `public/spikes/cheerpj/tools.jar` — self-hosted, **not committed** (see `.gitignore`).
- `e2e/spikes/cheerpj.spec.ts` — a Playwright spec that loads the page twice in the same browser context (cold cache, then warm cache), waits for `window.__spike.done`, and logs timings, pass count, network byte totals, and the full browser console. It asserts only that the page reported (`spike.done === true`), nothing about pass/fail correctness, per the task.
- `playwright.config.ts` — added `testIgnore: process.env.RUN_SPIKES ? undefined : '**/spikes/**'`. Playwright applies `testIgnore` at file-discovery time, *before* CLI file-path filtering, so an ignored file cannot be re-selected by naming it on the command line (confirmed empirically: `npx playwright test e2e/spikes/cheerpj.spec.ts` returned "No tests found" while `testIgnore` was unconditional). The `RUN_SPIKES` env var lifts the exclusion for an explicit run and leaves the normal suite (`npx playwright test`, no env var) unaffected — verified with `--list` before and after.
- `.gitignore` — added `public/spikes/cheerpj/tools.jar`.

### The runner design (how stdin/stdout capture actually worked)

The research doc's plan (section 3.3–3.4) was an in-JVM bootstrap class that swaps `System.in`/`System.out` around the student's `main`, because CheerpJ documents no stdin API and a Worker has no DOM to watch for output. That is exactly what `Runner.java` does here:

```java
System.setIn(new FileInputStream(stdinPath));
System.setOut(new PrintStream(buf, true, "UTF-8"));
Main.main(new String[0]);
```

`Main.java`'s `Scanner in = new Scanner(System.in)` picked up the redirected stream with no changes to the fixture — confirming the doc's claim that none of the 16 parked fixtures need to change.

## Exact commands

Download and extract `tools.jar` (Adoptium Temurin, official GitHub releases; Linux x64 tarball chosen only because it was simpler to extract one entry from `tar` than `unzip` in this shell — the JDK's host platform is irrelevant, `tools.jar` is pure bytecode):

```
curl -sSL -o temurin8.tar.gz \
  https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u504-b01/OpenJDK8U-jdk_x64_linux_hotspot_8u504b01.tar.gz
tar -xzf temurin8.tar.gz --wildcards '*/lib/tools.jar'
cp jdk8u504-b01/lib/tools.jar public/spikes/cheerpj/tools.jar
```

- Download size: **103,542,511 bytes** (full JDK tarball).
- Extracted `tools.jar`: **18,361,919 bytes** (17.51 MiB), sha256 `f2599fc78dcbfadefc1cb6b79e05d281e090217ac0139d50b792d72bf1130af4`. (The research doc cites 18,307,716 B for a different Temurin 8 patch build; the ~54 KB difference is just a newer point release, `8u504-b01` vs whatever build the doc's live check hit — same artifact, same license, same role.)

Run the spike (dev server was already running on `127.0.0.1:3000`; `PLAYWRIGHT_BASE_URL` points Playwright at it instead of trying to start a second one on the same port):

```
RUN_SPIKES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
  npx playwright test e2e/spikes/cheerpj.spec.ts --config playwright.config.ts --project=chromium
```

## Numbers

| Metric | Cold (first `page.goto`) | Warm (second `page.goto`, same context) |
|---|---:|---:|
| `cheerpjInit` time | 382 ms | 29 ms |
| Compile time (javac, all 3 sources) | 5,978 ms | 2,713 ms |
| Run t1 (`square 2` → `square:4.0`) | 877 ms | 561 ms |
| Run t2 (`circle 1` → `circle:3.1`) | 529 ms | 495 ms |
| Run t3 (`triangle 3` → `unknown`) | 511 ms | 488 ms |
| Run t4 (`square 0` → `square:0.0`) | 533 ms | 526 ms |
| Run t5 (`circle 2.5` → `circle:19.6`) | 517 ms | 522 ms |
| Total page time (`__spike.totalMs`) | 9,355 ms | 5,337 ms |
| **Pass count** | **5 / 5** | **5 / 5** |

Network, first load (170 responses total on the page):

| Item | Bytes |
|---|---:|
| CheerpJ runtime (`cjrtnc.leaningtech.com/4.3/*`) | 18,476,956 (~17.62 MiB) |
| `tools.jar` actually transferred (our origin) | 6,434,368 (~6.13 MiB) — **not** the full 18.36 MiB file |
| **Total transferred** | **24,920,883 (~23.77 MiB)** |

`tools.jar` transferring only ~6.1 of its 18.36 MiB confirms the doc's server requirement note: the origin must support Range requests, and CheerpJ uses them — it reads the ZIP central directory and pulls only the compiler class entries `com.sun.tools.javac.Main` actually needs, not the whole archive. That puts the real first-load number for this one exercise at **~23.8 MB**, better than the doc's 28–38 MB estimate (which assumed the full jar transfers). Cold vs warm byte totals were identical (same resources, same sizes) — cache warmth showed up in latency (`initMs`, compile time), not bytes, which is expected.

## What did not work, and what fixed it

Three real problems surfaced, none of them the ones flagged as top risks in the research doc (Worker reliability, `System.exit`) — this spike ran on the main thread and never got far enough to test those:

1. **`cheerpOSAddStringFile` cannot create subdirectories.** Writing to `/files/cheerpj-spike/anything` threw `CheerpOS: Directories are not supported` in the console (not a thrown JS exception — it logs and silently no-ops, which is why the *next* call, reading the file back, failed instead with a confusing `Cannot read properties of null`). Fix: every JS-written path must be a flat entry directly under a mount root (`/str/foo.txt`, `/files/foo.txt`), never `/files/sub/foo.txt`. This is a real constraint the `cheerpj-engine.ts` sketch in the research doc needs to account for — its `dir = "/files/" + argv[1]` pattern (a per-submission subdirectory keyed by a content hash) will hit exactly this bug if any file inside that directory is written via `cheerpOSAddStringFile` from JavaScript rather than by Java's own file I/O. javac itself, running as Java code, **does** appear to manage its own directories fine via real `java.io.File` — the limitation is specific to the JS-side convenience function, not the virtual filesystem itself.

2. **`javac -d <dir>` requires the target directory to already exist** (ordinary javac behavior, not CheerpJ-specific) — combined with #1, there was no way to pre-create a nested output directory from JavaScript. Fix used here: compile with `-d /files` (the mount root, flat, already exists) instead of a per-run subdirectory. A real implementation needs a different cache-key strategy than the doc's `/files/<hash>/` layout — either a flat naming scheme (`/files/<hash>-Main.class` is not legal for a class file, so more likely: one shared compile directory, cleared or reused per submission, since only one submission compiles at a time per worker anyway) or proof that Java-side directory creation (`new File(...).mkdirs()` called from inside a bootstrap class, not from JS) works around it — untested here, time-boxed out.

3. **`cheerpjInit({ version: 17, ... })` broke `javac` outright**: every compile attempt crashed with `java.lang.NullPointerException` inside `com.sun.tools.javac.file.Locations.getPathEntries` → `BootClassPathLocationHandler.computePath`. This is `tools.jar`'s JDK8 compiler trying to resolve the classic pre-module boot classpath, which a Java 17 runtime (module system, no boot classpath) doesn't provide the way it expects. **`cheerpjInit({ version: 8, ... })` fixed it immediately** — compile succeeded, all 5 tests passed. This directly contradicts the research doc's engine sketch (`cheerpjInit({ version: 17, status: 'none' })` in `cheerpj.worker.ts`) and is the single most important correction from this spike: **the compile step needs a Java 8 CheerpJ context, not 17.** One `cheerpjInit` call was used for both compiling and running in this spike (compile and all five runs succeeded under the same `version: 8` instance), so a dual-runtime setup does not appear to be necessary — but this also means the achievable **source language level is capped at whatever `tools.jar`'s own javac accepts, which is Java 8**, not 17 as the doc assumed for the runtime. JDK 8's `javac` predates the `--release` flag entirely (added in JDK 9) and only ever supported `-source`/`-target` up to `8`. The doc's Java-17-feature list (interfaces with default methods, streams, generics, collections) is all present in Java 8, so the launch syllabus is very likely unaffected in practice — but anything relying on `var` (Java 10), records (16), sealed classes/pattern matching (17), or text blocks (15) cannot compile through this path at all, regardless of which `cheerpjInit` version runs the resulting bytecode. This needs a decision from whoever owns the runtime design (Astra, per the doc's risk table) before exercises are authored assuming Java 17 syntax.

## Stdin capture

**Worked.** All five tests read `kind` and `a` via `Scanner(System.in).next()` / `.nextDouble()` inside the unmodified fixture `Main.java`, fed through the `Runner.java` bootstrap's `System.setIn(new FileInputStream(stdinPath))`. No CheerpJ-documented stdin API was needed or used — the in-JVM runner approach from the research doc's section 3.3 is what made this work, exactly as designed.

## Not covered by this run (time-boxed out)

Per the narrower task scope (five "Shapes report" tests only), this spike did not exercise the research doc's full six-case list:
- Broken source → `failureKind: 'compile-error'` with real javac diagnostics (very likely to work — javac's own error text is what's captured in `RUNNER_JAVA`'s error path/the doc's `diag.txt` pattern — but not run here).
- `while (true) {}` timeout, standby takeover, recovery on the next submission.
- `System.exit(0)` semantics inside student code (doc risk #6 — genuinely unknown).
- Cross-browser (Firefox) run, relevant to the one known Worker bug (`cheerpj-meta#192`, Chromium-only).
- Running inside an actual Web Worker at all — this spike ran on the main thread, as the task explicitly allowed ("main thread is fine for the spike").

**Worker support is documented** (research doc section 3.2: available since CheerpJ 3.0rc2 via plain `importScripts`, `CheerpJWorker` class removed; DOM access unsupported inside a worker; one closed-with-no-fix Chromium-only bug, `cheerpj-meta#192`, about `requestAnimationFrame`). Nothing in this spike depended on `requestAnimationFrame` or any DOM API from inside the compile/run path — the runner's I/O capture is pure `java.io`, which is exactly why the doc designed it that way — so there's no new evidence for or against that bug here.

## Verdict: **GO**, with two corrections to carry into the real adapter

Against the `RuntimeAdapter` contract (5 s per-test budget; compile budget separate, doc proposes 20 s):

- Compile: 5,978 ms cold / 2,713 ms warm — well inside a 20 s compile budget.
- Per-test run: 488–877 ms — well inside the 5 s per-test budget, with roughly 4-10x headroom.
- 5/5 tests passed with byte-identical output to the expected values in `seed/exercises/smoke.json`.
- First-load network cost: ~23.8 MB (better than the doc's 28-38 MB estimate, because `tools.jar` is range-fetched, not downloaded whole).

This clears every number the doc's pass criteria asked for. The **GO** carries two required corrections to the doc's design before real implementation:

1. Initialize CheerpJ with `{ version: 8, ... }`, not `17` — `version: 17` makes `javac` crash on every compile.
2. Do not key compiled output by a per-submission subdirectory (`/files/<hash>/...`) written from JavaScript — `cheerpOSAddStringFile` cannot create directories. Either write everything flat under `/files`, or verify separately that Java-side `mkdirs()` (called from inside a compiled bootstrap class, not from the JS host) can create the nested directory the doc's design wants.

Also worth carrying forward: because `tools.jar` is genuinely a JDK 8 compiler binary, exercises should be authored and verified against Java 8 language syntax, not Java 17, until someone re-spikes whether a newer `tools.jar`-equivalent (there isn't one — JDK 9+ has no `tools.jar`) or a different compile path can raise the ceiling.

## Licensing note

- **CheerpJ runtime**: loaded at runtime from `https://cjrtnc.leaningtech.com/4.3/loader.js`, the vendor's own CDN, never self-hosted or vendored into this repo — required by the free Community License (self-hosting the runtime needs the Commercial License). Confirmed live: `HEAD https://cjrtnc.leaningtech.com/4.3/loader.js` → `200`, matching the research doc's live check.
- **`tools.jar`**: OpenJDK 8's compiler, GPLv2 with the Classpath Exception — a different, more permissive-for-linking license than this repo's MIT. Self-hosted at `public/spikes/cheerpj/tools.jar`, downloaded from Adoptium's official Temurin 8 GitHub releases (`adoptium/temurin8-binaries`), **not committed** (`.gitignore` excludes it; an 18 MB GPLv2+CE binary has no place in an MIT git history). Confirmed live: `HEAD https://cjrtnc.leaningtech.com/4.3/tools.jar` → `204 No Content`, byte-identical to a bogus path — the vendor CDN genuinely does not serve it, exactly as the research doc found.
- Neither check nor this spike resolves the doc's open item #1 (written confirmation that BroGram qualifies for the free Community License) — that remains Musa's item, unaffected by anything found here.
