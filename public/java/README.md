# The browser Java runtime's assets

Java is the one language BroGram cannot run with a plain WebAssembly
interpreter: a submission has to be *compiled* first. It runs entirely in the
browser anyway, which takes two independent pieces with two different licenses.
Neither one is committed here except the small tree-sitter grammars.

## 1. The JVM: CheerpJ 4.3 — loaded from the vendor CDN, never self-hosted

`src/lib/runtimes/java.worker.ts` loads
`https://cjrtnc.leaningtech.com/4.3/loader.js` with `importScripts` inside a Web
Worker and initializes it with `cheerpjInit({ version: 8, status: 'none' })`.

- **Version 8, not 17.** `tools.jar` is JDK 8's compiler and it throws a
  `NullPointerException` resolving a boot classpath that a Java 17 runtime does
  not provide. This also caps the accepted source level at Java 8, so exercises
  must avoid `var`, records, sealed classes and text blocks. See
  `docs/research/cheerpj-spike.md`.
- **Licensing condition.** CheerpJ's free Community License requires the runtime
  to be loaded from Leaning Technologies' own CDN. It is never copied into this
  repository, never bundled, and never re-served from our origin. Self-hosting it
  would require the Commercial License. Nothing under `public/java/` is a copy of
  the CheerpJ runtime. See <https://cheerpj.com/docs/licensing>.
- The runtime is roughly 18 MB on a cold first load and then browser-cached.

## 2. The compiler: `tools.jar` — self-hosted, GPLv2 with the Classpath Exception

CheerpJ can run the real OpenJDK `javac` as an ordinary Java program, but the
vendor CDN does not serve `tools.jar` (a `HEAD` for it returns `204`), so it must
come from our own origin at `/java/tools.jar`.

- Prepared by `scripts/fetch-java-tools.mjs` (`npm run prepare:java`, also run
  from `postinstall`), which extracts it from Adoptium's official Temurin 8
  release and verifies its size and sha256.
- **Not committed.** It is 18 MB of GPLv2+CE binary and has no place in an MIT
  git history; `.gitignore` excludes it. The notice that must travel with it is
  `TOOLS-JAR-LICENSE.md`, next to this file.
- Only about 6 MB of it actually crosses the wire: CheerpJ reads the jar's
  central directory and range-requests the compiler classes `javac` touches, so
  the origin serving it must support HTTP Range requests.

## 3. Structural grading: tree-sitter — MIT, committed

`web-tree-sitter.wasm` (the tree-sitter runtime) and `tree-sitter-java.wasm` (the
Java grammar) back `src/lib/runtimes/java-structure.ts`, which checks the *shape*
of a submission — that `Circle` really does extend an abstract `Shape` — instead
of only its output. Both are MIT-licensed and copied out of `node_modules` by
`scripts/fetch-java-tools.mjs`, the same way `public/sql-wasm.wasm` is copied.
They are committed because they are small and the app needs them at runtime.

## If `tools.jar` is missing

`npm install` never fails over it: the fetch script warns and moves on when it
cannot download. The runtime then fails its warmup with a message naming
`/java/tools.jar`, and only Java exercises are affected. Re-run
`npm run prepare:java` to fix it.
