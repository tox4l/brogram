import type { RunRequest, TestCase } from '@/lib/contracts'
import type { RuntimeEngine } from './worker-host'
import type { ExecutionOutput } from './shared'
import { normalizeJavaSolution } from './java-normalize'
import { readStructureTest, STRUCTURE_OK, type JavaStructureChecker } from './java-structure'

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
// /str is the flat, JavaScript-writable mount CheerpJ builds from strings, and
// it belongs to one JVM instance. cheerpOSAddStringFile cannot create
// directories, so every path here is a direct child of /str - and Main.java has
// to keep that exact name, because javac requires the file holding `public class
// Main` to match it.
const SOURCE_DIR = '/str'
const MAIN_SOURCE = `${SOURCE_DIR}/Main.java`
const RUNNER_SOURCE = `${SOURCE_DIR}/Runner.java`
const STDIN_FILE = `${SOURCE_DIR}/stdin.txt`
// /files is IndexedDB-backed: persistent, writable, and shared by every tab and
// every worker on this origin. Nothing may live at a fixed path there - see
// javaSessionPaths.
const FILES_ROOT = '/files'

export const JAVA_PROGRESS = {
  // The 18 MB is the CheerpJ runtime itself, downloaded during cheerpjInit.
  engine: 'Waking up the Java engine (18 MB, once)',
  // javac only pulls the compiler classes it touches out of tools.jar, by range
  // request: about 6 MB of the 18 MB file.
  compiler: 'Fetching the compiler (6 MB, once)',
  ready: 'Compiler ready',
} as const

// Base36, zero-padded to a fixed width so two ids' timestamps compare
// correctly as plain strings (equal length, and base36's digit alphabet
// '0'-'9a'-'z' already sorts in numeric order). 9 digits covers dates past
// the year 5000; this is what lets a fresh worker's boot sweep tell a stale
// session directory from a live one without keeping a separate index.
const STAMP_WIDTH = 9

/** A Java-identifier-safe id, its own creation time (base36) followed by randomness; one per engine, so one per Worker. */
export function createSessionId(): string {
  const stamp = Date.now().toString(36).padStart(STAMP_WIDTH, '0').slice(-STAMP_WIDTH)
  const random = globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `${stamp}${random}`.replace(/[^a-zA-Z0-9]/g, '')
}

export interface JavaSessionPaths {
  id: string
  /** Everything this engine writes lives under here. */
  session: string
  classDir: string
  diagnostics: string
  stdout: string
  ready: string
  bootClass: string
  bootSource: string
  bootClassFile: string
  classPath: string
}

/**
 * Two JVMs are always live (active plus warm standby) and a second tab can run
 * at the same time, all sharing one persistent /files. Fixed paths there let one
 * run read another's ready token, compiled classes or captured stdout as if they
 * were its own, so every writable path is namespaced by a per-engine id.
 *
 * The bootstrap class file is the one thing that cannot live in the session
 * directory - JDK 8's javac refuses to create a missing `-d` directory
 * ("directory not found"), verified in Chromium - so it is written to the /files
 * root under a name unique to this session and deletes itself once it has made
 * the directory the rest of the run uses.
 */
export function javaSessionPaths(id = createSessionId()): JavaSessionPaths {
  const session = `${FILES_ROOT}/${id}`
  return {
    id,
    session,
    classDir: `${session}/classes`,
    diagnostics: `${session}/javac.txt`,
    stdout: `${session}/stdout.txt`,
    ready: `${session}/ready.txt`,
    bootClass: `Boot${id}`,
    bootSource: `${SOURCE_DIR}/Boot${id}.java`,
    bootClassFile: `${FILES_ROOT}/Boot${id}.class`,
    classPath: `${TOOLS_JAR}:${session}`,
  }
}

// A page that keeps one Java exercise open for less than this never has its
// own session directory swept out from under it by another tab's fresh
// worker; a session older than this is treated as abandoned. Generous on
// purpose - the risk this trades away is a rare, self-healing one (see
// sweep's caller), not a correctness guarantee.
const SESSION_SWEEP_AGE_MS = 60 * 60 * 1000

