import { test, expect } from '@playwright/test'
import { javaVerifyResult, readJavaBank, type BankEntry, type JavaVerify, type JavaVerifyFailure } from './support'

/**
 * The browser Java runtime end to end: a real Worker, the CheerpJ runtime from
 * the vendor CDN, tools.jar from this origin, and javac compiling the "Shapes
 * report" reference before it is graded. Runs against the development-only
 * page src/app/preview/java-verify/page.tsx, so it needs no Supabase session.
 *
 * Excluded from the default suite (playwright.config.ts testIgnore) because it
 * depends on a third-party CDN and on public/java/tools.jar, which is
 * gitignored and fetched at install time. Run it with:
 *   RUN_JAVA_E2E=1 npx playwright test e2e/java/java-runtime.spec.ts --project=chromium
 * The whole-bank run is e2e/java/verify-java-bank.spec.ts.
 */

// A cold first load pulls ~18 MB of CheerpJ runtime plus the compiler classes.
test.setTimeout(6 * 60 * 1000)

test('compiles and grades a Java exercise in the browser, and reports a compile error', async ({ page }) => {
  const verify: JavaVerify = await javaVerifyResult(page, readJavaBank('smoke.json'))

  expect(verify.error).toBeNull()
  expect(verify.rows).toHaveLength(1)
  const shapes = verify.rows[0]
  console.log(`Shapes report: ${shapes.passed}/${shapes.total} in ${shapes.ms} ms`)
  expect(shapes.failures, JSON.stringify(shapes.failures)).toEqual([])
  expect(shapes.passed).toBe(5)
  expect(shapes.total).toBe(5)

  // Broken source must come back as a compile error carrying javac's own text,
  // never as a wrong answer - and pointing at the file the student edits.
  expect(verify.compileError?.failureKind).toBe('compile-error')
  expect(verify.compileError?.stderr).toContain('error:')
  expect(verify.compileError?.stderr).toContain('Solution.java:')
})

/**
 * Fix round 3's mechanism, replacing round 2's stack-index scan on
 * ReflectPermission("suppressAccessChecks").
 *
 * OpenJDK 8's Class.checkMemberAccess (the gate behind getDeclaredField(s),
 * getDeclaredMethod(s) and getDeclaredConstructor(s)) calls
 * SecurityManager.checkPermission(new RuntimePermission("accessDeclaredMembers"))
 * ONLY when the caller's class loader differs from the target class's loader.
 * NoExit.checkPermission now denies that permission - but not unconditionally:
 * running the full legitimate-case battery below found that CheerpJ also routes
 * linking an invokedynamic call site (creating ANY lambda, including a plain
 * Runnable with no reflection in it) through this exact permission, several
 * java.lang.invoke.* frames deep, which an unconditional deny broke outright.
 * calledByStudent() (java-engine.ts) tells the two apart by reading
 * getClassContext()[3] - the immediate caller of the getDeclaredXxx call,
 * always exactly two hops below checkMemberAccess, confirmed against CheerpJ's
 * own stack traces for both shapes, not assumed. A direct student call has the
 * student's class at index 3; a lambda's call-site linkage has JDK-internal
 * java.lang.invoke.* frames there instead, with the student's own frame only
 * appearing much deeper (it triggered the linkage but isn't the reflecting
 * caller); a lambda body that itself calls getDeclaredField gets its own fresh
 * two-hop stack when that call executes, with its synthetic class (loaded by
 * the same loader as the class that declared it) at index 3 - still denied.
 *
 * ReflectPermission("suppressAccessChecks") - what round 2 denied by stack
 * index - is left fully permitted. AccessibleObject.setAccessible's own check
 * has no caller/loader awareness at all (it always calls checkPermission
 * unconditionally, regardless who is asking), so denying it outright breaks
 * java.util.ResourceBundle's own bundle-loading machinery, which sets a
 * constructor accessible from inside Class.newInstance() on every
 * String.format/NumberFormat call in the bank - the exact regression the
 * implementer hit and reverted in round 2. Leaving it permitted costs nothing
 * against the reflection-based exit vectors: they all *start* with a
 * getDeclaredField/getDeclaredMethod/getDeclaredConstructor call into a JDK
 * class, which the new gate denies before setAccessible is ever reached -
 * *except* one shape, confirmed by running it, not assumed: wrapping the
 * checked call itself (getDeclaredField) through Method.invoke does not reach
 * Class.checkMemberAccess's security check at all on CheerpJ - see the
 * 'system-field-invoke' test below and the report's residuals. This is
 * narrower than round 2's hole (it is one specific reflective shape, not every
 * indirection), but it is real and is asserted here rather than hidden.
 *
 * A second consequence, also called out rather than hidden: a student can
 * still getDeclaredField + setAccessible on their OWN class's private members
 * (same class loader on both ends, so Class.checkMemberAccess never calls the
 * security manager for it at all - this is the JDK's own access-control model,
 * not a gap in this guard). That reflects nothing they could not already read
 * from the source they wrote; it is not a route to any JDK internal, an exit
 * vector, or another student's data, so it is left alone.
 */
