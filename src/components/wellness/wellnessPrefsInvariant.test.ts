/**
 * Static guard for the `wellness.prefs` single-writer invariant (X3, and its
 * fix-round follow-ups F1/F2/F3/F4, plus fix round 2's N1).
 *
 * `src/app/(app)/account/prefsMutation.ts` is meant to be the one place in
 * the tree that writes `wellness.prefs`, with two legitimate exceptions:
 * `Dock.tsx`'s `useRowMutation` (a *row-column* writer that shares the same
 * cache key but is not itself a prefs write -- see that file's doc comment)
 * and `src/lib/rewards/record.ts`'s `recordGoalDay` (a second, independent
 * `prefs.goalDays` read-merge-write the wave 2 review ruled legitimate
 * rather than routed through the shared queue -- see pattern 3 below). Every
 * OTHER module that shares `qk.wellness` must skip its own settle-invalidate
 * while `hasPendingPrefsWrite` is true, or its refetch can land the server's
 * stale prefs snapshot back over a change the learner just made.
 *
 * Fix round (F4): the prior round's docblocks asserted "there is now exactly
 * one writer" as an unqualified, tree-wide fact while it was not -- this
 * file makes the actual state a test instead of prose, in three parts:
 *
 *   1. No new file constructs a `useOptimistic`/`useMutation` write keyed
 *      directly on `qk.wellness(...)` beyond the tracked list below. This
 *      is deliberately a fixed, pinned list, not merely "at most N" -- any
 *      open exception is a named entry, tracked here on purpose. When one
 *      closes, remove it from `OPEN_WRITER_EXCEPTIONS_F1` in the SAME commit
 *      that fixes it -- this test will fail until you do, which is the
 *      point: the invariant cannot quietly regress AND it cannot quietly
 *      stay "temporarily" true forever without the pin being touched.
 *      (Fix round 2, F1: `DockControl.tsx` closed -- see the constant's own
 *      comment. The list is empty; kept as a named export rather than
 *      deleted so a future exception has an obvious place to go.)
 *   2. Every module that invalidates `qk.wellness` on a write-settle either
 *      defines `hasPendingPrefsWrite` (this is prefsMutation.ts itself) or
 *      imports it -- except the tracked, open exceptions in
 *      `OPEN_UNGUARDED_INVALIDATORS_F3`, each an X3 hazard already reported
 *      and awaiting its own owner. Same pin-and-fail discipline as above.
 *   3. (Fix round 2, N1) Patterns 1 and 2 only catch a writer built on
 *      `useOptimistic`/`useMutation`, keyed literally -- they miss the shape
 *      that actually causes F1's durable half: a bespoke
 *      `from('wellness').select('prefs') -> update({ prefs: ... })` /
 *      `insert({ ..., prefs: ... })` round trip, hand-rolled outside any
 *      query-cache hook entirely (`prefsMutation.ts`'s own writer is exactly
 *      this shape, plus `record.ts`'s ruled-legitimate second writer). A
 *      third pinned, exact-equality list closes that gap: see
 *      `ALLOWED_READ_MERGE_WRITE_WRITERS` below.
 *
 * A module scan, not a literal AST check -- `prefsMutation.ts`'s own writer
 * does not call `useOptimistic`/`useMutation` by name (it is hand-rolled:
 * `setQueryData` + a module-level debounce timer), so pattern 1 only needs
 * to catch OTHER files reaching for the shared `useOptimistic` helper (or a
 * bespoke one) directly against this key instead of going through the
 * shared writer; pattern 3 exists precisely to catch hand-rolled writers
 * like `prefsMutation.ts`'s own, wherever else one might appear.
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

/** F1 (fix round 2, 2026-09-07): `DockControl.tsx` used to keep its own
 *  independent writer on `wellness.prefs.dock.placement`; it now routes
 *  through `useDockPrefsMutation`, the same delegation `Dock.tsx`'s own
 *  placement control already used -- closed, no open exceptions remain. */
const OPEN_WRITER_EXCEPTIONS_F1: string[] = []

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