/** Makes the session directory, proves it can run compiled code, sweeps stale ones, then removes itself. */
function bootSource(className: string): string {
  return `import java.io.*;

public class ${className} {
    public static void main(String[] args) throws Exception {
        new File(args[0]).mkdirs();
        Writer w = new OutputStreamWriter(new FileOutputStream(args[1]), "UTF-8");
        try { w.write(args[2]); } finally { w.close(); }
        new File(args[3]).delete();
        // Best effort only: a page that has been open for a semester leaves
        // behind one directory per warmup, otherwise forever. Never allowed
        // to fail the boot that a student is waiting on.
        try { sweep(args[4], args[5]); } catch (Throwable ignored) { }
    }

    // Every session directory and every orphaned Boot*.class file starts
    // with the same fixed-width, base36 creation timestamp this class's own
    // name and directory just used, so plain string comparison against the
    // cutoff tells old from new without reading anything.
    private static void sweep(String root, String cutoff) {
        File[] entries = new File(root).listFiles();
        if (entries == null) return;
        for (File entry : entries) {
            String name = entry.getName();
            String stamp = null;
            if (entry.isDirectory() && name.length() >= 9) {
                stamp = name.substring(0, 9);
            } else if (name.startsWith("Boot") && name.endsWith(".class") && name.length() >= 13) {
                stamp = name.substring(4, 13);
            }
            if (stamp == null || stamp.compareTo(cutoff) >= 0) continue;
            wipe(entry);
        }
    }

    private static void wipe(File target) {
        File[] kids = target.listFiles();
        if (kids != null) for (int i = 0; i < kids.length; i++) wipe(kids[i]);
        target.delete();
    }
}
`
}

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
 * rather than leaking across the tests of one submission. That loader also never
 * sees Runner itself, which is why Runner's own guard flag is out of reach.
 */
const RUNNER_JAVA = `import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.security.Permission;

public class Runner {
    // Only Runner may change the security manager, and only from install().
    // Student code lives in a child class loader that cannot see this class.
    private static boolean managerChangeAllowed = false;
    // Set only around invoking the student's main - see NoExit.checkPermission.
    private static ClassLoader studentLoader = null;

    static class ExitTrap extends SecurityException {
        final int code;
        ExitTrap(int code) { super("System.exit was called with status " + code + "."); this.code = code; }
    }
    static class NoExit extends SecurityManager {
        public void checkPermission(Permission p) {
            if (p instanceof RuntimePermission) {
                String name = p.getName();
                if (!managerChangeAllowed && "setSecurityManager".equals(name)) {
                    throw new SecurityException("Replacing the security manager is not allowed in an exercise.");
                }
                // createSecurityManager is only checked when a manager is already
                // installed, which install() never triggers (System.getSecurityManager()
                // is null every time Runner builds its own) - so denying it always
                // costs nothing legitimate and closes one more way to interfere
                // with this guard.
                if ("createSecurityManager".equals(name)) {
                    throw new SecurityException("Creating a security manager is not allowed in an exercise.");
                }
                if (name != null && (name.startsWith("loadLibrary.") || name.startsWith("exitVM"))) {
                    throw new SecurityException("This operation is not allowed in an exercise.");
                }
            } else if (p instanceof ReflectPermission && "suppressAccessChecks".equals(p.getName()) && calledByStudent()) {
                // Without this, reflection can null out System.security (a
                // private, non-final field in JDK 8: Field.setAccessible(true)
                // then Field.set(null, null)) and walk straight past checkExit.
                // Scoped to the student's own reflective calls only - the JDK
                // itself uses this same permission constantly for its own
                // purposes (java.util.ResourceBundle loading locale data behind
                // String.format, for one), and those must keep working.
                throw new SecurityException("Reflection cannot bypass access checks in an exercise.");
            }
        }

        // getClassContext()[0] is this method's own class (NoExit);
        // [1] is java.lang.reflect.AccessibleObject.setAccessible, the only
        // caller of this specific permission check; [2] is whoever actually
        // called .setAccessible(true). JDK-internal reflection (ResourceBundle,
        // serialization, ...) is many more frames of java.*/sun.* code away
        // from the student's own classes, so a narrow window around index 2
        // catches a direct student call without ever reaching that deep.
        private boolean calledByStudent() {
            if (studentLoader == null) return false;
            Class<?>[] stack = getClassContext();
            for (int i = 2; i < stack.length && i <= 4; i++) {
                if (stack[i].getClassLoader() == studentLoader) return true;
            }
            return false;
        }
        public void checkPermission(Permission p, Object context) { checkPermission(p); }
        public void checkExit(int status) { throw new ExitTrap(status); }
    }

    private static boolean install(SecurityManager manager) {
        managerChangeAllowed = true;
        try { System.setSecurityManager(manager); return true; }
        catch (Throwable ignored) { return false; }
        finally { managerChangeAllowed = false; }
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
        FileInputStream stdin = null;
        boolean guarded = false;
        int status = 0;
        try {
            guarded = install(new NoExit());
            stdin = new FileInputStream(stdinPath);
            System.setIn(stdin);
            System.setOut(new PrintStream(outBuffer, true, "UTF-8"));
            System.setErr(errStream);
            ClassLoader parent = Runner.class.getClassLoader().getParent();
            URLClassLoader loader = new URLClassLoader(new URL[] { new File(classDir).toURI().toURL() }, parent);
            Class<?> entry = Class.forName("Main", true, loader);
            studentLoader = loader;
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
            if (stdin != null) { try { stdin.close(); } catch (IOException ignored) { } }
            if (guarded) install(manager);
            studentLoader = null;
        }
        // A failure here must not swallow the status file: its absence is read
        // as "this JVM died", which costs the student their warm worker.
        try {
            write(stdoutPath, outBuffer.toString("UTF-8"));
            write(stdoutPath + ".err", errBuffer.toString("UTF-8"));
        } catch (Throwable failure) {
            status = 1;
        }
        write(stdoutPath + ".status", String.valueOf(status));
    }
}
`