const exploitBank: BankEntry[] = [{
  file: 'inline-security-probe',
  exercise: {
    cloId: 'probe', language: 'java', kind: 'code', pattern: 'security-probe', title: 'Security probe',
    referenceSolution: [
      'import java.lang.reflect.*;',
      'import java.util.*;',
      'import java.util.stream.*;',
      '',
      'class Solution {',
      '    private static int secret = 42;',
      '',
      '    // Same class loader on both ends - Class.checkMemberAccess never calls',
      '    // the security manager for this at all. Documented residual, not a bug:',
      '    // see the block comment above this bank entry.',
      '    static void ownFieldReflection() throws Exception {',
      '        Field f = Solution.class.getDeclaredField("secret");',
      '        f.setAccessible(true);',
      '        System.out.println("leaked:" + f.getInt(null));',
      '    }',
      '',
      '    // The named bypass from fix round 1/2: reflect into a JDK class not',
      '    // loaded by the student loader. Direct call, no invoke-wrapping.',
      '    static void systemFieldDirect() throws Exception {',
      '        Field f = System.class.getDeclaredField("security");',
      '        f.setAccessible(true);',
      '        System.out.println("leaked:" + f.get(null));',
      '    }',
      '',
      '    // The round-2 review\'s finding, retargeted at the new gate: wrap the',
      '    // checked call itself (getDeclaredField, not setAccessible) through',
      '    // Method.invoke. Round 2\'s stack scan broke on this shape; the new',
      '    // gate reads Reflection.getCallerClass(), which is designed to see',
      '    // through exactly this kind of accessor indirection.',
      '    static void systemFieldInvokeWrapped() throws Exception {',
      '        Method getDeclaredField = Class.class.getMethod("getDeclaredField", String.class);',
      '        Field f = (Field) getDeclaredField.invoke(System.class, "security");',
      '        f.setAccessible(true);',
      '        System.out.println("leaked:" + f.get(null));',
      '    }',
      '',
      '    static void systemFieldsEnumerate() throws Exception {',
      '        Field[] fields = System.class.getDeclaredFields();',
      '        System.out.println("field-count:" + fields.length);',
      '    }',
      '',
      '    static void unsafeTheUnsafe() throws Exception {',
      '        Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");',
      '        Field f = unsafeClass.getDeclaredField("theUnsafe");',
      '        f.setAccessible(true);',
      '        System.out.println("unsafe:" + f.get(null));',
      '    }',
      '',
      '    static void lambdaComparator() throws Exception {',
      '        List<Integer> xs = new ArrayList<>(Arrays.asList(3, 1, 2));',
      '        Collections.sort(xs, (a, b) -> {',
      '            try {',
      '                System.class.getDeclaredField("security").setAccessible(true);',
      '            } catch (NoSuchFieldException e) {',
      '                throw new RuntimeException(e);',
      '            }',
      '            return a - b;',
      '        });',
      '        System.out.println("sorted:" + xs);',
      '    }',
      '',
      '    static void streamPipeline() throws Exception {',
      '        List<Integer> xs = Arrays.asList(3, 1, 2);',
      '        String result = xs.stream().sorted((a, b) -> {',
      '            try {',
      '                System.class.getDeclaredField("security").setAccessible(true);',
      '            } catch (NoSuchFieldException e) {',
      '                throw new RuntimeException(e);',
      '            }',
      '            return a - b;',
      '        }).map(String::valueOf).collect(Collectors.joining(","));',
      '        System.out.println("sorted:" + result);',
      '    }',
      '',
      '    // status 0 is treated as a normal end (fix round 1), so this is not',
      '    // expected to surface as a runtime error - the property under test is',
      '    // that execution stops right there and the worker is not killed.',
      '    static void haltZero() {',
      '        System.out.println("before-halt");',
      '        Runtime.getRuntime().halt(0);',
      '        System.out.println("unreachable-after-halt");',
      '    }',
      '',
      '    // System.exit on a background thread throws on that thread only; the',
      '    // main thread never sees it, so this is expected to survive and finish.',
      '    static void threadExit() throws Exception {',
      '        Thread t = new Thread(() -> System.exit(0));',
      '        t.start();',
      '        t.join();',
      '        System.out.println("thread-exit-survived");',
      '    }',
      '}',
      '',
      '// Kept apart from Solution: touching this class runs its static',
      '// initializer, which would poison every other mode above if it lived on',
      '// Solution itself (each test gets a fresh class loader, but only one).',
      'class StaticAttacker {',
      '    static {',
      '        try {',
      '            Field f = System.class.getDeclaredField("security");',
      '            f.setAccessible(true);',
      '        } catch (ReflectiveOperationException e) {',
      '            throw new RuntimeException(e);',
      '        }',
      '    }',
      '    static void touch() { }',
      '}',
    ].join('\n'),
    fixture: [
      'import java.util.Scanner;',
      '',
      'public class Main {',
      '    public static void main(String[] args) throws Exception {',
      '        Scanner scanner = new Scanner(System.in);',
      '        String mode = scanner.nextLine();',
      '        switch (mode) {',
      '            case "own-field": Solution.ownFieldReflection(); break;',
      '            case "system-field-direct": Solution.systemFieldDirect(); break;',
      '            case "system-field-invoke": Solution.systemFieldInvokeWrapped(); break;',
      '            case "system-fields-enum": Solution.systemFieldsEnumerate(); break;',
      '            case "unsafe": Solution.unsafeTheUnsafe(); break;',
      '            case "lambda-comparator": Solution.lambdaComparator(); break;',
      '            case "stream-pipeline": Solution.streamPipeline(); break;',
      '            case "halt": Solution.haltZero(); break;',
      '            case "thread-exit": Solution.threadExit(); break;',
      '            case "static-init": StaticAttacker.touch(); System.out.println("static-init-ran-without-blocking"); break;',
      '            default: System.out.println("echo:" + mode);',
      '        }',
      '    }',
      '}',
    ].join('\n'),
    tests: [
      { id: 'own-field', input: 'own-field', expected: 'leaked:42', hidden: false },
      { id: 'system-field-direct', input: 'system-field-direct', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'system-field-invoke', input: 'system-field-invoke', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'system-fields-enum', input: 'system-fields-enum', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'unsafe', input: 'unsafe', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'lambda-comparator', input: 'lambda-comparator', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'stream-pipeline', input: 'stream-pipeline', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'halt', input: 'halt', expected: 'before-halt', hidden: false },
      { id: 'thread-exit', input: 'thread-exit', expected: 'thread-exit-survived', hidden: false },
      { id: 'static-init', input: 'static-init', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'echo', input: 'echo-check', expected: 'echo:echo-check', hidden: false },
    ],
  },
}]

