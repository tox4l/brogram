'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'
import { useWellness } from '@/lib/query/hooks'
import { DEFAULT_WELLNESS } from '@/lib/contracts'
import { THEME_SEED_MARKER_KEY, THEMES } from './themes'
import type { ThemeName } from '@/lib/contracts'

const THEME_IDS = THEMES.map((entry) => entry.id)

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_IDS as string[]).includes(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * X5 (wave 2 review, section 6): `wellness.prefs.theme` was resolved and
 * defaulted on every read, and defaulted on every write path too, but never
 * actually round-tripped through `wellness.prefs` -- a choice made on one
 * device never reached another. Spec §8.2 step 2: "On sign-in, reconcile: a
 * server value that differs from the local value wins and overwrites
 * `localStorage`; a local value chosen before any server value existed
 * becomes the first write."
 *
 * `resolveWellnessPrefs` (`src/lib/wellness/prefs.ts`) always hands back a
 * *defaulted* `theme` -- every consumer that wants a complete `WellnessPrefs`
 * needs exactly that, but it also means "does the row carry a theme" can
 * never be answered by reading the resolved value: a row with no stored
 * theme at all and a row that explicitly stores the default both resolve to
 * `'midnight'`. This hook is the one place that deliberately reads the RAW,
 * unresolved `prefs` blob instead, because presence is the only signal that
 * distinguishes "never chosen" from "chose the default" -- see the residual
 * gap noted below.
 *
 * Runs once per resolved wellness row per signed-in user (`ranForRef`):
 *  - a stored theme that differs from the theme already applied locally
 *    wins and is applied here (a learner who picked Folio on another device
 *    sees Folio the next time they sign in elsewhere);
 *  - a row with no stored theme at all keeps whatever is applied locally
 *    and writes it back -- UNLESS that local value is still exactly what
 *    `seedInitialTheme` guessed (G2, fix round) or equals
 *    `DEFAULT_WELLNESS.theme` (G3, fix round; see the gap note below), in
 *    which case nothing is written. Only a value the learner actually chose,
 *    that differs from the seeded default, becomes the cross-device source
 *    of truth.
 *
 * Mounted once, from `ShellHeaderControls` (rendered on every authenticated
 * route via `AppShell`) -- not from `ThemeQuickSwitch` or the Account page,
 * so it reconciles regardless of which screen a learner happens to land on
 * first after signing in.
 *
 * G2 (fix round, wave 2 review section 6): a learner who never opened the
 * theme picker had their OS-seeded palette written to `wellness.prefs.theme`
 * on first sign-in as though it were a decision -- a light-OS laptop's seed
 * ('paper') then overrode a dark-OS phone's own seed ('midnight') the next
 * time this hook ran there. `seedInitialTheme` (`src/lib/theme/themes.ts`)
 * now marks exactly what it wrote (`THEME_SEED_MARKER_KEY`); this hook skips
 * the write-back while the local theme still equals that mark, so an
 * unconfirmed guess never leaves the device it was guessed on. Both
 * `applyTheme` paths (`ThemeQuickSwitch.tsx`, `account/page.tsx`) clear the
 * mark the instant the learner makes a real pick, so that pick still
 * round-trips normally.
 *
 * G3 (fix round, wave 2 review section 6) -- interim mitigation only, gap
 * still open: `prefsPatch` (`src/lib/wellness/prefs.ts`) strips any key that
 * equals `DEFAULT_WELLNESS` before a write reaches Postgres, and
 * `DEFAULT_WELLNESS.theme` is `'midnight'`. Before this fix round, an
 * *explicit* re-pick of Midnight on a device that previously had something
 * else was written as an absent key -- indistinguishable from "never
 * chosen" -- and the learner's real Amber/Eclipse/Folio/Arcade choice on
 * another device would then overwrite Midnight right back on the next
 * sign-in there, repeatedly; separately, every learner sitting on the
 * default fired a full select+update+refetch of `qk.wellness` on every cold
 * load, to store nothing. This hook now also skips the write-back whenever
 * the local theme equals `DEFAULT_WELLNESS.theme`, which stops the pointless
 * write and therefore the revert loop -- but an explicit re-pick of Midnight
 * is now simply never written at all, same as before. Closing that properly
 * needs a presence field (e.g. a `themeSetAt` timestamp) or a `theme`-
 * specific carve-out in `prefsPatch`/`DEFAULT_WELLNESS`
 * (`src/lib/wellness/prefs.ts`, `src/lib/contracts.ts`) -- both outside this
 * lane's owned paths, so this is flagged rather than fixed here; see the
 * W2FIX-G report for the routing this needs (prefs.ts's owner, or X5 held
 * open).
 */
export function useThemeSync(userId: string | null): void {
  const { theme, setTheme } = useTheme()
  const wellnessQuery = useWellness()
  const prefsMutation = useWellnessPrefsMutation(userId)
  const ranForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || !wellnessQuery.data || theme === undefined) return
    if (ranForRef.current === userId) return
    ranForRef.current = userId

    const raw = wellnessQuery.data.prefs
    const storedTheme = isPlainObject(raw) ? raw.theme : undefined

    if (isThemeName(storedTheme)) {
      if (storedTheme !== theme) setTheme(storedTheme)
    } else if (isThemeName(theme)) {
      // G2: skip when the local value is still exactly the OS-derived guess
      // `seedInitialTheme` wrote, unconfirmed by any real pick.
      let seededValue: string | null = null
      try { seededValue = window.localStorage.getItem(THEME_SEED_MARKER_KEY) } catch { /* no storage access */ }
      const isUnchosenSeed = seededValue === theme
      // G3 (interim): skip the default too, so a learner sitting on Midnight
      // does not fire a select+update+refetch cycle on every cold load to
      // store nothing (`prefsPatch` would strip the key right back out).
      const isDefault = theme === DEFAULT_WELLNESS.theme
      if (!isUnchosenSeed && !isDefault) prefsMutation.mutate(() => ({ theme }))
    }
    // prefsMutation.mutate is stable (useCallback keyed on queryClient/userId,
    // src/app/(app)/account/prefsMutation.ts) but is intentionally excluded
    // from the deps list below: including it would satisfy exhaustive-deps
    // with no behaviour change, since `ranForRef` already guards against
    // ever running this body more than once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, wellnessQuery.data, theme, setTheme])
}
