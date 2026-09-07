import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { readEnv, hasEnv, serviceClient, mintSession, deleteInvitedUser, type E2eEnv } from './support/session'

/**
 * Wave 4 spec §10 family D/E (plan T4.10 step 2). With motion on, every running animation's
 * `effect.getTiming().duration` stays inside the 900ms celebration ceiling (v2 §7.8); under
 * `emulateMedia({ reducedMotion: 'reduce' })` *and* under the in-app `wellness.prefs.motion =
 * 'reduced'` channel (`:root[data-motion='reduced']`, `src/components/motion/MotionAttribute.tsx`),
 * zero animations run 50ms after a navigation; lockdown, integrity and account-status surfaces show
 * zero animations in both channels; an `/exercise/[id]` navigation itself carries zero animations
 * even with motion on (standing constraint 8: "Juice fires at transitions, never during
 * composition").
 *
 * `document.getAnimations()` is the Web Animations API's own live list -- it reports every running
 * CSS transition/animation and every Web-Animations-driven tween (GSAP included, once registered
 * through it) with no instrumentation needed. Confirmed live against this tree (2026-09-08): a full
 * `getAnimations()` read on `/dashboard` came back empty at rest while the same read on `/course/
 * [code]` mid-entrance caught the path map's own 200ms node stagger -- proof this is reading a real,
 * populated list rather than an API that always reports nothing.
 */

const env = readEnv()

function learnerState(currentCourse: string | null, nextExerciseIds: string[] = []) {
  return {
    profile: { onboardingComplete: true, displayName: 'Motion' },
    currentCourse,
    path: currentCourse ? ['INFS2101-3'] : [],
    nextExerciseIds,
    mastery: {},
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    version: 0,
  }
}

async function mintMotionUser(service: ReturnType<typeof serviceClient>, tag: string, state: ReturnType<typeof learnerState>) {
  const email = `brogram-motion-${tag}-${randomUUID()}@test.edu.qa`
  const inviteCode = randomUUID()
  const invite = await service.from('invites').insert({ code: inviteCode, email })
  if (invite.error) throw invite.error
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const userId = link.data.user.id
  const inserted = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
  if (inserted.error) throw inserted.error
  return { userId, inviteCode, link: link.data }
}

interface AnimSummary { duration: number | null; playState: AnimationPlayState }

async function runningAnimations(page: Page): Promise<AnimSummary[]> {
  const all = await page.evaluate(() => document.getAnimations().map((a) => ({
    duration: typeof a.effect?.getTiming().duration === 'number' ? (a.effect!.getTiming().duration as number) : null,
    playState: a.playState,
  })))
  return all.filter((a) => a.playState === 'running')
}