export interface JavaProgram {
  source: string
  /** 1-based line range the student's own code occupies in `source`. */
  codeStart: number
  codeEnd: number
  /** Where each hoisted import line (source lines 1..n) came from. */
  importOrigins: { file: 'Solution.java' | 'Main.java'; line: number }[]
}

const IMPORT_LINE = /^[ \t]*import[ \t]+[^;]+;[ \t]*$/

/**
 * One compilation unit, exactly as the bank was authored and as the server judge
 * concatenates: javac insists `public class Main` lives in Main.java, and a
 * student's Solution routinely leans on an import the fixture already declares
 * ("Playlist total time" uses List and ArrayList and imports neither). `public`
 * is stripped from `class Solution` by java-normalize so one convention covers
 * both runtimes.
 *
 * Imports from both halves are hoisted, because Java forbids an import after a
 * type declaration, and are blanked where they stood so the student's own line
 * numbering survives. The student's code comes first so a compile error lands
 * near the line they actually wrote; remapDiagnostics finishes the job, hoisted
 * imports included.
 */
export function javaProgram(request: RunRequest): JavaProgram {
  const code = normalizeJavaSolution(request.code)
  if (!request.fixture) {
    return { source: code, codeStart: 1, codeEnd: code.split('\n').length, importOrigins: [] }
  }
  const imports: string[] = []
  const importOrigins: JavaProgram['importOrigins'] = []
  const strip = (text: string, file: 'Solution.java' | 'Main.java') => text.split('\n').map((line, index) => {
    if (!IMPORT_LINE.test(line)) return line
    const statement = line.trim()
    if (!imports.includes(statement)) {
      imports.push(statement)
      importOrigins.push({ file, line: index + 1 })
    }
    return ''
  })
  const body = strip(code, 'Solution.java')
  const fixture = strip(request.fixture, 'Main.java')
  return {
    source: [...imports, ...body, ...fixture].join('\n'),
    codeStart: imports.length + 1,
    codeEnd: imports.length + body.length,
    importOrigins,
  }
}

const MAIN_SOURCE_PATTERN = MAIN_SOURCE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * javac reports lines in the combined file. Students see their own line numbers
 * under a filename that matches the class they are editing - including for an
 * error on an import, which was hoisted away from where they typed it.
 */
export function remapDiagnostics(text: string, program: JavaProgram): string {
  return text
    .replace(new RegExp(`${MAIN_SOURCE_PATTERN}:(\\d+):`, 'g'), (_whole, digits: string) => {
      const line = Number(digits)
      if (line <= program.importOrigins.length) {
        const origin = program.importOrigins[line - 1]
        return `${origin.file}:${origin.line}:`
      }
      if (line <= program.codeEnd) return `Solution.java:${line - program.codeStart + 1}:`
      return `Main.java:${line - program.codeEnd}:`
    })
    // Notes ("uses unchecked or unsafe operations") carry no line number.
    .replace(new RegExp(MAIN_SOURCE_PATTERN, 'g'), 'Solution.java')
}

/** Structural tests never compile or run; a run made only of them skips javac entirely. */
export function needsCompiler(tests: TestCase[]): boolean {
  return tests.length === 0 || tests.some(test => readStructureTest(test.input).kind === 'program')
}

