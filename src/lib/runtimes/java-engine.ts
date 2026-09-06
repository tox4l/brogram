import type { RunRequest, TestCase } from '@/lib/contracts'
import type { RuntimeEngine } from './worker-host'
import type { ExecutionOutput } from './shared'
import { normalizeJavaSolution } from './java-normalize'
import { parseStructureAssertions, STRUCTURE_OK, type JavaStructureChecker } from './java-structure'

/**
 * The CheerpJ surface this engine needs, kept as a plain interface so unit
 * tests can stub a JVM and so the worker owns every global CheerpJ defines.
 */
export interface CheerpJHost {
  /** cheerpOSAddStringFile. Cannot create directories: every path must be flat under a mount root. */
  addStringFile(path: string, contents: string): void
  /** cheerpjRunMain. Its exit code is unreliable (an uncaught JVM exception still returns 0), so status files decide. */
  runMain(className: string, classPath: string, args: string[]): Promise<number>
  /** cjFileBlob, decoded. Null when the file does not exist. */
  readTextFile(path: string): Promise<string | null>
}

export interface JavaEngineOptions {
  loadCheerpJ(): Promise<CheerpJHost>
  loadStructureChecker(): Promise<JavaStructureChecker>
}

// tools.jar is served from this origin (public/java/tools.jar); CheerpJ mounts
// our web root at /app/. The runtime itself is loaded from the vendor CDN by the
// worker, which the CheerpJ Community License requires.
const TOOLS_JAR = '/app/java/tools.jar'
// /str is the flat, JavaScript-writable mount; /files is the writable mount Java
// reads and writes and cjFileBlob can read back. cheerpOSAddStringFile cannot
// create directories, so every JS-written path here is a direct child of /str.
const SOURCE_DIR = '/str'
const RUNNER_SOURCE = `${SOURCE_DIR}/Runner.java`
const MAIN_SOURCE = `${SOURCE_DIR}/Main.java`
const SOLUTION_SOURCE = `${SOURCE_DIR}/Solution.java`
const STDIN_FILE = `${SOURCE_DIR}/stdin.txt`
const RUNNER_DIR = '/files'
// Java's own mkdirs makes this one; the compiled student classes are wiped and
// rebuilt per submission so a previous exercise's classes can never be loaded.
const CLASS_DIR = '/files/classes'
const DIAGNOSTICS_FILE = '/files/javac.txt'
const STDOUT_FILE = '/files/stdout.txt'
const READY_FILE = '/files/ready.txt'
const CLASS_PATH = `${TOOLS_JAR}:${RUNNER_DIR}`

export const JAVA_PROGRESS = {
  engine: 'Waking up the Java engine',
  compiler: 'Fetching the compiler (18 MB, once)',
  ready: 'Compiler ready',
} as const

/**
 * The in-JVM bootstrap. It exists because a Worker has no DOM for CheerpJ to
 * print to and CheerpJ documents no stdin API: swapping System.in/out/err around
 * the student's entry point keeps all I/O inside Java, where it lands in files
 * JavaScript reads back with cjFileBlob. It also runs javac itself through
 * com.sun.tools.javac.Main.compile(args, PrintWriter) so compiler diagnostics
 * are captured instead of being written to a console nobody is watching.
 *
 * Each test loads the student's classes through a fresh URLClassLoader whose
 * parent is the extension loader, so static fields start empty every time
 * rather than leaking across the tests of one submission.
 */
