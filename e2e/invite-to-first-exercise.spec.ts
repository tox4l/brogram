import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import type { Exercise } from '../src/lib/contracts'
import { readEnv, hasEnv, serviceClient, createOrReuseInvitedUser, mintSession, resetLearnerData, type E2eEnv } from './support/session'

const env = readEnv()

test('invite → magic link → onboarding → first exercise', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const email = process.env.E2E_TEST_EMAIL
  test.skip(!email || !email.endsWith('.edu.qa'), 'Set E2E_TEST_EMAIL to a .edu.qa address before running this spec.')
  const service = serviceClient(env as E2eEnv)

  // A known smoke exercise to fall back on if the dashboard's own three-exercise bank is still empty
  // (see the note further down, at the point the fallback is actually used).
  const { exercises } = JSON.parse(await readFile(resolve('seed/exercises/smoke.json'), 'utf8')) as { exercises: Exercise[] }
  const fallbackSmoke = exercises.find((exercise) => exercise.language === 'python')!
  const fallbackSeeded = await service.from('exercises').select('id').eq('clo_id', fallbackSmoke.cloId).eq('title', fallbackSmoke.title).single()
  if (fallbackSeeded.error) throw new Error('Load the smoke seed before C5.', { cause: fallbackSeeded.error })
  const fallbackExerciseId: string = fallbackSeeded.data.id

  // createOrReuseInvitedUser both invites `email` (an invite row exists for it, per spec §15) and mints
  // its auth user. The real magic-link email delivery is a manual check under C6 — here the session is
  // minted directly from the token `generateLink` returns, the same way `fail-fix-pass` does.
  const { userId, link } = await createOrReuseInvitedUser(service, email!)
  await resetLearnerData(service, userId)

  try {
    await mintSession(env as E2eEnv, context, baseURL!, link)

    // No learner_state row exists for this account (just reset), so the app layout compiles a fresh
    // default state and this lands the student on /onboarding rather than /dashboard.
    await page.goto('/onboarding')

    // Phase 1 (learning style, 5 fixed fallback questions) then phase 2 (motivation, 6 fixed
    // questions) — 11 cards total in dry run. Answer the first option on each; the client itself caps
    // at 13 questions as a backstop, so assert that bound rather than an exact count.
    let cardCount = 0
    while (cardCount < 13) {
      const group = page.getByRole('group', { name: 'Choose one' })
      if (!(await group.isVisible().catch(() => false))) break
      await group.getByRole('button').first().click()
      cardCount += 1
      await expect(page.getByText('Finding your next question.')).toBeHidden()
    }
    expect(cardCount).toBeLessThanOrEqual(13)
    expect(cardCount).toBeGreaterThan(0)

    // Course selection: pick whichever live course sorts first.
    await expect(page.getByRole('heading', { name: 'Choose your course' })).toBeVisible()
    const courseGroup = page.getByRole('group', { name: 'Live courses' })
    await expect(courseGroup.getByRole('button').first()).toBeVisible()
    await courseGroup.getByRole('button').first().click()

    // Planning: the dry-run Planner fallback resolves fast, then the client routes to /dashboard.
    await expect(page.getByRole('heading', { name: 'Building your path' })).toBeVisible()
    await page.waitForURL('**/dashboard')

    const nextExercises = page.getByRole('region', { name: 'Next exercises' })
    await expect(nextExercises).toBeVisible()
    // The dashboard fetches course/exercise details client-side after mount (useCurriculum in
    // src/app/(app)/dashboard/page.tsx), so the link list is empty for a moment right after
    // navigation. Wait for that fetch to settle before deciding which branch below applies —
    // otherwise this races and can catch the loading placeholder instead of the real outcome.
    await expect(page.getByText('Loading your course and exercise details. Your saved progress is ready.')).toBeHidden()
    const firstExerciseLink = nextExercises.getByRole('link').first()
    if (await firstExerciseLink.count()) {
      // The chosen course had at least one candidate exercise per outcome; open the first one listed.
      await firstExerciseLink.click()
    } else {
      // With only the smoke fixtures loaded, the course's first learning outcome has no verified
      // exercise yet, so the Planner fallback returns an empty bank — this is exactly spec §15's
      // "still being prepared" branch. Confirm that copy, then open a known smoke exercise directly
      // since the dashboard has no link to click.
      await expect(nextExercises.getByText('Your next exercises start here.')).toBeVisible()
      await page.goto(`/exercise/${fallbackExerciseId}`)
    }

    await expect(page.getByTestId('exercise-workspace')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Exercise prompt' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Code editor' })).toBeVisible()
  } finally {
    await resetLearnerData(service, userId)
  }
})
