import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { compileLearnerState } from '../src/lib/learner/compile'
import type { Exercise } from '../src/lib/contracts'
import { readEnv, hasEnv, serviceClient, mintSession, type E2eEnv } from './support/session'

const env = readEnv()

test('failed submit → fix plan → hint → pass → a different pattern', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const service = serviceClient(env as E2eEnv)
  const email = `brogram-smoke-${randomUUID()}@test.edu.qa`
  const inviteCode = randomUUID()
  let userId: string | undefined
  const { exercises } = JSON.parse(await readFile(resolve('seed/exercises/smoke.json'), 'utf8')) as { exercises: Exercise[] }
  const smoke = exercises.find((exercise) => exercise.language === 'javascript')!
  // Node test setup uses service credentials; the browser reads exercises_public only.
  const seeded = await service.from('exercises').select('id').eq('clo_id', smoke.cloId).eq('title', smoke.title).single()
  if (seeded.error) throw new Error('Load the smoke seed before C5.', { cause: seeded.error })
  const exerciseId: string = seeded.data.id

  try {
    const invite = await service.from('invites').insert({ code: inviteCode, email })
    if (invite.error) throw invite.error
    // generateLink mints a token without sending email; the real email flow belongs to C6.
    const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    userId = link.data.user.id
    const state = compileLearnerState({ id: userId }, [], [], [], null)
    state.profile.onboardingComplete = true
    state.currentCourse = 'INFS2101'
    state.nextExerciseIds = [exerciseId]
    state.version = 0
    const initial = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
    if (initial.error) throw initial.error

    await mintSession(env as E2eEnv, context, baseURL!, link.data)

    const agents: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/agent' && request.method() === 'POST') agents.push(request.postDataJSON().agent)
    })
    await page.goto(`/exercise/${exerciseId}`)
    await expect(page.getByRole('heading', { name: smoke.title })).toBeVisible()
    const workspace = page.getByTestId('exercise-workspace')
    await expect(workspace).toHaveAttribute('data-pattern', 'guard')
    const editor = page.getByRole('textbox', { name: 'Code editor' })
    const typeCode = async (code: string) => {
      await editor.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText(code)
    }
    await typeCode('export function validateUsername(name) { return false }')
    expect(agents).toEqual([])

    // T2.2's submit() sets `status: 'graded'` (and the verdict) synchronously off the local
    // grading result, before `finishSubmission`'s network round trip to `attempts` even starts
    // (src/hooks/useExerciseLoop.ts:597-652 -- "the browser knows pass or fail the instant
    // grading resolves, before any network call"; the same ordering `useExerciseLoop.test.tsx`
    // proves at the unit level: "reaches the graded verdict before the attempts insert ever
    // resolves"). The verdict banner is the real, user-visible proof of that ordering. Race the
    // actual network response for the attempts save against the verdict actually painting: the
    // banner must already be up and reading the right thing while that request is still open.
    const verdict = page.getByTestId('verdict-banner')
    // Stall the attempts save deliberately rather than racing its natural network latency: a
    // local Supabase, a warm pool, or an in-process CI database could otherwise let the save
    // land inside the two `expect.poll`-style checks below and fail a spec that has not
    // regressed, or let a slow `finishSubmission` fake the ordering without proving anything.
    // Holding the request open for 3s forces the banner to paint while the save is demonstrably
    // still in flight, with margin to spare.
    await page.route('**/rest/v1/attempts', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      await route.continue()
    })
    let firstAttemptSaved = false
    const firstAttemptSave = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/rest/v1/attempts') && response.request().method() === 'POST')
    void firstAttemptSave.then(() => { firstAttemptSaved = true })

    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(verdict).toBeVisible()
    await expect(verdict).toContainText('Needs work')
    expect(firstAttemptSaved, 'the graded verdict must paint before the attempts save lands, not after').toBe(false)
    await firstAttemptSave

    await expect(page.getByRole('region', { name: 'Fix plan' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled()
    expect(agents.filter((agent) => agent === 'diagnoser')).toHaveLength(1)
    await typeCode('export function validateUsername(name) { return true }')
    await page.getByRole('button', { name: 'Ask for a hint', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Fix plan' })).toContainText('Hint 1')
    expect(agents.filter((agent) => agent === 'coach')).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled()
    await typeCode(smoke.referenceSolution)

    // Same race, on the pass: the banner reads "Passed" while the second attempts upsert is
    // still in flight, not after.
    let secondAttemptSaved = false
    const secondAttemptSave = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/rest/v1/attempts') && response.request().method() === 'POST')
    void secondAttemptSave.then(() => { secondAttemptSaved = true })

    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(verdict).toContainText('Passed')
    expect(secondAttemptSaved, 'the graded verdict must paint before the second attempts save lands, not after').toBe(false)
    await secondAttemptSave
    await page.unroute('**/rest/v1/attempts')

    await expect(page.getByRole('region', { name: 'Results' })).toContainText('6 / 6 passed')
    // T2.2 round 3 (f703e81): the advance button now reads with the bank's rep wording
    // (src/lib/voice/glossary.ts's `repWord()` -> 'rep'; src/app/(app)/exercise/[id]/page.tsx:
    // `Next ${repWord()}`) whenever the CLO is still open, which it is here after one pass.
    await expect(page.getByRole('button', { name: 'Next rep', exact: true })).toBeEnabled()
    expect(agents.filter((agent) => agent === 'reviewer')).toHaveLength(1)
    await page.getByRole('button', { name: 'Next rep', exact: true }).click()
    await expect(workspace).not.toHaveAttribute('data-exercise-id', exerciseId)
    await expect(workspace).not.toHaveAttribute('data-pattern', 'guard')
    const attempts = await service.from('attempts').select('passed,hint_count').eq('user_id', userId).order('created_at')
    if (attempts.error) throw attempts.error
    expect(attempts.data.map((attempt) => attempt.passed)).toEqual([false, true])
    expect(attempts.data[1].hint_count).toBe(1)
  } finally {
    const deletedInvite = await service.from('invites').delete().eq('code', inviteCode)
    if (deletedInvite.error) throw deletedInvite.error
    if (userId) {
      const deleted = await service.auth.admin.deleteUser(userId)
      if (deleted.error) throw deleted.error
    }
  }
})