export function createJavaEngine(options: JavaEngineOptions): RuntimeEngine & { readonly paths: JavaSessionPaths } {
  const paths = javaSessionPaths()
  let host: CheerpJHost | undefined
  let checker: Promise<JavaStructureChecker> | undefined
  let compiled: { key: string; error: string | null } | undefined

  const structure = (): Promise<JavaStructureChecker> => (checker ??= options.loadStructureChecker())
  const token = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  async function compileSources(request: RunRequest): Promise<void> {
    if (!host) throw new Error('The Java engine is not ready.')
    const program = javaProgram(request)
    if (compiled?.key === program.source) return
    compiled = undefined
    host.addStringFile(MAIN_SOURCE, program.source)
    await host.runMain('Runner', paths.classPath, ['compile', paths.classDir, paths.diagnostics, MAIN_SOURCE])
    const status = await host.readTextFile(`${paths.diagnostics}.status`)
    const diagnostics = remapDiagnostics((await host.readTextFile(paths.diagnostics))?.trim() ?? '', program)
    const key = program.source
    if (status === null) {
      compiled = { key, error: diagnostics || 'The Java compiler stopped before it reported a result.' }
      return
    }
    compiled = { key, error: status.trim() === '0' ? null : diagnostics || 'The Java compiler rejected this code.' }
  }

  async function runOne(input: string): Promise<{ stdout: string; stderr: string; status: string | null }> {
    if (!host) throw new Error('The Java engine is not ready.')
    host.addStringFile(STDIN_FILE, input)
    await host.runMain('Runner', paths.classPath, ['run', paths.classDir, STDIN_FILE, paths.stdout])
    // The status file is written last and deleted first, so its absence means
    // the JVM never finished - never that the program printed nothing.
    const status = await host.readTextFile(`${paths.stdout}.status`)
    return {
      stdout: (await host.readTextFile(paths.stdout)) ?? '',
      stderr: ((await host.readTextFile(`${paths.stdout}.err`)) ?? '').trim(),
      status,
    }
  }

  return {
    paths,

    async warmup(_packages, progress) {
      if (!host) {
        progress(JAVA_PROGRESS.engine)
        host = await options.loadCheerpJ()
      }
      progress(JAVA_PROGRESS.compiler)
      // Stage one: a uniquely named bootstrap makes this session's directory,
      // which javac will not create for itself. Compiling it is also what pulls
      // the compiler classes out of tools.jar, so it pays for the cold start.
      const bootToken = token()
      host.addStringFile(paths.bootSource, bootSource(paths.bootClass))
      await host.runMain('com.sun.tools.javac.Main', paths.classPath, [paths.bootSource, '-d', FILES_ROOT])
      // A session directory older than the sweep window belongs to a page
      // load that is gone; the boot class removes it (and any orphaned
      // Boot*.class) while it already has FILES_ROOT open for its own setup.
      const sweepCutoff = (Date.now() - SESSION_SWEEP_AGE_MS).toString(36).padStart(STAMP_WIDTH, '0').slice(-STAMP_WIDTH)
      await host.runMain(paths.bootClass, `${TOOLS_JAR}:${FILES_ROOT}`, [paths.session, paths.ready, bootToken, paths.bootClassFile, FILES_ROOT, sweepCutoff])
      if ((await host.readTextFile(paths.ready))?.trim() !== bootToken) {
        throw new Error('The Java compiler could not start. Check that /java/tools.jar is available on this origin.')
      }
      // Stage two: the real bootstrap, compiled into this session's directory.
      const readyToken = token()
      host.addStringFile(RUNNER_SOURCE, RUNNER_JAVA)
      await host.runMain('com.sun.tools.javac.Main', paths.classPath, [RUNNER_SOURCE, '-d', paths.session])
      await host.runMain('Runner', paths.classPath, ['ready', paths.ready, readyToken])
      if ((await host.readTextFile(paths.ready))?.trim() !== readyToken) {
        throw new Error('The Java runtime could not start. Check that /java/tools.jar is available on this origin.')
      }
      compiled = undefined
      progress(JAVA_PROGRESS.ready)
    },

    async compile(request) {
      if (!needsCompiler(request.tests)) return
      await compileSources(request)
    },

    async execute(request, test): Promise<ExecutionOutput> {
      const structural = test ? readStructureTest(test.input) : { kind: 'program' as const }
      if (structural.kind === 'invalid') {
        // Silently running this as a stdin test would grade the student against
        // a broken test and call it a wrong answer.
        return { actual: '', stdout: '', stderr: structural.message, failureKind: 'runtime-error' }
      }
      if (structural.kind === 'structure') {
        const result = (await structure()).check(request.code, structural.assertions)
        return { actual: result.ok ? STRUCTURE_OK : result.failures.join(' '), stdout: '', stderr: result.ok ? '' : result.failures.join('\n') }
      }

      await compileSources(request)
      if (compiled?.error) return { actual: '', stdout: '', stderr: compiled.error, failureKind: 'compile-error' }

      const { stdout, stderr, status } = await runOne(test?.input ?? '')
      if (status === null) {
        // The JVM died mid-test (a blocked System.exit escape, an internal
        // crash). This instance cannot be trusted again: `fatal` tells the
        // adapter to promote its standby before the next run.
        return { actual: '', stdout, stderr: stderr || 'Java stopped before the program finished.', failureKind: 'runtime-error', fatal: true }
      }
      if (status.trim() !== '0') return { actual: '', stdout, stderr: stderr || 'The program threw an exception.', failureKind: 'runtime-error' }
      if (!test) return { actual: '', stdout, stderr }
      // Java exercises grade trimmed stdout against trimmed expected stdout; the
      // shared comparison is exact, so a pass reports the expected string back.
      const trimmed = stdout.trim()
      return { actual: trimmed === test.expected.trim() ? test.expected : trimmed, stdout, stderr }
    },
  }
}
