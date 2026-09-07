'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'
import { useWellness } from '@/lib/query/hooks'
import { THEMES } from './themes'
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
 *    (the OS-seeded value, or a theme picked before this ever ran) and
 *    writes it back, so the first device to make a choice becomes the
 *    cross-device source of truth from then on.
 *
 * Mounted once, from `ShellHeaderControls` (rendered on every authenticated
 * route via `AppShell`) -- not from `ThemeQuickSwitch` or the Account page,
 * so it reconciles regardless of which screen a learner happens to land on
 * first after signing in.
 *
 * Known, deliberately unclosed gap (needs a file this fix lane does not
 * own): `prefsPatch` (`src/lib/wellness/prefs.ts`) strips any key that
 * equals `DEFAULT_WELLNESS` before a write reaches Postgres, and
 * `DEFAULT_WELLNESS.theme` is `'midnight'` -- the very value `seedInitialTheme`
 * seeds most devices with. So an *explicit* re-pick of Midnight, on a device
 * that previously had something else, is written as an absent key,
 * indistinguishable from "never chosen" the next time this hook runs
 * elsewhere. Every non-default choice (Amber, Eclipse, Folio, Arcade) round-
 * trips correctly; only "explicitly choosing the seeded default" is affected.
 * Closing it needs a presence field (e.g. a `themeSetAt` timestamp) or a
 * `theme`-specific carve-out in `prefsPatch`/`DEFAULT_WELLNESS`
 * (`src/lib/wellness/prefs.ts`, `src/lib/contracts.ts`) -- both outside this
 * lane's owned paths, so this is flagged rather than fixed here.
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
      prefsMutation.mutate(() => ({ theme }))
    }
    // prefsMutation.mutate is stable (useCallback keyed on queryClient/userId,
    // src/app/(app)/account/prefsMutation.ts) but is intentionally excluded
    // from the deps list below: including it would satisfy exhaustive-deps
    // with no behaviour change, since `ranForRef` already guards against
    // ever running this body more than once per signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, wellnessQuery.data, theme, setTheme])
}
