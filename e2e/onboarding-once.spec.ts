import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { QUESTIONS } from '../src/lib/onboarding/questions'
import { liveCourses } from '../src/lib/curriculum'
import { readEnv, hasEnv, serviceClient, mintSession, deleteInvitedUser, type E2eEnv } from './support/session'

const env = readEnv()

/**
 * R4.4's named Playwright assertion. Two guarantees, end to end:
 *  1. Onboarding is six questions, once, with no busy state anywhere between cards
 *     (`invite-to-first-exercise.spec.ts` proves this on its own path through the same screen;
 *     this spec's own six-question loop below is the same check, kept local rather than shared
 *     so this spec stands on its own).
 *  2. Switching courses -- twice, here -- never reaches the Profiler again. `switchCourse()`
 *     (src/app/(app)/courses/lib.ts) calls the Planner in the background on every switch
 *     (`trigger: 'plan-refresh'`) and never the Profiler; onboarding's own finish is the only
 *     place `trigger: 'onboarding-answer'` is ever sent (src/app/(app)/onboarding/page.tsx).
 *     `callAgent`/`streamAgent` (src/lib/agents/client.ts) are the single choke point every
 *     agent call goes through, so spying on the network request they produce (`POST /api/agent`)
 *     is spying on the choke point itself, not a proxy for it.
 */
test('six questions once, no loading state, then two course switches never reach the Profiler', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const service = serviceClient(env as E2eEnv)
  const email = `brogram-onboarding-once-${randomUUID()}@test.edu.qa`
  const inviteCode = randomUUID()
  let userId: string | undefined

  try {
    const invite = await service.from('invites').insert({ code: inviteCode, email })
    if (invite.error) throw invite.error
    // generateLink mints a token without sending email; the real email flow belongs to C6
    // (same technique every other spec in this suite uses).
    const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    userId = link.data.user.id

    const agentCalls: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/agent' && request.method() === 'POST') {
        agentCalls.push(request.postDataJSON().agent)
      }
    })

    await mintSession(env as E2eEnv, context, baseURL!, link.data)

    // No learner_state row exists for this brand-new account, so src/app/(app)/layout.tsx
    // compiles a fresh default profile (onboardingComplete: false) and the client lands on
    // /onboarding rather than /courses.
    await page.goto('/onboarding')

    expect(QUESTIONS).toHaveLength(6)
    for (let i = 0; i < QUESTIONS.length; i++) {
      const question = QUESTIONS[i]
      await expect(page.getByRole('heading', { name: question.text })).toBeVisible()
      await expect(page.getByText(`Question ${i + 1} of ${QUESTIONS.length}`)).toBeVisible()
      // Confirms there is genuinely no loading state to race between cards (R4.2) -- not merely
      // that this assertion wins a timing race with one.
      await expect(page.getByRole('status')).toHaveCount(0)
      await page.getByRole('radio', { name: question.options[0].label }).click()
    }

    // finishOnboarding marks the profile complete optimistically and pushes to /courses
    // immediately -- before its background Profiler call or its learner_state write have even
    // started (src/app/(app)/onboarding/page.tsx).
    await page.waitForURL('**/courses')
    await expect.poll(async () => {
      const row = await service.from('learner_state').select('state').eq('user_id', userId).maybeSingle()
      if (row.error) throw row.error
      return (row.data?.state as { profile?: { onboardingComplete?: boolean } } | undefined)?.profile?.onboardingComplete ?? false
    }, { timeout: 20_000, message: 'learner_state.profile.onboardingComplete never persisted' }).toBe(true)

    // Exactly one Profiler call so far: the one onboarding's own finish fires
    // (`trigger: 'onboarding-answer'`). Everything below proves it never happens a second time.
    await expect.poll(() => agentCalls.filter((agent) => agent === 'profiler').length, {
      timeout: 20_000, message: 'onboarding finished without ever reaching the Profiler',
    }).toBe(1)

    // Two course switches. Any two distinct live courses will do -- the seed ships six.
    const courses = liveCourses()
    expect(courses.length, 'this spec needs at least two live courses to switch between').toBeGreaterThanOrEqual(2)
    const courseGroup = page.getByRole('group', { name: 'Live courses' })
    await expect(courseGroup).toBeVisible()

    for (const course of [courses[0], courses[1]]) {
      // A text filter, not an accessible-name match: `CourseCard`'s `<Link>` accessible name also
      // folds in its nested progress ring's own `aria-label` ("<title> progress"), so a filter on
      // the title substring is the robust match, the same choice this suite makes elsewhere for
      // similarly composite links.
      const card = courseGroup.getByRole('link').filter({ hasText: course.title })
      await expect(card).toBeVisible()
      await card.click()
      await page.waitForURL('**/course/**')
      await expect(page.getByRole('region', { name: 'Path map' })).toBeVisible()
      // Scoped to `#main-content`: the persistent header nav has its own "Courses" link too
      // (src/components/shell/AppShell.tsx), and both read the same accessible name.
      await page.locator('#main-content').getByRole('link', { name: 'Courses' }).click()
      await page.waitForURL('**/courses')
      await expect(courseGroup).toBeVisible()
    }

    // The named assertion: still exactly one Profiler call, total, after two full switches.
    expect(agentCalls.filter((agent) => agent === 'profiler'), 'the Profiler must never be reached again after onboarding finishes').toHaveLength(1)
    // And the switches themselves genuinely ran the Planner in the background -- this is not
    // passing by having done nothing.
    expect(agentCalls.filter((agent) => agent === 'planner').length).toBeGreaterThanOrEqual(2)

    // A learner who already finished onboarding is never re-asked, ever: Onboarding() redirects
    // to /courses as soon as it reads a completed profile (src/app/(app)/onboarding/page.tsx:
    // `if (session.learnerState?.profile.onboardingComplete) redirect('/courses')`). This spec
    // is the one the brief names as R4.4's assertion, so it has to prove the never-re-ask
    // guarantee itself, not merely rely on it holding elsewhere: revisit /onboarding directly and
    // confirm both that the redirect fires and that doing so still does not touch the Profiler.
    await page.goto('/onboarding')
    await page.waitForURL('**/courses')
    await expect(page.getByRole('heading', { name: QUESTIONS[0].text })).toHaveCount(0)
    expect(agentCalls.filter((agent) => agent === 'profiler')).toHaveLength(1)
  } finally {
    if (userId) await deleteInvitedUser(service, userId, inviteCode)
  }
})