const RUNNER_JAVA = `import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.security.Permission;

public class Runner {
    static class ExitTrap extends SecurityException {
        final int code;
        ExitTrap(int code) { super("System.exit was called with status " + code + "."); this.code = code; }
    }
    static class NoExit extends SecurityManager {
        public void checkPermission(Permission p) { }
        public void checkPermission(Permission p, Object context) { }
        public void checkExit(int status) { throw new ExitTrap(status); }
    }

    public static void main(String[] args) throws Exception {
        String mode = args[0];
        if (mode.equals("ready")) write(args[1], args[2]);
        else if (mode.equals("compile")) compile(args);
        else run(args);
    }

    private static void write(String path, String text) throws IOException {
        Writer w = new OutputStreamWriter(new FileOutputStream(path), "UTF-8");
        try { w.write(text); } finally { w.close(); }
    }

    private static void wipe(File target) {
        if (target.isDirectory()) {
            File[] kids = target.listFiles();
            if (kids != null) for (int i = 0; i < kids.length; i++) wipe(kids[i]);
        }
        target.delete();
    }

    private static void compile(String[] args) throws Exception {
        String classDir = args[1];
        String diagnostics = args[2];
        new File(diagnostics).delete();
        new File(diagnostics + ".status").delete();
        wipe(new File(classDir));
        new File(classDir).mkdirs();
        String[] javac = new String[args.length + 3];
        javac[0] = "-d"; javac[1] = classDir;
        javac[2] = "-classpath"; javac[3] = classDir;
        javac[4] = "-encoding"; javac[5] = "UTF-8";
        for (int i = 3; i < args.length; i++) javac[i + 3] = args[i];
        StringWriter captured = new StringWriter();
        PrintWriter writer = new PrintWriter(captured);
        int code;
        try {
            code = com.sun.tools.javac.Main.compile(javac, writer);
        } catch (Throwable failure) {
            code = 1;
            failure.printStackTrace(writer);
        }
        writer.flush();
        write(diagnostics, captured.toString());
        write(diagnostics + ".status", String.valueOf(code));
    }

    private static void run(String[] args) throws Exception {
        String classDir = args[1];
        String stdinPath = args[2];
        String stdoutPath = args[3];
        new File(stdoutPath).delete();
        new File(stdoutPath + ".err").delete();
        new File(stdoutPath + ".status").delete();
        InputStream in0 = System.in;
        PrintStream out0 = System.out;
        PrintStream err0 = System.err;
        ByteArrayOutputStream outBuffer = new ByteArrayOutputStream();
        ByteArrayOutputStream errBuffer = new ByteArrayOutputStream();
        PrintStream errStream = new PrintStream(errBuffer, true, "UTF-8");
        SecurityManager manager = System.getSecurityManager();
        boolean guarded = false;
        int status = 0;
        try {
            try { System.setSecurityManager(new NoExit()); guarded = true; } catch (Throwable ignored) { }
            System.setIn(new FileInputStream(stdinPath));
            System.setOut(new PrintStream(outBuffer, true, "UTF-8"));
            System.setErr(errStream);
            ClassLoader parent = Runner.class.getClassLoader().getParent();
            URLClassLoader loader = new URLClassLoader(new URL[] { new File(classDir).toURI().toURL() }, parent);
            Class<?> entry = Class.forName("Main", true, loader);
            entry.getMethod("main", String[].class).invoke(null, (Object) new String[0]);
        } catch (Throwable thrown) {
            Throwable cause = thrown;
            while (cause instanceof InvocationTargetException && cause.getCause() != null) cause = cause.getCause();
            if (cause instanceof ExitTrap) {
                if (((ExitTrap) cause).code != 0) { status = 1; errStream.println(cause.getMessage()); }
            } else {
                status = 1;
                cause.printStackTrace(errStream);
            }
        } finally {
            System.out.flush();
            System.err.flush();
            System.setIn(in0);
            System.setOut(out0);
            System.setErr(err0);
            if (guarded) { try { System.setSecurityManager(manager); } catch (Throwable ignored) { } }
        }
        write(stdoutPath, outBuffer.toString("UTF-8"));
        write(stdoutPath + ".err", errBuffer.toString("UTF-8"));
        write(stdoutPath + ".status", String.valueOf(status));
    }
}
`

interface JavaSource { path: string; contents: string }

/**
 * A fixture supplies Main.java and the student writes Solution; `public` is
 * stripped from `class Solution` by java-normalize so one convention covers both
 * this runtime and the server judge. Without a fixture the submission is the
 * whole program and becomes Main.java untouched.
 */
export function javaSourceSet(request: RunRequest): JavaSource[] {
  if (!request.fixture) return [{ path: MAIN_SOURCE, contents: request.code }]
  return [
    { path: MAIN_SOURCE, contents: request.fixture },
    { path: SOLUTION_SOURCE, contents: normalizeJavaSolution(request.code) },
  ]
}

/** Structural tests never compile or run; a run made only of them skips javac entirely. */
export function needsCompiler(tests: TestCase[]): boolean {
  return tests.length === 0 || tests.some(test => !parseStructureAssertions(test.input))
}

function compileFailure(stderr: string): ExecutionOutput {
  return { actual: '', stdout: '', stderr, failureKind: 'compile-error' }
}