/**
 * F3 (fix round 2, 2026-09-07): re-verified all three previously tracked
 * exceptions against the live tree rather than carrying the prior round's
 * list forward unchecked.
 *
 * - `derot/arcade/[kind]/page.tsx` and `derot/play/[game]/page.tsx`: both
 *   now guarded (`if (!hasPendingPrefsWrite(userId)) void cache.invalidate
 *   Queries(...)`), landed by a different lane's already-approved fix
 *   (`5ab2090`) -- closed, not by this lane.
 * - `src/hooks/useExerciseLoop.ts`: this lane's controller grant explicitly
 *   forbids editing this file -- the exercise lane owns it and has
 *   uncommitted work in flight (`git status` at the time of this round shows
 *   it modified, not this lane's change). Re-checked read-only anyway: the
 *   old local `recordGoalAndStreak` read-modify-write the prior round's pin
 *   was about is gone from the file as of that uncommitted edit --
 *   `recordRewardsAfterSettle` now calls the shared, already-guarded writer
 *   (`src/lib/rewards/record.ts`'s `recordGoalDay`, guarded at
 *   `record.ts:152` since lane F2's `ec14890`) instead of invalidating
 *   `qk.wellness` itself. The file no longer matches this scan's pattern and
 *   is correctly absent below.
 *
 *   This is an observation about a file this lane does not own and must not
 *   touch, not a claim that the exercise lane's work is finished or final --
 *   if its next commit reintroduces an unguarded invalidate here (or
 *   anywhere else in the tree), this test fails again the moment that lands,
 *   which is the whole point of a live scan over a snapshot list.
 */
const OPEN_UNGUARDED_INVALIDATORS_F3: string[] = []

// ---------------------------------------------------------------------------
// 3. Read-merge-write raw writers (N1, fix round 2): a hand-rolled
//    `from('wellness')...update({ prefs: ... })` / `insert({ ..., prefs: ...
//    })` round trip, built entirely outside `useOptimistic`/`useMutation` --
//    the shape patterns 1 and 2 cannot see, and the shape that actually
//    causes F1's durable half (an unversioned write racing another one).
// ---------------------------------------------------------------------------

/** Requires `prefs` as an object key inside the same `update({...})` /
 *  `insert({...})` call (bounded by the nearest `}`, not just "somewhere
 *  later in the file") -- narrow enough that `Dock.tsx`'s row-column writer
 *  (`update({ ...patch, ... })`, `insert({ user_id, ...patch })`, neither
 *  ever spelling `prefs` as a literal key) does not false-positive. */
const RAW_PREFS_WRITE_CALL_PATTERN = /(?:update|insert)\(\{[^}]*\bprefs\s*:/

function isReadMergeWritePrefsWriter(content: string): boolean {
  return content.includes("from('wellness')") && RAW_PREFS_WRITE_CALL_PATTERN.test(content)
}

/** The two writers the wave 2 review calls legitimate: the shared queue
 *  itself, and `record.ts`'s independent `recordGoalDay` (ruled a
 *  legitimate parallel writer for `prefs.goalDays` rather than routed
 *  through the queue, on the condition that its own settle-invalidate is
 *  guarded -- see pattern 2's `guardsPendingWrite`, which confirms it is,
 *  at `record.ts:152`). Exact-equality, same discipline as
 *  `ALLOWED_RAW_WRITERS` above: a third file adopting this shape (copying
 *  `useExerciseLoop`'s old pattern, say) fails this test the moment it
 *  lands, rather than silently becoming a sixth writer nobody counted. */
const ALLOWED_READ_MERGE_WRITE_WRITERS = [
  'src/app/(app)/account/prefsMutation.ts',
  'src/lib/rewards/record.ts',
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

  it('N1: no new file constructs a bespoke wellness.prefs read-merge-write beyond the tracked list', () => {
    const writers = sourceFiles
      .filter((file) => isReadMergeWritePrefsWriter(fileContents.get(file) ?? ''))
      .map(toSrcPath)
      .sort()

    expect(writers).toEqual(ALLOWED_READ_MERGE_WRITE_WRITERS)
  })
})
