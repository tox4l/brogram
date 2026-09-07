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
// T4_5_SHELL (src/components/shell, src/components/wellness, src/components/buddy, src/components/ui,
// src/app/(app)/account, src/components/account): every rule cleared to zero across the whole row
// except two narrow, load-bearing exceptions -- see the individual 'src/components/wellness' (spacing-
// scale), 'src/components/buddy'/'src/components/ui' (radii) and 'src/components/ui' (motion-css)
// entries below, each with its own comment. No blanket prefix constant remains.
// T4_6_COURSE (src/app/(app)/dashboard, src/app/(app)/courses, src/app/(app)/course, src/components/course):
// every rule below cleared to zero for T4.6's own paths, so no allowlist entry -- and therefore no
// prefix constant -- remains.
// T4_7_EXERCISE (src/app/(app)/exercise, src/components/exercise): every rule below cleared to
// zero for T4.7's own paths, so no allowlist entry -- and therefore no prefix constant -- remains.
// T4_8_DEROT (src/app/(app)/derot, src/components/derot, src/components/rewards, src/components/play):
// every rule below cleared to zero for T4.8's own paths, so no allowlist entry -- and therefore no
// prefix constant -- remains.
// T4_9_SCREENS (src/app/(app)/reports, src/components/report, src/app/(auth), src/app/(app)/onboarding,
// src/app/page.tsx): every rule below cleared to zero for T4.9's own paths, so no allowlist entry --
// and therefore no prefix constant -- remains.
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
    // T4.5's entry deleted: shell/wellness/buddy/account (ui is out of this
    // rule's scope by design) now hold zero raw type-scale classes -- every
    // site maps to the additive scale (--text-micro|small|body|lede|h1..h3).
    // T4.6's entry deleted: dashboard/courses/course/[code]/components/course
    // now hold zero raw type-scale classes.
    // T4.7's entry deleted: exercise/exercise-components now hold zero raw
    // type-scale classes.
    // T4.8's entry deleted: derot/derot-components/rewards now hold zero raw
    // type-scale classes -- every site maps to the additive scale
    // (--text-micro|small|body|lede|h1..h3, --text-hero for the run screens'
    // headline numerals and the level-up celebration's big number).
    // T4.9's entry deleted: reports/report/(auth)/onboarding/page.tsx now
    // hold zero raw type-scale classes.
    ...entriesFor('T4.11', T4_11_CARRIED_DEBT, CARRIED_DEBT_NOTE),
  ],
  'palette-classes': [
    // T4.5's entry deleted: shell/wellness/buddy/ui/account now hold zero
    // hard-coded Tailwind palette classes (the three remaining hits --
    // DockControl.tsx's reminder dot, PrayerTimes.tsx's toggle track,
    // account/page.tsx's range-input accent -- moved to --primary tokens).
    // T4.6's entry deleted: the single emerald hit (the dashboard resume
    // card's gradient wash) moved to a plain --card fill -- the card reads
    // as a raised surface through its own token now, not a hard-coded tint.
    // T4.7's entry deleted: the six emerald hits (submit button, verdict
    // icon, results row/review-praise text, the fix-plan hint accent, the
    // spot-the-bug pressed line) moved to --primary/--success/--rule per
    // the role each one actually plays, not its old hue.
    // T4.8's entry deleted: the one hit (CountdownRing.tsx's amber urgency
    // band) moved to --warning -- the semantic token for the same role.
    // T4.9's entry deleted: every emerald/neutral hit in reports, report
    // sections, login and the landing page moved to a semantic token.
  ],
  'spacing-scale': [
    ...entriesFor('T4.4', T4_4_LESSON, ALL_SCREENS_NOTE('T4.4')),
    // T4.5's entry narrowed from the whole shell/wellness/buddy/ui/account
    // row to one component: `src/components/wellness/PrayerTimes.tsx`'s
    // toggle-switch knob is inset `top-0.5 left-0.5` (2px) inside a `h-4`
    // (16px) track around a `size-3` (12px) knob -- (16 - 12) / 2 = 2px
    // exactly. Moving to the nearest rhythm step (`top-1 left-1`, 4px)
    // leaves only 8px for a 12px knob and clips it. Every other spacing
    // utility under shell/wellness/buddy/ui/account now sits on the
    // eight-step rhythm.
    ...entriesFor('T4.5', ['src/components/wellness'], 'PrayerTimes.tsx toggle-knob inset is load-bearing geometry, not a rhythm miss — see the comment above this entry.'),
    // `src/components/ui` (badge/button/drawer/input/tabs): the fractional
    // Tailwind paddings/gaps (py-0.5, px-2.5, gap-1.5, ...) are base-ui/
    // shadcn primitive internals tuned against those components' own fixed
    // pixel heights (h-5/h-6/h-7/h-8) to keep icon and label vertically
    // centred at each size step -- rounding every one onto the eight-step
    // rhythm changes the vertical centring of text and icons inside a fixed-
    // height control used on every screen in the app, which is a visual
    // regression risk this pure-presentation sweep does not have the
    // rendered-screenshot coverage to verify safely across every consumer.
    ...entriesFor('T4.5', ['src/components/ui'], 'shadcn/base-ui primitive micro-padding tuned to fixed control heights (h-5..h-8) — see the comment above this entry.'),
    // T4.6's entry deleted: dashboard/courses/course/[code]/components/course
    // now sit on the eight-step rhythm.
    // T4.7's entry deleted: exercise/exercise-components now sit on the
    // eight-step rhythm.
    // T4.8's entry deleted: derot/derot-components/rewards now sit on the
    // eight-step rhythm.
    // T4.9's entry deleted: every owned path now sits on the eight-step rhythm.
    ...entriesFor('T4.11', T4_11_CARRIED_DEBT, CARRIED_DEBT_NOTE),
  ],
  radii: [
    ...entriesFor('T4.4', T4_4_LESSON, ALL_SCREENS_NOTE('T4.4')),
    // T4.5's entry narrowed from the whole shell/wellness/buddy/ui/account
    // row to one component: `src/components/buddy/Drawer.tsx`'s full-height
    // side panel is flush with three screen edges (`inset-y-0 right-0`), so
    // `rounded-none` is the correct shape for a sheet with nowhere to show a
    // corner -- rounding it to any of lg/xl/2xl/full would visibly clip a
    // corner off the viewport edge. `src/components/ui/drawer.tsx`'s
    // `rounded-[inherit]` on `DrawerContent` is the second remaining site:
    // it mirrors whichever per-direction radius `DrawerPrimitive.Popup`
    // actually renders (`rounded-t-xl`, `rounded-l-xl`, ...) so the content's
    // own overflow-clip matches the popup's real corner without re-deriving
    // the same four-way conditional a second time. Every other radius under
    // shell/wellness/buddy/ui/account now sits on rounded-(lg|xl|2xl|full).
    ...entriesFor('T4.5', ['src/components/buddy', 'src/components/ui'], 'Drawer.tsx (buddy) rounded-none and drawer.tsx (ui) rounded-[inherit] are load-bearing shape, not a scale miss — see the comment above this entry.'),
    // T4.6's entry deleted: dashboard/courses/course/[code]/components/course
    // now sit on rounded-(lg|xl|2xl|full).
    // T4.7's entry deleted: exercise/exercise-components now sit on
    // rounded-(lg|xl|2xl|full).
    // T4.8's entry deleted: derot/derot-components/rewards now sit on
    // rounded-(lg|xl|2xl|full).
    // T4.9's entry deleted: every owned path now sits on rounded-(lg|xl|2xl|full).
    ...entriesFor('T4.11', T4_11_CARRIED_DEBT, CARRIED_DEBT_NOTE),
  ],
  'icon-size': [
    ...entriesFor('T4.4', T4_4_LESSON, ALL_SCREENS_NOTE('T4.4')),
    // T4.5's entry deleted: every lucide icon under shell/wellness/buddy/ui/
    // account now renders at size-4 (16px) or larger -- the wellness rail's
    // five inline size-3.5 glyphs (Dock, Pomodoro, PrayerTimes,
    // WaterStretch x2) and the button/badge parent-selector defaults for the
    // xs/sm/icon-xs button sizes were the six sites raised.
    // T4.6's entry deleted: every lucide icon under dashboard/courses/
    // course/[code]/components/course now renders at size-4 (16px) or
    // larger.
    // T4.7's entry deleted: the back-link chevron and the pass/fail glyphs
    // (both previously size-3/size-3.5) now render at size-4.
    // T4.8's entry deleted: the arcade/play back-link chevrons and
    // Celebration.tsx's dismiss glyph (all previously size-3) now render at
    // size-4.
  ],
  'motion-css': [
    // src/components/ui/* (badge, button, progress, tabs: transition-all)
    // and src/components/ui/drawer.tsx (an animated height in its own
    // arbitrary transition-property list) are T4.5's.
    // T4.8's entry deleted: src/components/rewards had no genuine
    // `transition: all`/`ease-in`/animated-width-height-top-left hit --
    // the rule's own comment ("ease-in on celebration timing, pre-T4.2-
    // registerEases") described a `power1/2.out` GSAP ease string, which
    // this rule's regex never matched in the first place (it looks for the
    // CSS/Tailwind `ease-in` token); the real fix for that mismatch is
    // T4.2's `registerEases()` (already landed), not a source change here.
    ...entriesFor('T4.5', ['src/components/ui'], ALL_SCREENS_NOTE('T4.5')),
  ],
  // 'filled-buttons-per-route': T4.7's only entry (exercise/[id]/page.tsx's
  // two filled-variant Buttons -- Submit and Next rep, both mounted at once
  // once a rep is passed) is deleted: Submit now steps down to
  // `variant="outline"` once `loop.outcome === 'passed'`, a real state
  // change (Next rep becomes the sole acting primary action from that point
  // on), not a scanner workaround.
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

// The will-change budget (Step 2's one *hard* cap -- "at most three
// selectors," no allowlist by design) is cleared: T4.5 dropped drawer.tsx's
// occurrence and T4.8 dropped its own four (FollowTheDot.tsx x2,
// KeepTime.tsx x2), so the CLI reports 0 <= 3 on its own and
// WILL_CHANGE_TRANSFORM_ALLOWANCE (the recorded ceiling that tracked this
// while it was red) and discipline.test.ts's matching canary are deleted.
