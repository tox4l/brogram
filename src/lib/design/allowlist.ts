// T4.1 -- the design-discipline gates' allowlist (wave 4 plan T4.1 Step 3).
//
// `src/lib/design/discipline.test.ts` asserts zero violations from every
// rule in scripts/check-design-tokens.mjs *outside* the entries below.
// Every entry is scoped to a path prefix that exactly matches one row of
// the plan's file-ownership map (section 4) -- never a single file or line
// -- because the tree this task runs in is shared with T4.2-T4.4 (already
// running) and T4.5-T4.9 (about to start) editing those very directories.
// A line-numbered allowlist would go stale on the next unrelated commit to
// the same file; a path-prefix entry survives every edit inside it and is
// deleted in one line when its owning task finishes its sweep.
//
// **T4.5 through T4.9 (and T4.4, already mid-flight): delete your own
// entries below, per rule, once your owned paths pass that rule with zero
// violations.** An entry with no owner, or one naming a task that is not a
// real row in the plan's ownership map, is a review failure (T4.1's own
// acceptance block says so) -- there are none below for exactly that
// reason; the two genuine orphans this scan found (`src/app/layout.tsx`,
// `src/app/error.tsx` -- no task's step list sweeps either one) are
// excluded from the scanner's scope entirely instead of allowlisted here,
// and flagged in the T4.1 report as a gap for the plan owner, the same way
// `src/app/preview/**` and `(admin)` already are.
//
// Counts below are the tree's state when this file was written (commit
// message names the count); they are not re-verified here -- the test
// re-scans the real tree every run and only checks that violations outside
// these path prefixes are zero, so a task's partial fix is still visible as
// progress without needing this file touched mid-sweep.

export type AllowlistEntry = {
  /** A path-ownership-map prefix (plan section 4) -- matches a file when
   *  the file equals the prefix or starts with `${prefix}/`. */
  pathPrefix: string
  /** The plan task that owns this prefix and deletes this entry. */
  owner: string
  note: string
}

const T4_4_LESSON = ['src/components/lesson', 'src/app/(app)/lesson']
const T4_5_SHELL = [
  'src/components/shell',
  'src/components/wellness',
  'src/components/buddy',
  'src/components/ui',
  'src/app/(app)/account',
  'src/components/account',
]
const T4_6_COURSE = ['src/app/(app)/dashboard', 'src/app/(app)/courses', 'src/app/(app)/course', 'src/components/course']
const T4_7_EXERCISE = ['src/app/(app)/exercise', 'src/components/exercise']
const T4_8_DEROT = ['src/app/(app)/derot', 'src/components/derot', 'src/components/rewards', 'src/components/play']
const T4_9_SCREENS = ['src/app/(app)/reports', 'src/components/report', 'src/app/(auth)', 'src/app/(app)/onboarding', 'src/app/page.tsx']
// Fix round (review I3): these four paths used to be excluded from the
// scanner's scope entirely, by name, with no allowlist entry and no owner
// -- the review called that "hiding 36 real violations with no owner and no
// ledger row." None of them is a real row in the plan's section 4 ownership
// map this wave (`(admin)` and `components/admin` are swept by nobody,
// `layout.tsx`'s owner T4.0 has no footer-sweep step, `error.tsx` has no
// owner at all), so they are tracked here under **T4.11** -- the wave-
// review task -- as carried debt pending a ruling, not silently reported as
// clean and not silently reported as somebody else's job.
const T4_11_CARRIED_DEBT = ['src/app/(admin)', 'src/components/admin', 'src/app/layout.tsx', 'src/app/error.tsx']

function entriesFor(owner: string, prefixes: string[], note: string): AllowlistEntry[] {
  return prefixes.map((pathPrefix) => ({ pathPrefix, owner, note }))
}

const ALL_SCREENS_NOTE = (task: string) =>
  `Pre-existing debt measured before ${task}'s own screen sweep (plan section "Group B") lands; ${task} deletes this entry once its owned paths hold zero.`

const CARRIED_DEBT_NOTE =
  'No Wave 4 sweep owns this path (plan section 4 omits it). Flagged by the T4.1 fix round (review finding I3) rather than ' +
  "silently excluded from the scanner's scope. T4.11 records this in docs/build-log.md as carried debt, or the wave owner " +
  'assigns the path a real row and that task deletes this entry.'

