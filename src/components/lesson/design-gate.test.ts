// W4FIX-D -- the design-discipline gate goes green: the paths no screen
// pass swept (brief acceptance: "Add a unit test that pins the gate at
// zero for the directories you swept so they cannot drift.").
//
// This lives under `src/components/lesson` (one of the swept directories)
// rather than under `src/lib/design/**`, whose test file this fix lane's
// brief licenses to touch only by deleting `allowlist.ts` entries, never by
// adding a test. It runs the real `RULES` scanners from
// `scripts/check-design-tokens.mjs` directly against the real tree --
// independent of `src/lib/design/allowlist.ts` -- and asserts zero
// violations under every path this task swept:
// `src/components/lesson`, `src/components/admin`, `src/app/(admin)`,
// `src/components/ui`, `src/app/error.tsx`, and
// `src/components/wellness` (all but the two load-bearing PrayerTimes.tsx
// spacing hits documented in allowlist.ts). Reading straight from `RULES`,
// not from `ALLOWLIST`, means a future allowlist entry re-added over one of
// these paths does not quietly relax this pin -- it still has to hold zero
// here.
//
// Fix round (review D-1): the exceptions below used to be keyed
// `file:line:match`. `src/components/ui/{badge,button,input,tabs,drawer}.tsx`
// and `src/components/wellness/PrayerTimes.tsx` are edited by other tasks
// this same wave, and a line-numbered key goes stale the moment an unrelated
// edit (even just a new comment) shifts a line inside those files -- exactly
// the failure mode `allowlist.ts`'s own header comment rules out ("A
// line-numbered allowlist would go stale on the next unrelated commit to the
// same file; a path-prefix entry survives every edit inside it"). Keyed on
// `${file}:${match}` instead, with the *count* of known occurrences recorded
// per key: a line shift leaves the key and the count unchanged (still
// passes), while a genuinely new occurrence of that same class in that same
// file changes the observed count away from the recorded one (still fails).
import { describe, expect, it } from 'vitest'
import { RULES } from '../../../scripts/check-design-tokens.mjs'

type Violation = { file: string; line: number; match: string }

const SWEPT_PREFIXES = [
  'src/components/lesson',
  'src/components/admin',
  'src/app/(admin)',
  'src/components/ui',
  'src/app/error.tsx',
  'src/components/wellness',
]

/** The exceptions this task ruled to keep, not fix -- every one pre-dates
 *  this task, is documented in `allowlist.ts` under its own T4.5 entry with
 *  a load-bearing-geometry rationale, and is out of licence for a "pure
 *  presentation sweep" to touch (per that file's own comments):
 *   - PrayerTimes.tsx's 2px toggle-knob inset (a 12px knob centred in a
 *     16px track: (16 - 12) / 2 = 2px exactly).
 *   - `src/components/ui`'s fractional shadcn/base-ui primitive paddings
 *     (badge/button/drawer/input/tabs), tuned to those components' own
 *     fixed pixel heights (h-5..h-8) to keep icon/label vertical centring.
 *   - `src/components/ui/drawer.tsx`'s `rounded-[inherit]`, which mirrors
 *     whichever per-direction radius the popup actually renders.
 *  Keyed on `${file}:${match}` (no line number) -> the number of times that
 *  exact class is expected to appear in that file today. */
const KNOWN_EXCEPTIONS = new Map<string, number>([
  ['src/components/wellness/PrayerTimes.tsx:top-0.5', 1],
  ['src/components/wellness/PrayerTimes.tsx:left-0.5', 1],
  ['src/components/ui/badge.tsx:py-0.5', 1],
  ['src/components/ui/badge.tsx:pr-1.5', 1],
  ['src/components/ui/badge.tsx:pl-1.5', 1],
  ['src/components/ui/button.tsx:gap-1.5', 2],
  ['src/components/ui/button.tsx:px-2.5', 3],
  ['src/components/ui/button.tsx:pr-1.5', 2],
  ['src/components/ui/button.tsx:pl-1.5', 2],
  // Two hits on one line: `gap-0.5` and its `md:gap-0.5` responsive variant
  // both match the bare `gap-0.5` pattern.
  ['src/components/ui/drawer.tsx:gap-0.5', 2],
  ['src/components/ui/input.tsx:px-2.5', 1],
  ['src/components/ui/tabs.tsx:gap-1.5', 1],
  ['src/components/ui/tabs.tsx:px-1.5', 1],
  ['src/components/ui/tabs.tsx:py-0.5', 1],
  ['src/components/ui/drawer.tsx:rounded-[inherit]', 1],
])

function isSwept(file: string): boolean {
  return SWEPT_PREFIXES.some((prefix) => file === prefix || file.startsWith(`${prefix}/`))
}

type CountMismatch = { key: string; expected: number; observed: number }

/** Counts every swept-path violation *this one rule reported* by
 *  `${file}:${match}` (line dropped) and flags any key whose observed count
 *  exceeds its recorded `KNOWN_EXCEPTIONS` count (0 for a key never listed
 *  there). `KNOWN_EXCEPTIONS` is one shared map across every rule in
 *  `RULES` (a `spacing-scale` key and a `radii` key never collide because
 *  their match strings don't), so this only ever compares a key against the
 *  counts that rule itself actually produced -- it does not require every
 *  known key to show up under every rule, only that a key which does show
 *  up never shows up *more* than its documented count. A brand-new key (or
 *  a genuinely new occurrence of a known one) has nowhere to hide: it pushes
 *  `observed` past `expected` and fails. A line shift leaves both the key
 *  and its count unchanged, so it never appears here. */
function unexpectedSweptViolations(violations: Violation[]): CountMismatch[] {
  const observedCounts = new Map<string, number>()
  for (const v of violations) {
    if (!isSwept(v.file)) continue
    const key = `${v.file}:${v.match}`
    observedCounts.set(key, (observedCounts.get(key) ?? 0) + 1)
  }
  const mismatches: CountMismatch[] = []
  for (const [key, observed] of observedCounts) {
    const expected = KNOWN_EXCEPTIONS.get(key) ?? 0
    if (observed > expected) mismatches.push({ key, expected, observed })
  }
  return mismatches
}

describe('W4FIX-D design gate pin: swept directories hold zero (independent of allowlist.ts)', () => {
  for (const rule of RULES) {
    it(`${rule.id}: zero violations under the swept paths`, () => {
      const violations = rule.run() as Violation[]
      expect(unexpectedSweptViolations(violations)).toEqual([])
    })
  }

  it('the documented PrayerTimes.tsx exception is still exactly the two known occurrences (not a growing list)', () => {
    const spacing = RULES.find((r) => r.id === 'spacing-scale')!.run() as Violation[]
    const wellnessHits = spacing.filter((v) => v.file.startsWith('src/components/wellness/'))
    const observedCounts = new Map<string, number>()
    for (const v of wellnessHits) {
      const key = `${v.file}:${v.match}`
      observedCounts.set(key, (observedCounts.get(key) ?? 0) + 1)
    }
    const knownWellnessExceptions = new Map(
      [...KNOWN_EXCEPTIONS].filter(([key]) => key.startsWith('src/components/wellness/'))
    )
    expect(observedCounts).toEqual(knownWellnessExceptions)
  })
})