/** A denied reflective attempt: SecurityException from the new gate, never a leak, never the JVM dying. */
function expectDenied(row: JavaVerify['rows'][number], testId: string): JavaVerifyFailure {
  const failure = row.failures.find(f => f.testId === testId)
  expect(failure, `${testId} should have been denied; failures: ${JSON.stringify(row.failures)}`).toBeTruthy()
  expect(failure!.failureKind).toBe('runtime-error')
  expect(failure!.stderr).toContain('SecurityException')
  expect(failure!.stderr).toContain('Reflection cannot bypass access checks')
  expect(failure!.actual).not.toContain('leaked:')
  expect(failure!.actual).not.toContain('unsafe:')
  return failure!
}

test('the declared-member gate denies reflection into JDK classes by every route tried, and the worker survives all of it', async ({ page }) => {
  const verify: JavaVerify = await javaVerifyResult(page, exploitBank)
  expect(verify.error).toBeNull()
  expect(verify.rows).toHaveLength(1)
  const row = verify.rows[0]
  console.log(`Security probe: ${row.passed}/${row.total}`, JSON.stringify(row.failures))

  // The reviewer's exact bypass program, retargeted: reflecting on the
  // student's OWN class crosses no loader boundary, so it is not denied - see
  // the block comment above exploitBank. This is not the exit vector; it is
  // the harmless case the mechanism deliberately leaves open.
  expect(row.failures.some(f => f.testId === 'own-field')).toBe(false)

  // Every route into a JDK class is denied, regardless of how many reflection
  // frames sit between the student and the checked call.
  expectDenied(row, 'system-field-direct')
  expectDenied(row, 'system-fields-enum')
  expectDenied(row, 'lambda-comparator')
  expectDenied(row, 'stream-pipeline')

  // Documented residual, confirmed by running it rather than assumed: wrapping
  // the checked call (getDeclaredField) itself through Method.invoke does not
  // reach NoExit.checkPermission on CheerpJ at all - Class.checkMemberAccess
  // simply is not invoked for this shape, so no logic on our side can see it.
  // "security" still does not exist on CheerpJ's System (round 1/2's finding,
  // unchanged), so the attack still cannot leak the field's value here either
  // way - but this is luck, not the guard, and must not be reported as denied.
  const invokeWrapped = row.failures.find(f => f.testId === 'system-field-invoke')
  expect(invokeWrapped, `system-field-invoke: failures: ${JSON.stringify(row.failures)}`).toBeTruthy()
  expect(invokeWrapped!.stderr).toContain('NoSuchFieldException')
  expect(invokeWrapped!.actual).not.toContain('leaked:')

  // sun.misc.Unsafe may or may not exist under CheerpJ at all; either way
  // theUnsafe must never come back.
  const unsafe = row.failures.find(f => f.testId === 'unsafe')
  expect(unsafe, `unsafe should not have passed; failures: ${JSON.stringify(row.failures)}`).toBeTruthy()
  expect(unsafe!.actual).not.toContain('unsafe:')

  // A static initializer that attempts the bypass fails the same way, wrapped
  // in ExceptionInInitializerError by the JVM - the guard's own exception is
  // still present in the printed cause chain.
  const staticInit = row.failures.find(f => f.testId === 'static-init')
  expect(staticInit, `static-init should have been denied; failures: ${JSON.stringify(row.failures)}`).toBeTruthy()
  expect(staticInit!.failureKind).toBe('runtime-error')
  expect(staticInit!.stderr).toContain('SecurityException')
  expect(staticInit!.stderr).toContain('Reflection cannot bypass access checks')
  expect(staticInit!.actual).not.toContain('static-init-ran-without-blocking')

  // Runtime.getRuntime().halt(0) and System.exit(0) from a background thread
  // are pre-existing, unrelated guarantees (fix round 1's checkExit trap) -
  // re-verified here because both were on the requested probe list. halt(0)
  // stops execution where it is called (never printing the line after it) and
  // status 0 is treated as a normal end, not a crash or a runtime error.
  expect(row.failures.some(f => f.testId === 'halt')).toBe(false)
  expect(row.failures.some(f => f.testId === 'thread-exit')).toBe(false)

  // The real assertion running through every case above: the same worker
  // answers a plain echo afterward, which is only possible if the JVM was
  // never killed by any of the eleven attempts that came before it.
  expect(row.failures.some(f => f.testId === 'echo')).toBe(false)
  expect(row.total).toBe(11)
})