export const ALLOWLIST: Record<string, AllowlistEntry[]> = {
  'raw-text-scale': [
    ...entriesFor('T4.4', T4_4_LESSON, ALL_SCREENS_NOTE('T4.4')),
    ...entriesFor('T4.5', T4_5_SHELL, ALL_SCREENS_NOTE('T4.5')),
    ...entriesFor('T4.6', T4_6_COURSE, ALL_SCREENS_NOTE('T4.6')),
    ...entriesFor('T4.7', T4_7_EXERCISE, ALL_SCREENS_NOTE('T4.7')),
    ...entriesFor('T4.8', T4_8_DEROT, ALL_SCREENS_NOTE('T4.8')),
    ...entriesFor('T4.9', T4_9_SCREENS, ALL_SCREENS_NOTE('T4.9')),
    ...entriesFor('T4.11', T4_11_CARRIED_DEBT, CARRIED_DEBT_NOTE),
  ],
  'palette-classes': [
    ...entriesFor('T4.5', T4_5_SHELL, ALL_SCREENS_NOTE('T4.5')),
    ...entriesFor('T4.6', T4_6_COURSE, ALL_SCREENS_NOTE('T4.6')),
    ...entriesFor('T4.7', T4_7_EXERCISE, ALL_SCREENS_NOTE('T4.7')),
    ...entriesFor('T4.8', T4_8_DEROT, ALL_SCREENS_NOTE('T4.8')),
    ...entriesFor('T4.9', T4_9_SCREENS, ALL_SCREENS_NOTE('T4.9')),
  ],
  'spacing-scale': [
    ...entriesFor('T4.4', T4_4_LESSON, ALL_SCREENS_NOTE('T4.4')),
    ...entriesFor('T4.5', T4_5_SHELL, ALL_SCREENS_NOTE('T4.5')),
    ...entriesFor('T4.6', T4_6_COURSE, ALL_SCREENS_NOTE('T4.6')),
    ...entriesFor('T4.7', T4_7_EXERCISE, ALL_SCREENS_NOTE('T4.7')),
    ...entriesFor('T4.8', T4_8_DEROT, ALL_SCREENS_NOTE('T4.8')),
    ...entriesFor('T4.9', T4_9_SCREENS, ALL_SCREENS_NOTE('T4.9')),
    ...entriesFor('T4.11', T4_11_CARRIED_DEBT, CARRIED_DEBT_NOTE),
  ],
  radii: [
    ...entriesFor('T4.4', T4_4_LESSON, ALL_SCREENS_NOTE('T4.4')),
    ...entriesFor('T4.5', T4_5_SHELL, ALL_SCREENS_NOTE('T4.5')),
    ...entriesFor('T4.6', T4_6_COURSE, ALL_SCREENS_NOTE('T4.6')),
    ...entriesFor('T4.7', T4_7_EXERCISE, ALL_SCREENS_NOTE('T4.7')),
    ...entriesFor('T4.8', T4_8_DEROT, ALL_SCREENS_NOTE('T4.8')),
    ...entriesFor('T4.9', T4_9_SCREENS, ALL_SCREENS_NOTE('T4.9')),
    ...entriesFor('T4.11', T4_11_CARRIED_DEBT, CARRIED_DEBT_NOTE),
  ],
  'icon-size': [
    ...entriesFor('T4.4', T4_4_LESSON, ALL_SCREENS_NOTE('T4.4')),
    ...entriesFor('T4.5', T4_5_SHELL, ALL_SCREENS_NOTE('T4.5')),
    ...entriesFor('T4.6', T4_6_COURSE, ALL_SCREENS_NOTE('T4.6')),
    ...entriesFor('T4.7', T4_7_EXERCISE, ALL_SCREENS_NOTE('T4.7')),
    ...entriesFor('T4.8', T4_8_DEROT, ALL_SCREENS_NOTE('T4.8')),
  ],
  'motion-css': [
    // src/components/ui/* (badge, button, progress, tabs: transition-all)
    // and src/components/ui/drawer.tsx (an animated height in its own
    // arbitrary transition-property list) are T4.5's; src/components/
    // rewards/* (ease-in on celebration timing, pre-T4.2-registerEases)
    // is T4.8's per the ownership map.
    ...entriesFor('T4.5', ['src/components/ui'], ALL_SCREENS_NOTE('T4.5')),
    ...entriesFor('T4.8', ['src/components/rewards'], ALL_SCREENS_NOTE('T4.8')),
  ],
  'filled-buttons-per-route': [
    // src/app/(app)/exercise/[id]/page.tsx: 3 filled-variant Buttons today
    // (Run/Submit-shaped controls with no explicit variant). Note this is a
    // *static* source count -- it will not, on its own, catch T4.8's
    // "six filled Starts" case on /derot, which is one JSX call site
    // rendered once per card inside a `.map()`; see the header comment on
    // `ruleFilledButtonsPerRoute` in scripts/check-design-tokens.mjs.
    ...entriesFor('T4.7', T4_7_EXERCISE, ALL_SCREENS_NOTE('T4.7')),
  ],
}

