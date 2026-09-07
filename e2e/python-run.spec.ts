import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import type { Exercise } from '../src/lib/contracts'
import { readEnv, hasEnv, serviceClient, mintSession, type E2eEnv } from './support/session'

const env = readEnv()

/**
 * Proves Python actually executes in the browser: a real Pyodide Worker,
 * loaded from the jsdelivr CDN, running real user code and grading it
 * against the server's hidden tests. This is the regression test for the
 * Pyodide bootstrap fix in src/lib/runtimes/pyodide.worker.ts - Pyodide 314's
 * own runtime-environment probe refuses to boot in any worker where
 * `importScripts` still works, which this worker's compiled bundle always
 * has by the time its own code runs; the fix shadows `importScripts` before
 * dynamically importing the ESM build.
 *
 * The client must never see reference solutions, so the passing program
 * below is hand-written for this one exercise, not lifted from the seed
 * bank's own `referenceSolution` field, and the stdout assertion uses only
 * the visible test's own expected output (also public).
 */
test('runs a Python exercise in a real browser worker: stdout from Run, then a full pass on Submit', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const service = serviceClient(env as E2eEnv)

  const { exercises } = JSON.parse(await readFile(resolve('seed/exercises/smoke.json'), 'utf8')) as { exercises: Exercise[] }
  const smoke = exercises.find((exercise) => exercise.language === 'python')!
  const seeded = await service.from('exercises').select('id').eq('clo_id', smoke.cloId).eq('title', smoke.title).single()
  if (seeded.error) throw new Error('Load the smoke seed before C5.', { cause: seeded.error })
  const exerciseId: string = seeded.data.id

  const email = `brogram-python-e2e-${randomUUID()}@test.edu.qa`
  const inviteCode = randomUUID()
  let userId: string | undefined

  try {
    const invite = await service.from('invites').insert({ code: inviteCode, email })
    if (invite.error) throw invite.error
    const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    userId = link.data.user.id

    const state = {
      version: 0,
      profile: { onboardingComplete: true, learningStyle: {}, motivation: {} },
      currentCourse: smoke.cloId.split('-')[0],
      nextExerciseIds: [exerciseId],
      xp: 0,
      streak: { current: 0, longest: 0, lastActiveDate: null },
      completedExerciseIds: [],
      completedCloIds: [],
      skillLevels: {},
      achievements: [],
    }
    const initial = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
    if (initial.error) throw initial.error

    await mintSession(env as E2eEnv, context, baseURL!, link.data)

    await page.goto(`/exercise/${exerciseId}`)
    await expect(page.getByRole('heading', { name: smoke.title })).toBeVisible()
    const editor = page.getByRole('textbox', { name: 'Code editor' })
    const typeCode = async (code: string) => {
      await editor.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText(code)
    }

    // Hand-written, independent of the seed bank's own referenceSolution -
    // a functional-style pass over `smoke`'s example test rather than the
    // loop-based one the seed carries. `smoke`'s first visible test is
    // `first_late([3, 5, 9], 6)` -> `9` (seed/exercises/smoke.json).
    const passingSolution = 'def first_late(times, limit):\n    return next((t for t in times if t > limit), -1)\n\nprint("first_late output:", first_late([3, 5, 9], 6))\n'
    await typeCode(passingSolution)

    const results = page.getByRole('region', { name: 'Results' })
    // useLockdown's 15s idle guard would otherwise make the workspace inert
    // partway through Pyodide's cold CDN boot (up to PYODIDE_PREPARE_BUDGET_MS,
    // 90s) - nudge the mouse on every poll so this flow's own waits never
    // read as learner inactivity, the same way invite-to-first-exercise does.
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(async () => {
      await page.mouse.move(200 + Math.random() * 20, 200 + Math.random() * 20)
      await expect(results).toContainText('first_late output: 9', { timeout: 5_000 })
    }).toPass({ timeout: 100_000 })

    // Submit the same hand-written solution; it should pass every test,
    // including the hidden ones the client never saw.
    await page.mouse.move(220, 220)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(async () => {
      await page.mouse.move(230 + Math.random() * 20, 230 + Math.random() * 20)
      await expect(results).toContainText(`${smoke.tests.length} / ${smoke.tests.length} passed`, { timeout: 5_000 })
    }).toPass({ timeout: 100_000 })
    for (const t of smoke.tests) if (!t.hidden) await expect(results).toContainText(t.name!)
    await expect(page.getByRole('button', { name: 'Next exercise', exact: true })).toBeEnabled()

    const attempts = await service.from('attempts').select('passed').eq('user_id', userId).eq('exercise_id', exerciseId)
    if (attempts.error) throw attempts.error
    expect(attempts.data.map((a) => a.passed)).toEqual([true])
  } finally {
    const deletedInvite = await service.from('invites').delete().eq('code', inviteCode)
    if (deletedInvite.error) throw deletedInvite.error
    if (userId) {
      const deleted = await service.auth.admin.deleteUser(userId)
      if (deleted.error) throw deleted.error
    }
  }
})