/**
 * The other half of the contract: nothing legitimate breaks under the new gate.
 * None of this uses reflection, but several of these (String.format, LocalDate,
 * enum default toString/valueOf machinery) exercise the exact JDK-internal
 * reflection paths (ResourceBundle, Class.newInstance) the gate is designed to
 * leave alone.
 */
const legitimateBank: BankEntry[] = [{
  file: 'inline-legitimate-probe',
  exercise: {
    cloId: 'legit', language: 'java', kind: 'code', pattern: 'legitimate-probe', title: 'Legitimate Java features',
    referenceSolution: [
      'import java.util.*;',
      'import java.util.stream.*;',
      'import java.time.LocalDate;',
      'import java.time.format.DateTimeFormatter;',
      '',
      'interface Greeter {',
      '    String name();',
      '    default String greet() { return "hello, " + name(); }',
      '}',
      '',
      'abstract class Animal {',
      '    abstract String sound();',
      '    String describe() { return "animal says " + sound(); }',
      '}',
      '',
      'class Dog extends Animal {',
      '    String sound() { return "woof"; }',
      '}',
      '',
      'enum Direction { NORTH, SOUTH, EAST, WEST }',
      '',
      'class Solution {',
      '    static String formatDecimal() { return String.format("%.2f", 3.14159); }',
      '    static String formatGrouped() { return String.format("%,d", 1000000); }',
      '    static String scannerEcho(String rest) { return "read:" + rest; }',
      '',
      '    static String collectionsAndStreams() {',
      '        List<String> xs = new ArrayList<>(Arrays.asList("b", "a", "c"));',
      '        Map<String, Integer> lengths = new HashMap<>();',
      '        for (String x : xs) lengths.put(x, x.length());',
      '        String joined = xs.stream().sorted().collect(Collectors.joining(","));',
      '        return joined + ":" + lengths.size();',
      '    }',
      '',
      '    static String arraysSortComparator() {',
      '        Integer[] xs = { 3, 1, 2 };',
      '        Arrays.sort(xs, (a, b) -> b - a);',
      '        return Arrays.toString(xs);',
      '    }',
      '',
      '    static String localDateFormatting() {',
      '        LocalDate date = LocalDate.of(2026, 9, 7);',
      '        return date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));',
      '    }',
      '',
      '    static String enumValues() {',
      '        StringBuilder sb = new StringBuilder();',
      '        for (Direction d : Direction.values()) sb.append(d.name()).append(",");',
      '        return sb.toString();',
      '    }',
      '',
      '    static String interfaceDefault() {',
      '        Greeter g = () -> "student";',
      '        return g.greet();',
      '    }',
      '',
      '    static String abstractHierarchy() {',
      '        Animal a = new Dog();',
      '        return a.describe();',
      '    }',
      '',
      '    static String parseIntFailure() {',
      '        try {',
      '            Integer.parseInt("not-a-number");',
      '            return "no-exception";',
      '        } catch (NumberFormatException e) {',
      '            return "caught:" + e.getClass().getSimpleName();',
      '        }',
      '    }',
      '',
      '    static String stringSwitch(String mode) {',
      '        switch (mode) {',
      '            case "a": return "first";',
      '            case "b": return "second";',
      '            default: return "other";',
      '        }',
      '    }',
      '',
      '    static String mathFunctions() {',
      '        return Math.max(3, 7) + ":" + Math.abs(-5) + ":" + Math.round(2.6) + ":" + (int) Math.pow(2, 10);',
      '    }',
      '',
      '    static String printfStyle() {',
      '        return String.format("%s %d %n", "count", 42).trim();',
      '    }',
      '}',
    ].join('\n'),
    fixture: [
      'import java.util.Scanner;',
      '',
      'public class Main {',
      '    public static void main(String[] args) throws Exception {',
      '        Scanner scanner = new Scanner(System.in);',
      '        String mode = scanner.nextLine();',
      '        switch (mode) {',
      '            case "format-decimal": System.out.println(Solution.formatDecimal()); break;',
      '            case "format-grouped": System.out.println(Solution.formatGrouped()); break;',
      '            case "scanner": System.out.println(Solution.scannerEcho(scanner.nextLine())); break;',
      '            case "collections-streams": System.out.println(Solution.collectionsAndStreams()); break;',
      '            case "arrays-sort": System.out.println(Solution.arraysSortComparator()); break;',
      '            case "local-date": System.out.println(Solution.localDateFormatting()); break;',
      '            case "enum-values": System.out.println(Solution.enumValues()); break;',
      '            case "interface-default": System.out.println(Solution.interfaceDefault()); break;',
      '            case "abstract-hierarchy": System.out.println(Solution.abstractHierarchy()); break;',
      '            case "parse-int": System.out.println(Solution.parseIntFailure()); break;',
      '            case "string-switch": System.out.println(Solution.stringSwitch("b")); break;',
      '            case "math": System.out.println(Solution.mathFunctions()); break;',
      '            case "printf": System.out.println(Solution.printfStyle()); break;',
      '            default: System.out.println("echo:" + mode);',
      '        }',
      '    }',
      '}',
    ].join('\n'),
    tests: [
      { id: 'format-decimal', input: 'format-decimal', expected: '3.14', hidden: false },
      { id: 'format-grouped', input: 'format-grouped', expected: '1,000,000', hidden: false },
      { id: 'scanner', input: 'scanner\nworld', expected: 'read:world', hidden: false },
      { id: 'collections-streams', input: 'collections-streams', expected: 'a,b,c:3', hidden: false },
      { id: 'arrays-sort', input: 'arrays-sort', expected: '[3, 2, 1]', hidden: false },
      { id: 'local-date', input: 'local-date', expected: '2026-09-07', hidden: false },
      { id: 'enum-values', input: 'enum-values', expected: 'NORTH,SOUTH,EAST,WEST,', hidden: false },
      { id: 'interface-default', input: 'interface-default', expected: 'hello, student', hidden: false },
      { id: 'abstract-hierarchy', input: 'abstract-hierarchy', expected: 'animal says woof', hidden: false },
      { id: 'parse-int', input: 'parse-int', expected: 'caught:NumberFormatException', hidden: false },
      { id: 'string-switch', input: 'string-switch', expected: 'second', hidden: false },
      { id: 'math', input: 'math', expected: '7:5:3:1024', hidden: false },
      { id: 'printf', input: 'printf', expected: 'count 42', hidden: false },
    ],
  },
}]

test('legitimate Java features are unaffected by the declared-member gate', async ({ page }) => {
  const verify: JavaVerify = await javaVerifyResult(page, legitimateBank)
  expect(verify.error).toBeNull()
  expect(verify.rows).toHaveLength(1)
  const row = verify.rows[0]
  console.log(`Legitimate features: ${row.passed}/${row.total}`, JSON.stringify(row.failures))
  expect(row.failures, JSON.stringify(row.failures)).toEqual([])
  expect(row.passed).toBe(row.total)
  expect(row.total).toBe(13)
})
