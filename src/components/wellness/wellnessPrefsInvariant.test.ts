/**
 * Static guard for the `wellness.prefs` single-writer invariant (X3, and its
 * fix-round follow-ups F1/F2/F3/F4).
 *
 * `src/app/(app)/account/prefsMutation.ts` is meant to be the one place in
 * the tree that writes `wellness.prefs`, with exactly one legitimate
 * exception (`Dock.tsx`'s `useRowMutation`, a *row-column* writer that
 * shares the same cache key but is not itself a prefs write) -- see that
 * file's doc comment. Every OTHER module that shares `qk.wellness` (a row
 * writer, or a bespoke read-merge-write like `useExerciseLoop.
 * recordGoalAndStreak`) must skip its own settle-invalidate while
 * `hasPendingPrefsWrite` is true, or its refetch can land the server's
 * stale prefs snapshot back over a change the learner just made.
 *
 * Fix round (F4): the prior round's docblocks asserted "there is now exactly
 * one writer" as an unqualified, tree-wide fact while it was not -- this
 * file makes the actual state a test instead of prose, in two parts:
 *
 *   1. No new file constructs a `useOptimistic`/`useMutation` write keyed
 *      directly on `qk.wellness(...)` beyond the tracked list below. This
 *      is deliberately a fixed, pinned list, not merely "at most N" --
 *      `src/components/shell/DockControl.tsx` is a KNOWN, OPEN exception
 *      (F1: still its own independent writer, outside every path this lane
 *      owns) tracked here on purpose. When F1 lands, remove it from
 *      `OPEN_WRITER_EXCEPTIONS_F1` in the SAME commit that fixes it -- this
 *      test will fail until you do, which is the point: the invariant
 *      cannot quietly regress AND it cannot quietly stay "temporarily" true
 *      forever without the pin being touched.
 *   2. Every module that invalidates `qk.wellness` on a write-settle either
 *      defines `hasPendingPrefsWrite` (this is prefsMutation.ts itself) or
 *      imports it -- except the tracked, open exceptions in
 *      `OPEN_UNGUARDED_INVALIDATORS_F3`, each an X3 hazard already reported
 *      and awaiting its own owner. Same pin-and-fail discipline as above.
 *
 * A module scan, not a literal `useOptimistic`/`useMutation` AST check --
 * `prefsMutation.ts`'s own writer does not call either hook by name (it is
 * hand-rolled: `setQueryData` + a module-level debounce timer), so pattern 1
 * only needs to catch OTHER files reaching for the shared `useOptimistic`
 * helper (or a bespoke one) directly against this key instead of going
 * through the shared writer.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const SRC_DIR = join(ROOT, 'src')

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walkSourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

function toSrcPath(file: string): string {
  return `src${file.slice(SRC_DIR.length)}`.split(sep).join('/')
}

const sourceFiles = walkSourceFiles(SRC_DIR)
const fileContents = new Map(sourceFiles.map((file) => [file, readFileSync(file, 'utf8')]))

// ---------------------------------------------------------------------------
// 1. Raw writers: a `useOptimistic`/`useMutation` construction keyed
//    directly on `qk.wellness(...)`.
// ---------------------------------------------------------------------------

const RAW_WRITER_KEY_PATTERN = /key:\s*qk\.wellness\(/

/** The one writer the review calls legitimate: a row-*column* mutation
 *  (`Dock.tsx`'s `useRowMutation`, water/pomodoro log entries) that shares
 *  the cache key but is not a `prefs` write, and is guarded by
 *  `hasPendingPrefsWrite` on its own settle. */
const ALLOWED_RAW_WRITERS = ['src/components/wellness/Dock.tsx']

/** F1 (open): `DockControl.tsx` still keeps its own independent writer on
 *  `wellness.prefs.dock.placement`, outside every path this lane owns.
 *  Tracked here on purpose -- remove this line in the same commit that
 *  routes it through `useDockPrefsMutation`. */
const OPEN_WRITER_EXCEPTIONS_F1 = ['src/components/shell/DockControl.tsx']

// ---------------------------------------------------------------------------
// 2. Invalidators: a settle-time `invalidateQueries({ queryKey: ... })` that
//    resolves to `qk.wellness(...)`, either inline or via a local variable
//    assigned from it earlier in the same file.
// ---------------------------------------------------------------------------

function invalidatesWellnessKey(content: string): boolean {
  const callPattern = /invalidateQueries\(\{\s*queryKey:\s*([^},]+?)\s*\}\)/g
  let match: RegExpExecArray | null
  while ((match = callPattern.exec(content))) {
    const expr = match[1].trim()
    if (expr.includes('qk.wellness(')) return true
    const identifier = /^[A-Za-z_$][\w$]*$/.exec(expr)
    if (identifier && new RegExp(`\\bconst\\s+${identifier[0]}\\s*=\\s*qk\\.wellness\\(`).test(content)) return true
  }
  return false
}

function guardsPendingWrite(content: string): boolean {
  return /export function hasPendingPrefsWrite/.test(content)
    || /\bhasPendingPrefsWrite\b/.test(content) && /from ['"]@\/app\/\(app\)\/account\/prefsMutation['"]/.test(content)
}

/** F3 (open): four call sites unconditionally invalidate `qk.wellness` on
 *  their own settle without importing the guard -- `useExerciseLoop.ts` was
 *  named by the prior round's report, and the two derot runner pages were
 *  found landing since (both reported, neither in this lane's paths).
 *  Tracked here on purpose, same discipline as `OPEN_WRITER_EXCEPTIONS_F1`:
 *  remove an entry in the same commit that adds its guard. */
const OPEN_UNGUARDED_INVALIDATORS_F3 = [
  'src/hooks/useExerciseLoop.ts',
  'src/app/(app)/derot/arcade/[kind]/page.tsx',
  'src/app/(app)/derot/play/[game]/page.tsx',
].sort()

describe('static guard: wellness.prefs has exactly one writer plus the tracked exceptions', () => {
  it('no new file constructs a useOptimistic/useMutation write keyed on qk.wellness', () => {
    const writers = sourceFiles
      .filter((file) => RAW_WRITER_KEY_PATTERN.test(fileContents.get(file) ?? ''))
      .map(toSrcPath)
      .sort()

    expect(writers).toEqual([...ALLOWED_RAW_WRITERS, ...OPEN_WRITER_EXCEPTIONS_F1].sort())
  })

  it('every settle-time invalidator of qk.wellness guards with hasPendingPrefsWrite, except the tracked open exceptions', () => {
    const invalidators = sourceFiles.filter((file) => invalidatesWellnessKey(fileContents.get(file) ?? ''))
    const unguarded = invalidators
      .filter((file) => !guardsPendingWrite(fileContents.get(file) ?? ''))
      .map(toSrcPath)
      .sort()

    expect(unguarded).toEqual(OPEN_UNGUARDED_INVALIDATORS_F3)
  })
})
