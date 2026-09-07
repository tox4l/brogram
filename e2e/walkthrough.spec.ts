import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { compileLearnerState } from '../src/lib/learner/compile'
import { LINE_BANK } from '../src/lib/voice/lines'
import { readEnv, hasEnv, serviceClient, mintSession, deleteInvitedUser, type E2eEnv } from './support/session'

const env = readEnv()

/**
 * A whole walkthrough, end to end, against `INFS2101-3` ("Stop the submit, then check it") --
 * chosen because it is the one live-course lesson that carries both a runnable snippet and a
 * `choose` check with a known `correctIndex` (seed/lessons/by-clo/INFS2101-3.json), and its
 * language (`web`) needs no cold Pyodide/CheerpJ boot the way a Python or Java lesson would.
 *
 * `learner_state` is seeded with `currentCourse: 'INFS2101'` and `path: ['INFS2101-3']` so the
 * course home's Next-up stack is unambiguously built around the CLO this walkthrough teaches --
 * proving the specific claim ("finish a walkthrough, land on a rep for that same skill"), not
 * merely "some exercise loaded".
 */
test('open a walkthrough, run the snippet, miss a check then get it, finish, land on the rep', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const service = serviceClient(env as E2eEnv)
  const email = `brogram-walkthrough-${randomUUID()}@test.edu.qa`
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
    state.currentCourse = 'INFS2101'
    state.path = ['INFS2101-3']
    state.version = 0
    const initial = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
    if (initial.error) throw initial.error

    await mintSession(env as E2eEnv, context, baseURL!, link.data)

    // Lesson pages are addressable directly by CLO id (src/app/(app)/lesson/[cloId]/page.tsx) --
    // no need to first click through the course home to open one.
    await page.goto('/lesson/INFS2101-3')
    await expect(page.getByRole('heading', { name: 'Stop the submit, then check it' })).toBeVisible()

    // The runnable snippet: default form value already contains an "@", so running it unmodified
    // logs "sending" (the lesson's own `expectedStdout`) -- clicking Run is the whole interaction.
    const snippet = page.getByRole('region', { name: 'Code example' })
    await snippet.getByRole('button', { name: 'Run' }).click()
    await expect(snippet).toContainText('sending', { timeout: 20_000 })

    // Three "Check" regions render in document order (predict-output, choose, micro-code); the
    // `choose` one is the second. `correctIndex: 1` (seed/lessons/by-clo/INFS2101-3.json) --
    // option 0 is deliberately wrong first, unlimited attempts (CheckBlock only locks on a right
    // answer), then option 1 is right.
    const chooseCheck = page.getByRole('region', { name: 'Check' }).nth(1)
    await expect(chooseCheck).toBeVisible()
    const options = chooseCheck.getByRole('radio')
    await options.nth(0).click()
    await expect(chooseCheck).toContainText(LINE_BANK['lesson.verdict.notYet'].variants[0])
    await options.nth(1).click()
    await expect(chooseCheck).toContainText(LINE_BANK['lesson.verdict.right'].variants[0])

    // The bridge card: "Let's go" fires `complete()`, which writes `lesson_progress.status:
    // 'completed'` into the shared query cache (src/components/lesson/LessonView.tsx) and swaps
    // itself for "Back to your path" in the same commit.
    await page.getByRole('button', { name: "Let's go" }).click()
    const backToPath = page.getByRole('link', { name: 'Back to your path' })
    await expect(backToPath).toBeVisible()
    await backToPath.click()

    // On course home, `nextUp()` (src/lib/course/map.ts) only leads with the walkthrough card
    // while `!progress || progress.status === 'started'` -- now that this lesson reads
    // `'completed'` (read from the very same client-side query cache this SPA navigation never
    // dropped), the walkthrough is no longer due and card 0 is a real exercise for this CLO: the
    // rep the walkthrough was teaching towards.
    await page.waitForURL('**/course/INFS2101')
    const nextUpStack = page.getByRole('region', { name: 'Next up' })
    await expect(nextUpStack).toBeVisible()
    const firstCard = nextUpStack.getByRole('listitem').first()
    const firstCardLink = firstCard.getByRole('link')
    await expect(firstCardLink).toBeVisible()
    expect(await firstCardLink.textContent()).not.toContain('Walkthrough')
    const href = await firstCardLink.getAttribute('href')
    expect(href).toMatch(/^\/exercise\//)

    await firstCardLink.click()
    await page.waitForURL('**/exercise/**')
    await expect(page.getByTestId('exercise-workspace')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Work', exact: true }).getByRole('textbox').first()).toBeVisible()
  } finally {
    if (userId) await deleteInvitedUser(service, userId, inviteCode)
  }
})
