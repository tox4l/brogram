import { test, expect } from '@playwright/test'
import { QUESTIONS } from '../src/lib/onboarding/questions'
import { readEnv, hasEnv, serviceClient, createOrReuseInvitedUser, mintSession, resetLearnerData, type E2eEnv } from './support/session'

const env = readEnv()

test('invite → magic link → onboarding → first exercise', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const email = process.env.E2E_TEST_EMAIL
  test.skip(!email || !email.endsWith('.edu.qa'), 'Set E2E_TEST_EMAIL to a .edu.qa address before running this spec.')
  const service = serviceClient(env as E2eEnv)

  // createOrReuseInvitedUser both invites `email` (an invite row exists for it) and mints its auth
  // user. The real magic-link email delivery is a manual check under C6 — here the session is
  // minted directly from the token `generateLink` returns, the same way `fail-fix-pass` does.
  const { userId, link } = await createOrReuseInvitedUser(service, email!)
  await resetLearnerData(service, userId)

  try {
    await mintSession(env as E2eEnv, context, baseURL!, link)

    // No learner_state row exists for this account (just reset), so src/app/(app)/layout.tsx
    // compiles a fresh default profile (onboardingComplete: false) and the client lands on
    // /onboarding rather than /courses.
    await page.goto('/onboarding')

    // Wave 1's onboarding (src/app/(app)/onboarding/page.tsx, src/lib/onboarding/questions.ts):
    // exactly six local questions — four learning-style, two motivation — scored entirely
    // client-side. Each renders as a `radiogroup "Choose one"` of `radio` options; answering
    // advances synchronously with no fetch involved, so no busy state can ever appear between
    // cards (only the sixth answer, handled after the loop, fires a background agent call).
    expect(QUESTIONS).toHaveLength(6)
    for (let i = 0; i < QUESTIONS.length; i++) {
      const question = QUESTIONS[i]
      await expect(page.getByRole('heading', { name: question.text })).toBeVisible()
      await expect(page.getByText(`Question ${i + 1} of ${QUESTIONS.length}`)).toBeVisible()
      // Confirms there is genuinely no loading state to race — not merely that this assertion
      // wins a timing race with one.
      await expect(page.getByRole('status')).toHaveCount(0)
      await page.getByRole('radio', { name: question.options[0].label }).click()
    }

    // finishOnboarding (src/app/(app)/onboarding/page.tsx) marks the profile complete optimistically
    // and pushes to /courses immediately — before its background Profiler call or its learner_state
    // write have even started. This is where the code sends a learner once onboarding is done.
    await page.waitForURL('**/courses')

    // The completing write is fire-and-forget; wait for it to actually land (not a fixed sleep)
    // before proving the account is never re-asked below — otherwise a fresh /onboarding load could
    // race the write and still read an incomplete profile.
    await expect.poll(async () => {
      const row = await service.from('learner_state').select('state').eq('user_id', userId).maybeSingle()
      if (row.error) throw row.error
      return (row.data?.state as { profile?: { onboardingComplete?: boolean } } | undefined)?.profile?.onboardingComplete ?? false
    }, { timeout: 20_000, message: 'learner_state.profile.onboardingComplete never persisted' }).toBe(true)

    // A learner who already finished onboarding is never re-asked: Onboarding() redirects to
    // /courses as soon as it reads a completed profile (src/app/(app)/onboarding/page.tsx:
    // `if (session.learnerState?.profile.onboardingComplete) redirect('/courses')`).
    await page.goto('/onboarding')
    await page.waitForURL('**/courses')
    await expect(page.getByRole('heading', { name: QUESTIONS[0].text })).toHaveCount(0)

    // Course selection moved to /courses (src/app/(app)/courses/page.tsx): at least one live course
    // card renders inside the "Live courses" group; pick whichever sorts first. Live cards are real
    // `<Link>`s (src/components/course/CourseCard.tsx's `MotionLink = motion.create(Link)`) so the
    // route actually gets prefetched — not buttons with a `router.push` in their `onClick`.
    // The copy sweep (commit 7b7f99d) dropped every "Your" opener from headings this spec locates
    // by text — "Your courses" is now plain "Courses".
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
    const courseGroup = page.getByRole('group', { name: 'Live courses' })
    const firstCourseLink = courseGroup.getByRole('link').first()
    await expect(firstCourseLink).toBeVisible()
    await firstCourseLink.click()

    // selectCourse (src/app/(app)/courses/page.tsx) navigates optimistically to /course/{code} in
    // the same frame the tap happens in — there is no "Building your path" wait in v2.
    await page.waitForURL('**/course/**')
    // Copy sweep: the path-map section's heading is now "Path map", not "Your path"
    // (src/app/(app)/course/[code]/page.tsx: `<h2 id="path-heading">Path map</h2>`).
    const pathMap = page.getByRole('region', { name: 'Path map' })
    const nextUp = page.getByRole('region', { name: 'Next up' })
    await expect(pathMap).toBeVisible()
    await expect(nextUp).toBeVisible()

    // nextUp() (src/lib/course/map.ts) always returns three cards: a walkthrough leads only when a
    // lesson exists for the learner's current skill, otherwise every card is already an exercise.
    const firstCard = nextUp.getByRole('listitem').first()
    await expect(firstCard).toBeVisible()
    const firstCardLink = firstCard.getByRole('link')
    const firstCardIsWalkthrough = ((await firstCardLink.textContent()) ?? '').includes('Walkthrough')

    if (firstCardIsWalkthrough) {
      await firstCardLink.click()
      await page.waitForURL('**/lesson/**')
      // Every lesson block renders inside its own labelled section (ConceptBlock, SnippetBlock,
      // WorkedBlock, CheckBlock, RecapBlock or BridgeBlock — src/components/lesson/**); whichever
      // paints first is this lesson's first block. ProgressRail is the "nav Lesson progress" rail.
      await expect(page.getByRole('region', { name: /Concept|Code example|Worked example|Check|Recap|Next/ }).first()).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Lesson progress' })).toBeVisible()

      // Back to the course home, then open the first actual exercise card. nextUp() always puts the
      // walkthrough at index 0 and appends exercises after it (src/lib/course/map.ts: "for (const id
      // of nextExerciseIds) { ...; addExerciseById(id, { caption: 'After the walkthrough, or skip
      // it.' }) }"), so card index 1 is the first exercise — a text filter is not reliable here since
      // that very caption itself contains the word "walkthrough".
      // Copy sweep: LessonView's back link reads "Path map" now too
      // (src/components/lesson/LessonView.tsx: `<ArrowLeft/>Path map`).
      await page.getByRole('link', { name: 'Path map' }).click()
      await page.waitForURL('**/course/**')
      await expect(nextUp).toBeVisible()
      const exerciseCard = nextUp.getByRole('listitem').nth(1)
      await expect(exerciseCard).toBeVisible()
      await exerciseCard.getByRole('link').click()
    } else {
      // No lesson exists yet for the current skill — the first card is already an exercise.
      await firstCardLink.click()
    }

    // useLockdown's 15s idle guard (src/hooks/useLockdown.ts, LOCKDOWN.idleBlurAfterS) marks the
    // workspace's two inner panels `inert` the moment nothing has moved the mouse or pressed a key
    // for that long (src/app/(app)/exercise/[id]/page.tsx: `inert={Boolean(lockdown.overlay)}`) —
    // `inert` drops both "Exercise prompt" and the editor out of the accessibility tree entirely,
    // not just visually. This flow's own waits have nothing for a real learner's mouse to do in
    // between and can outlast 15s, and a single nudge only buys 15 more seconds, which a slow retry
    // window can still exceed — so nudge the mouse on every retry instead, the way a present learner
    // naturally would. This is not part of the contract being asserted below, only keeping an
    // unrelated anti-cheat guard (its own dedicated coverage is blur-overlay.spec.ts) from firing
    // while Playwright itself sits idle between checks.
    //
    // The exercise nextUp()/pickFromBank chose may be any textbox-based kind — code and schema
    // (src/components/exercise/Editor.tsx: `aria-label` "Code editor" or "Schema editor"),
    // predict-output (src/components/exercise/PredictOutput.tsx: one `<textarea>` labelled
    // "Predicted output" by its wrapping `<label>`), or trace (src/components/exercise/Trace.tsx: one
    // `<Input aria-label={variable}>` per traced variable, so no single fixed name covers it). All
    // four open a workspace that accepts the learner's work inside the "Work" region (copy sweep:
    // `<section aria-label="Work">` in src/app/(app)/exercise/[id]/page.tsx, was "Your work") — the
    // contract this flow guards — so check for any textbox there rather than one fixed accessible
    // name. `exact: true` because Playwright's default name match is substring/case-insensitive and
    // this single common word would otherwise also match a "Worked example" lesson block if one were
    // ever mounted alongside it.
    const workRegion = page.getByRole('region', { name: 'Work', exact: true })
    await expect(async () => {
      await page.mouse.move(200 + Math.random() * 20, 200 + Math.random() * 20)
      await expect(page.getByTestId('exercise-workspace')).toBeVisible({ timeout: 2_000 })
      await expect(page.getByRole('region', { name: 'Exercise prompt' })).toBeVisible({ timeout: 2_000 })
      await expect(workRegion.getByRole('textbox').first()).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
  } finally {
    await resetLearnerData(service, userId)
  }
})
