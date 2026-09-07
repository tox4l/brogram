import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import type { Exercise } from '../src/lib/contracts'
import { LINE_BANK } from '../src/lib/voice/lines'
import { readEnv, hasEnv, serviceClient, createOrReuseInvitedUser, mintSession, resetLearnerData, type E2eEnv } from './support/session'

const env = readEnv()

test('blur → overlay → focus → overlay gone, event row exists', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const email = process.env.E2E_TEST_EMAIL
  test.skip(!email || !email.endsWith('.edu.qa'), 'Set E2E_TEST_EMAIL to a .edu.qa address before running this spec.')
  const service = serviceClient(env as E2eEnv)

  const { exercises } = JSON.parse(await readFile(resolve('seed/exercises/smoke.json'), 'utf8')) as { exercises: Exercise[] }
  const smoke = exercises.find((exercise) => exercise.language === 'python')!
  const seeded = await service.from('exercises').select('id').eq('clo_id', smoke.cloId).eq('title', smoke.title).single()
  if (seeded.error) throw new Error('Load the smoke seed before C5.', { cause: seeded.error })
  const exerciseId: string = seeded.data.id

  const { userId, link } = await createOrReuseInvitedUser(service, email!)
  await resetLearnerData(service, userId)

  try {
    await mintSession(env as E2eEnv, context, baseURL!, link)

    await page.goto(`/exercise/${exerciseId}`)
    await expect(page.getByTestId('exercise-workspace')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Code editor' })).toBeVisible()

    const overlay = page.getByTestId('lockdown-overlay')
    await expect(overlay).toHaveCount(0)

    // useLockdown listens on window 'blur'/'focus' directly, independent of document.visibilityState,
    // so a synthetic dispatch on window is enough to exercise it without actually switching tabs.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveAttribute('data-reason', 'blur')
    // T2.8 fix round 1, I1: the body copy is now one of the bank's own
    // guard.blur variants (what the app actually saw), not the hardcoded
    // "Come back to continue" heading this used to render.
    await expect(overlay).toHaveText(new RegExp(LINE_BANK['guard.blur'].variants.map((variant) => variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')))

    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(overlay).toHaveCount(0)

    // The batch write is on a 1s interval per event type; poll the service client rather than sleeping
    // a fixed amount.
    await expect(async () => {
      const events = await service.from('integrity_events').select('id').eq('user_id', userId).eq('exercise_id', exerciseId).eq('type', 'blur')
      if (events.error) throw events.error
      expect(events.data.length).toBeGreaterThan(0)
    }).toPass({ timeout: 20_000 })

    // R9.1/R9.2: PrintScreen gets no overlay of its own, ever -- a screenshot is already
    // captured by the OS before this `keyup` even fires, so a full-screen cover would only ever
    // punish a learner for an unrelated reason (useLockdown.ts's own module doc). What it does
    // get is one honest, non-blocking line, exactly once, on the third press in this exercise
    // (`PRINTSCREEN_NOTE_AT`). Presses are spaced a beat past `logIntegrity`'s 1s same-type
    // coalescing window so all three genuinely count, not just the first.
    const printscreenNote = page.getByText(LINE_BANK['guard.printscreen'].variants[0], { exact: true })
    await expect(printscreenNote).toHaveCount(0)
    for (let press = 1; press <= 3; press++) {
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PrintScreen' })))
      await expect(overlay).toHaveCount(0)
      if (press < 3) {
        await expect(printscreenNote).toHaveCount(0)
        await page.waitForTimeout(1_100)
      }
    }
    await expect(printscreenNote).toBeVisible()

    await expect(async () => {
      const events = await service.from('integrity_events').select('id').eq('user_id', userId).eq('exercise_id', exerciseId).eq('type', 'printscreen')
      if (events.error) throw events.error
      expect(events.data.length).toBe(3)
    }).toPass({ timeout: 20_000 })
  } finally {
    await resetLearnerData(service, userId)
  }
})