test.describe('motion budget (spec family D/E)', () => {
  test('full motion: every running animation stays inside the 900ms celebration ceiling across a real navigation', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)
    const u = await mintMotionUser(service, 'full', learnerState('INFS2101'))
    try {
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto('/dashboard')
      await page.waitForTimeout(100)
      for (const a of await runningAnimations(page)) {
        expect(a.duration, `a running animation on /dashboard has no duration`).not.toBeNull()
        expect(a.duration!, `a running animation on /dashboard exceeds the 900ms ceiling`).toBeLessThanOrEqual(900)
      }
      // The path map's own node-entrance stagger (`NodeItem.tsx`) is this app's one reliable,
      // always-present entrance animation -- asserted non-empty so this test is proven to have
      // actually sampled something, not vacuously passed over an empty list.
      await page.goto('/course/INFS2101')
      await page.waitForTimeout(100)
      const courseAnims = await runningAnimations(page)
      expect(courseAnims.length, 'expected the course-home node stagger to be running at least once').toBeGreaterThan(0)
      for (const a of courseAnims) {
        expect(a.duration, 'a running animation on /course/[code] has no duration').not.toBeNull()
        expect(a.duration!, 'a running animation on /course/[code] exceeds the 900ms ceiling').toBeLessThanOrEqual(900)
      }
    } finally {
      await deleteInvitedUser(service, u.userId, u.inviteCode)
    }
  })

  test('reduced motion, OS channel: zero running animations 50ms after a navigation, dashboard and exercise', async ({ browser }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)
    const seeded = await service.from('exercises').select('id').eq('clo_id', 'INFS2101-3').eq('title', 'Username check').single()
    if (seeded.error) throw new Error('Load the smoke seed before running motion.spec.ts.', { cause: seeded.error })
    const exerciseId: string = seeded.data.id
    const u = await mintMotionUser(service, 'osreduced', learnerState('INFS2101', [exerciseId]))
    const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      await mintSession(env as E2eEnv, context, base, u.link)
      await page.goto(`${base}/dashboard`)
      await page.waitForTimeout(50)
      expect(await runningAnimations(page), 'zero running animations 50ms after /dashboard under OS reduced motion').toHaveLength(0)

      await page.goto(`${base}/exercise/${exerciseId}`)
      await page.waitForTimeout(50)
      expect(await runningAnimations(page), 'zero running animations 50ms after /exercise/[id] under OS reduced motion').toHaveLength(0)
    } finally {
      await context.close()
      await deleteInvitedUser(service, u.userId, u.inviteCode)
    }
  })

  test('reduced motion, in-app channel: wellness.prefs.motion=reduced drives :root[data-motion=reduced], zero running animations', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)
    const seeded = await service.from('exercises').select('id').eq('clo_id', 'INFS2101-3').eq('title', 'Username check').single()
    if (seeded.error) throw new Error('Load the smoke seed before running motion.spec.ts.', { cause: seeded.error })
    const exerciseId: string = seeded.data.id
    const u = await mintMotionUser(service, 'appreduced', learnerState('INFS2101', [exerciseId]))
    try {
      const prefs = await service.from('wellness').upsert({ user_id: u.userId, prefs: { motion: 'reduced' } }, { onConflict: 'user_id' })
      if (prefs.error) throw prefs.error
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto('/dashboard')
      // `:root[data-motion]` is written from a query-dependent effect (`MotionAttribute.tsx`), not
      // synchronously at navigation -- wait for the resolved attribute, then measure the 50ms
      // window from there, matching what the attribute is actually for.
      await page.waitForFunction(() => document.documentElement.dataset.motion === 'reduced', undefined, { timeout: 10_000 })
      await page.waitForTimeout(50)
      expect(await runningAnimations(page), 'zero running animations 50ms after :root[data-motion="reduced"] resolves, /dashboard').toHaveLength(0)

      await page.goto(`/exercise/${exerciseId}`)
      await page.waitForFunction(() => document.documentElement.dataset.motion === 'reduced', undefined, { timeout: 10_000 })
      await page.waitForTimeout(50)
      expect(await runningAnimations(page), 'zero running animations 50ms after :root[data-motion="reduced"] resolves, /exercise/[id]').toHaveLength(0)
    } finally {
      await deleteInvitedUser(service, u.userId, u.inviteCode)
    }
  })

  test('exercise: zero animations during a navigation into the workspace, even with motion on', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)
    const seeded = await service.from('exercises').select('id').eq('clo_id', 'INFS2101-3').eq('title', 'Username check').single()
    if (seeded.error) throw new Error('Load the smoke seed before running motion.spec.ts.', { cause: seeded.error })
    const exerciseId: string = seeded.data.id
    const u = await mintMotionUser(service, 'entry', learnerState('INFS2101', [exerciseId]))
    try {
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto(`/exercise/${exerciseId}`)
      await expect(page.getByTestId('exercise-workspace')).toBeVisible()
      await page.waitForTimeout(100)
      expect(await runningAnimations(page), 'exercise composition must carry zero animations (standing constraint 8)').toHaveLength(0)
    } finally {
      await deleteInvitedUser(service, u.userId, u.inviteCode)
    }
  })

  test('lockdown overlay: zero animations in both motion modes', async ({ browser }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)
    const seeded = await service.from('exercises').select('id').eq('clo_id', 'INFS2101-3').eq('title', 'Username check').single()
    if (seeded.error) throw new Error('Load the smoke seed before running motion.spec.ts.', { cause: seeded.error })
    const exerciseId: string = seeded.data.id

    for (const reduced of [false, true] as const) {
      const u = await mintMotionUser(service, `lockdown-${reduced}`, learnerState('INFS2101', [exerciseId]))
      const context = await browser.newContext(reduced ? { reducedMotion: 'reduce' } : {})
      const page = await context.newPage()
      try {
        const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
        await mintSession(env as E2eEnv, context, base, u.link)
        await page.goto(`${base}/exercise/${exerciseId}`)
        await expect(page.getByTestId('exercise-workspace')).toBeVisible()
        // Fires `useLockdown`'s own blur listener directly (the same technique
        // `e2e/blur-overlay.spec.ts` uses), independent of the OS actually switching windows.
        await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        await expect(page.getByTestId('lockdown-overlay')).toBeVisible()
        await page.waitForTimeout(60)
        expect(await runningAnimations(page), `lockdown overlay must carry zero animations (reduced=${reduced})`).toHaveLength(0)
      } finally {
        await context.close()
        await deleteInvitedUser(service, u.userId, u.inviteCode)
      }
    }
  })

  test('account-status (restricted) banner: zero animations in both motion modes', async ({ browser }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)

    for (const reduced of [false, true] as const) {
      const u = await mintMotionUser(service, `restricted-${reduced}`, learnerState('INFS2101'))
      const restrict = await service.from('profiles').update({
        account_status: 'restricted',
        restricted_until: new Date(Date.now() + 3_600_000).toISOString(),
      }).eq('id', u.userId)
      if (restrict.error) throw restrict.error
      const context = await browser.newContext(reduced ? { reducedMotion: 'reduce' } : {})
      const page = await context.newPage()
      try {
        const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
        await mintSession(env as E2eEnv, context, base, u.link)
        await page.goto(`${base}/dashboard`)
        // `AccountNotice` renders a `role="status"` frame sentence for a warned/restricted account
        // (`src/components/shell/AccountNotice.tsx`) -- waiting on it also proves this test
        // exercised the real banner, not a page that quietly stayed in its normal state.
        await expect(page.getByRole('status').first()).toBeVisible()
        await page.waitForTimeout(60)
        expect(await runningAnimations(page), `account-status banner must carry zero animations (reduced=${reduced})`).toHaveLength(0)
      } finally {
        await context.close()
        await service.from('profiles').update({ account_status: 'active', restricted_until: null }).eq('id', u.userId)
        await deleteInvitedUser(service, u.userId, u.inviteCode)
      }
    }
  })
})
