import { test, expect } from '@playwright/test'
import { javaVerifyResult, readJavaBank, type BankEntry, type JavaVerify } from './support'

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
test.setTimeout(5 * 60 * 1000)

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
 * The known System.exit bypass from the fix-round-1 review: reflection can
 * null out a JVM's own security-manager bookkeeping (System.security is a
 * private, non-final field in JDK 8) and then call System.exit, walking
 * straight past the checkExit trap Runner installs. NoExit.checkPermission
 * now also refuses ReflectPermission("suppressAccessChecks") for calls the
 * student's own code makes, so setAccessible(true) on a private member
 * throws before any such reflective bypass can go further.
 *
 * This probe targets a private field on the student's own class rather than
 * System.security directly, because CheerpJ's System class does not expose a
 * field of that exact name (getDeclaredField("security") throws
 * NoSuchFieldException there, which is a safe outcome but does not exercise
 * the permission check this fix adds). A private field the student compiled
 * themselves is guaranteed to exist, so getDeclaredField succeeds and
 * setAccessible(true) is what must be denied.
 *
 * The assay: test 1 attempts the exploit and is expected to fail (there is no
 * way for it to print the leaked value once the guard holds). What matters is
 * test 2, sent to the very same worker afterward - if the guard had failed to
 * hold and this were the real System.exit bypass, the JVM would have died and
 * test 2 would come back as a timeout instead of a pass (the adapter only
 * promotes a dead worker between runs, not mid-run). The bank run itself
 * (smoke.json's "Shapes report", which formats numbers with String.format)
 * is the proof the same permission is not being taken away from the JDK's
 * own internals - java.util.ResourceBundle sets constructors accessible to
 * load locale data, exactly this permission, on every such call.
 */
const exploitBank: BankEntry[] = [{
  file: 'inline-security-probe',
  exercise: {
    cloId: 'probe', language: 'java', kind: 'code', pattern: 'security-probe', title: 'Security probe',
    referenceSolution: [
      'import java.lang.reflect.Field;',
      '',
      'class Solution {',
      '    private static int secret = 42;',
      '',
      '    static void attack() throws Exception {',
      '        Field f = Solution.class.getDeclaredField("secret");',
      '        f.setAccessible(true);',
      '        System.out.println("leaked:" + f.getInt(null));',
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
      '        if (mode.equals("attack")) {',
      '            Solution.attack();',
      '        } else {',
      '            System.out.println("echo:" + mode);',
      '        }',
      '    }',
      '}',
    ].join('\n'),
    tests: [
      { id: 'attack', input: 'attack', expected: 'unreachable-if-the-guard-holds', hidden: false },
      { id: 'echo', input: 'hello', expected: 'echo:hello', hidden: false },
    ],
  },
}]

test('reflection cannot bypass access checks, and the worker survives the attempt', async ({ page }) => {
  const verify: JavaVerify = await javaVerifyResult(page, exploitBank)
  expect(verify.error).toBeNull()
  expect(verify.rows).toHaveLength(1)
  const row = verify.rows[0]

  const attack = row.failures.find(f => f.testId === 'attack')
  expect(attack, JSON.stringify(row.failures)).toBeTruthy()
  // Never a leaked value, and specifically the guard's own SecurityException
  // - not some other crash that would also happen to fail this test.
  expect(attack!.failureKind).toBe('runtime-error')
  expect(attack!.stderr).toMatch(/SecurityException.*Reflection cannot bypass access checks/)
  expect(attack!.actual).not.toContain('leaked:')

  // The real assertion: the same worker answers the next test normally,
  // which is only possible if the JVM was never killed.
  expect(row.passed).toBe(1)
  expect(row.total).toBe(2)
  expect(row.failures.some(f => f.testId === 'echo')).toBe(false)
})