export function createJavaEngine(options: JavaEngineOptions): RuntimeEngine {
  let host: CheerpJHost | undefined
  let checker: Promise<JavaStructureChecker> | undefined
  let compiled: { key: string; error: string | null } | undefined

  const structure = (): Promise<JavaStructureChecker> => (checker ??= options.loadStructureChecker())

  async function compileSources(request: RunRequest): Promise<void> {
    if (!host) throw new Error('The Java engine is not ready.')
    const sources = javaSourceSet(request)
    const key = sources.map(source => `${source.path}\n${source.contents}`).join('\0')
    if (compiled?.key === key) return
    compiled = undefined
    for (const source of sources) host.addStringFile(source.path, source.contents)
    await host.runMain('Runner', CLASS_PATH, ['compile', CLASS_DIR, DIAGNOSTICS_FILE, ...sources.map(source => source.path)])
    const status = await host.readTextFile(`${DIAGNOSTICS_FILE}.status`)
    const diagnostics = (await host.readTextFile(DIAGNOSTICS_FILE))?.trim() ?? ''
    if (status === null) {
      compiled = { key, error: diagnostics || 'The Java compiler stopped before it reported a result.' }
      return
    }
    compiled = { key, error: status.trim() === '0' ? null : diagnostics || 'The Java compiler rejected this code.' }
  }

  async function runOne(input: string): Promise<{ stdout: string; stderr: string; status: string | null }> {
    if (!host) throw new Error('The Java engine is not ready.')
    host.addStringFile(STDIN_FILE, input)
    await host.runMain('Runner', CLASS_PATH, ['run', CLASS_DIR, STDIN_FILE, STDOUT_FILE])
    // The status file is written last and deleted first, so its absence means
    // the JVM never finished - never that the program printed nothing.
    const status = await host.readTextFile(`${STDOUT_FILE}.status`)
    return {
      stdout: (await host.readTextFile(STDOUT_FILE)) ?? '',
      stderr: ((await host.readTextFile(`${STDOUT_FILE}.err`)) ?? '').trim(),
      status,
    }
  }

  return {
    async warmup(_packages, progress) {
      if (!host) {
        progress(JAVA_PROGRESS.engine)
        host = await options.loadCheerpJ()
      }
      progress(JAVA_PROGRESS.compiler)
      host.addStringFile(RUNNER_SOURCE, RUNNER_JAVA)
      // Compiling the bootstrap is what pulls tools.jar over the wire (CheerpJ
      // range-requests only the compiler classes javac touches) and leaves javac
      // warm, so the first submission does not pay the cold compile.
      await host.runMain('com.sun.tools.javac.Main', CLASS_PATH, [RUNNER_SOURCE, '-d', RUNNER_DIR])
      const token = `ready-${Date.now()}-${Math.random().toString(36).slice(2)}`
      await host.runMain('Runner', CLASS_PATH, ['ready', READY_FILE, token])
      if ((await host.readTextFile(READY_FILE))?.trim() !== token) {
        throw new Error('The Java compiler could not start. Check that /java/tools.jar is available on this origin.')
      }
      compiled = undefined
      progress(JAVA_PROGRESS.ready)
    },

    async compile(request) {
      if (!needsCompiler(request.tests)) return
      await compileSources(request)
    },

    async execute(request, test): Promise<ExecutionOutput> {
      const assertions = test ? parseStructureAssertions(test.input) : null
      if (assertions) {
        const result = (await structure()).check(request.code, assertions)
        return { actual: result.ok ? STRUCTURE_OK : result.failures.join(' '), stdout: '', stderr: result.ok ? '' : result.failures.join('\n') }
      }

      await compileSources(request)
      if (compiled?.error) return compileFailure(compiled.error)

      const { stdout, stderr, status } = await runOne(test?.input ?? '')
      if (status === null) return { actual: '', stdout, stderr: stderr || 'Java stopped before the program finished.', failureKind: 'runtime-error' }
      if (status.trim() !== '0') return { actual: '', stdout, stderr: stderr || 'The program threw an exception.', failureKind: 'runtime-error' }
      if (!test) return { actual: '', stdout, stderr }
      // Java exercises grade trimmed stdout against trimmed expected stdout; the
      // shared comparison is exact, so a pass reports the expected string back.
      const trimmed = stdout.trim()
      return { actual: trimmed === test.expected.trim() ? test.expected : trimmed, stdout, stderr }
    },
  }
}