// Step 2's ratio rule (font-normal : font-medium >= 1:3) is a single
// whole-tree number, not a per-file violation list -- no one task can
// "delete an entry" to clear it, because every screen sweep this wave
// shifts the count. It stays a named floor the wave gate (plan section 8)
// re-checks after every screen sweep lands, and the owners below are every
// task whose sweep touches emphasis weight.
export const FONT_WEIGHT_RATIO_ALLOWANCE = {
  owners: ['T4.4', 'T4.5', 'T4.6', 'T4.7', 'T4.8', 'T4.9'],
  /** Re-measured in the T4.1 fix round (4 : 165 = 0.024) after review
   *  finding I3 widened the scanner's scope to include `(admin)`,
   *  `components/admin`, `layout.tsx` and `error.tsx` -- paths this rule
   *  did not previously count at all, and which alone carry 27 more
   *  font-medium hits and no font-normal ones. That scope widening, not a
   *  new regression in any owned screen, is the entire reason the floor
   *  moves from the original 4:138. The gate never accepts a ratio *below*
   *  this -- only at or above it, tightening toward 0.333 as each owner's
   *  sweep lands. */
  baselineRatio: 4 / 165,
  note:
    'font-normal:font-medium is 4:165 (originally 4:138 before the T4.1 fix round widened scope to admin/layout/error; ' +
    'spec section 1.2 measured 5:198) while body prose still defaults to font-medium; each screen sweep is expected to ' +
    'flip that default (prose to font-normal, font-medium reserved for real emphasis). Cleared, and this allowance ' +
    'deleted, once T4.4 through T4.9 have all landed and the ratio clears 1:3 on its own.',
}

// Fix round (review C1): the will-change budget is Step 2's one *hard* cap
// -- "at most three selectors," no allowlist by design -- but the original
// regex could not see the Tailwind utility form at all, so the CLI reported
// zero against a real count of five. Fixing the regex turns the gate
// honestly red, and the honest fix is not to raise the cap to five: it is
// this recorded ceiling, the same shape as FONT_WEIGHT_RATIO_ALLOWANCE,
// naming the two tasks whose own sweeps drop the count back under the cap.
export const WILL_CHANGE_TRANSFORM_ALLOWANCE = {
  owners: ['T4.5', 'T4.8'],
  /** Measured the day this file was written: src/components/ui/drawer.tsx
   *  (1, T4.5) and src/components/derot/play/FollowTheDot.tsx +
   *  KeepTime.tsx (2 each, T4.8) = 5 against Step 2's cap of 3. The gate
   *  never accepts a count *above* this -- only at or below it, tightening
   *  to 3 as T4.5 and T4.8 drop two of the five in their own sweeps. */
  baselineCount: 5,
  // Deliberately does not spell out the literal utility or CSS forms this
  // allowance is about: this file is itself scanned by scopeAllSrc() (rule
  // 6 and the will-change budget cover all of src/, allowlist.ts included),
  // and a string literal is never stripped the way a real comment is --
  // naming the class here verbatim would make this very note count as one
  // more occurrence against its own budget.
  note:
    "5 selectors against Step 2's hard cap of 3 (drawer.tsx x1, FollowTheDot.tsx x2, KeepTime.tsx x2) use the will-change " +
    "shorthand for the transform property. Cleared, and this allowance deleted, once T4.5 and T4.8 have each dropped " +
    'their share and the CLI reports <= 3 on its own.',
}
