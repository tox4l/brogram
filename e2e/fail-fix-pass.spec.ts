import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { compileLearnerState } from '../src/lib/learner/compile'
import type { Exercise } from '../src/lib/contracts'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

test('failed submit → fix plan → hint → pass → a different pattern', async ({ page, context, baseURL }) => {
  test.skip(!url || !anonKey || !serviceKey, 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  const service = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
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

    const cookies = new Map<string, { name: string; value: string; options: CookieOptions }>()
    const auth = createServerClient(url!, anonKey!, { cookies: {
      getAll: () => [...cookies.values()].map(({ name, value }) => ({ name, value })),
      setAll: (values) => { for (const cookie of values) cookies.set(cookie.name, cookie) },
    } })
    const verified = await auth.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'email' })
    if (verified.error) throw verified.error
    const origin = new URL(baseURL!)
    await context.addCookies([...cookies.values()].map(({ name, value, options }) => ({
      name, value, domain: origin.hostname, path: options.path ?? '/',
      httpOnly: Boolean(options.httpOnly), secure: origin.protocol === 'https:',
      sameSite: options.sameSite === 'none' ? 'None' as const : options.sameSite === 'strict' ? 'Strict' as const : 'Lax' as const,
    })))

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
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Fix plan' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled()
    expect(agents.filter((agent) => agent === 'diagnoser')).toHaveLength(1)
    await typeCode('export function validateUsername(name) { return true }')
    await page.getByRole('button', { name: 'Ask for a hint', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Fix plan' })).toContainText('Hint 1')
    expect(agents.filter((agent) => agent === 'coach')).toHaveLength(1)
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled()
    await typeCode(smoke.referenceSolution)
    await page.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Results' })).toContainText('6 / 6 passed')
    await expect(page.getByRole('button', { name: 'Next exercise', exact: true })).toBeEnabled()
    expect(agents.filter((agent) => agent === 'reviewer')).toHaveLength(1)
    await page.getByRole('button', { name: 'Next exercise', exact: true }).click()
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
