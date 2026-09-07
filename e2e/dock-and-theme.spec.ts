import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { compileLearnerState } from '../src/lib/learner/compile'
import { readEnv, hasEnv, serviceClient, mintSession, deleteInvitedUser, type E2eEnv } from './support/session'

const env = readEnv()

/**
 * The dock's "Settings" `<details>` is a fresh, closed-by-default DOM node after EVERY placement
 * change, not only when the orientation category changes: `ShellLayout` renders the left-rail,
 * right-rail and top-strip wrappers as separate sibling JSX conditionals
 * (src/components/shell/ShellLayout.tsx), so switching even between two placements that both map
 * to `Dock`'s own "vertical" branch (`left` <-> `right`) still unmounts one `<aside>` and mounts a
 * different one at a different position in the tree -- a real remount, confirmed empirically (an
 * earlier version of this spec hung on a stale, since-collapsed `<select>` after exactly this).
 * This re-opens Settings only when it is not already open, so it never fights a still-open one.
 */
async function ensureDockSettingsOpen(page: Page) {
  const select = page.getByLabel('Dock position')
  if (!(await select.isVisible().catch(() => false))) {
    await page.getByText('Settings', { exact: true }).click()
  }
  await expect(select).toBeVisible()
  return select
}

async function chooseTheme(page: Page, name: string) {
  await page.getByRole('button', { name: 'Choose theme' }).click()
  await page.getByRole('radio', { name }).click()
}

/**
 * The dock through all five placements plus a collapse, the theme quick-switch through all four
 * of `Providers`' registered themes, then a reload -- every choice must survive it (spec 6/8,
 * plan Wave 3 acceptance). Order visits each placement exactly once while always leaving a route
 * back to "Settings": right (default) -> left -> float -> hidden -> (DockControl restores float)
 * -> top, where the dock is finally collapsed (the horizontal orientation's own chrome carries no
 * "Settings" section at all, so `top` is visited last).
 */
test('dock through all five placements plus a collapse, all four themes, reload, everything survives', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const service = serviceClient(env as E2eEnv)
  const email = `brogram-dock-theme-${randomUUID()}@test.edu.qa`
  const inviteCode = randomUUID()
  let userId: string | undefined

  try {
    const invite = await service.from('invites').insert({ code: inviteCode, email })
    if (invite.error) throw invite.error
    const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    userId = link.data.user.id
    const state = compileLearnerState({ id: userId }, [], [], [], null)
    state.profile.onboardingComplete = true
    state.version = 0
    const initial = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
    if (initial.error) throw initial.error

    await mintSession(env as E2eEnv, context, baseURL!, link.data)
    await page.goto('/dashboard')

    // Starting point: no `wellness` row yet, so `DEFAULT_WELLNESS.dock` applies -- placement
    // 'right', not collapsed (src/lib/contracts.ts).
    await expect(page.getByRole('heading', { name: 'Wellness' })).toBeVisible()
    let dockSelect = await ensureDockSettingsOpen(page)
    await expect(dockSelect).toHaveValue('right')

    // right -> left -- a remount (see `ensureDockSettingsOpen`'s doc comment); reopen Settings on
    // the freshly-mounted dock before reading its value.
    await dockSelect.selectOption('left')
    dockSelect = await ensureDockSettingsOpen(page)
    await expect(dockSelect).toHaveValue('left')

    // left -> float: the portal-rendered pill -- also a fresh mount.
    await dockSelect.selectOption('float')
    dockSelect = await ensureDockSettingsOpen(page)
    await expect(dockSelect).toHaveValue('float')

    // float -> hidden: `Dock` renders nothing visible at all now (headless) -- the header's
    // `DockControl` re-open glyph is the only way back, and it restores whichever non-hidden
    // placement was last remembered (`recallDockPlacement`), which is 'float' here.
    await dockSelect.selectOption('hidden')
    await expect(page.getByRole('heading', { name: 'Wellness' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Show wellness dock' }).click()
    dockSelect = await ensureDockSettingsOpen(page)
    await expect(dockSelect).toHaveValue('float')

    // float -> top: the fifth and last placement -- horizontal, and the one orientation with no
    // "Settings" section of its own, so it is visited last.
    await dockSelect.selectOption('top')
    await expect(page.getByRole('button', { name: 'Collapse wellness dock' })).toBeVisible()

    // Collapse it, at `top`.
    await page.getByRole('button', { name: 'Collapse wellness dock' }).click()
    await expect(page.getByRole('button', { name: 'Expand wellness dock' })).toBeVisible()

    // All four of `Providers`' registered themes (src/app/providers.tsx: midnight, amber, paper,
    // arcade). Whichever one `seedInitialTheme`'s empty-storage fallback picked for this fresh
    // context (`src/lib/theme/themes.ts` -- it depends on the emulated colour-scheme/contrast
    // media queries, which this spec does not pin) is irrelevant: every step below asserts the
    // theme it just chose, never assumes what came before it.
    for (const [name, id] of [['Amber', 'amber'], ['Folio', 'paper'], ['Midnight', 'midnight'], ['Arcade', 'arcade']] as const) {
      await chooseTheme(page, name)
      await expect(page.locator('html')).toHaveAttribute('data-theme', id)
    }

    // Wait for the debounced dock write (`useDockPrefsMutation`, ~400ms) to actually land on the
    // server before reloading -- a poll, not a fixed sleep, and a real read of the row every
    // other wellness writer (SoundToggle, Account) also reads and writes.
    await expect.poll(async () => {
      const row = await service.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
      if (row.error) throw row.error
      const dock = (row.data?.prefs as { dock?: { placement?: string; collapsed?: boolean } } | undefined)?.dock
      return dock?.placement === 'top' && dock?.collapsed === true
    }, { timeout: 20_000, message: 'dock placement/collapsed never persisted as top + collapsed' }).toBe(true)

    await page.reload()

    // Theme: `next-themes` reads its own `localStorage` key on load (client-only, no server round
    // trip) -- survives a reload in the same browser context by construction.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'arcade')

    // Dock: `top` + collapsed together are what put "Expand wellness dock" on screen at all
    // (the horizontal-collapsed chrome) -- this single assertion proves both choices survived.
    await expect(page.getByRole('button', { name: 'Expand wellness dock' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show wellness dock' })).toHaveCount(0)
  } finally {
    if (userId) await deleteInvitedUser(service, userId, inviteCode)
  }
})
