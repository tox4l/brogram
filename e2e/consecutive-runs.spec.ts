import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { compileLearnerState } from '../src/lib/learner/compile'
import { readEnv, hasEnv, serviceClient, mintSession, type E2eEnv } from './support/session'

const env = readEnv()

/**
 * Regression for the web-runtime nondeterminism report: the exact same
 * reference-quality solution against the exact same fixture returned
 * "Passed", then "Needs work", then a full 20s hang across three consecutive
 * runs, with no code change in between. Root cause: `WebAdapter.createFrame()`
 * (src/lib/runtimes/web.ts) marked every grading sandbox `hidden` (display:
 * none), which gives an iframe no real layout box - Chromium collapses a
 * display:none iframe's own content viewport, so `@media (max-width: ...)`
 * evaluated against that collapsed size instead of a normal screen. A
 * correct `@media (max-width: 600px)` solution read back `flexDirection:
 * 'column'` even at a wide layout, purely because the grading sandbox itself
 * had no stable viewport - not because of anything the student wrote. The
 * fix keeps the sandbox invisible via off-screen fixed positioning (real
 * layout, real viewport) instead of display:none.
 *
 * This walks the exact CLO bank (INFS2101-2, three exercises, three distinct
 * patterns) that surfaced the bug end to end, in place (next() between
 * exercises, no reload): a plain flex layout with no media query, a
 * max-width media query (the exact failure shape), and a spot-the-bug answer
 * form (grading bypasses the runtime entirely, proving the chain itself is
 * unaffected). `queueNext` picks among all three from the first pass (three
 * distinct patterns, chain closes at three - src/lib/learner/score.ts), so
 * the order it presents them in is not guaranteed; solutions are looked up
 * by title so the assertions hold regardless of order. Every solution is
 * hand-written from that exercise's own prompt and visible tests only, never
 * the seed bank's referenceSolution.
 */
const SOLUTIONS: Record<string, (page: Page) => Promise<void>> = {
  'Chat contact row': async (page) => typeCode(page, '<style>\n  .contact {\n    display: flex;\n    align-items: center;\n    column-gap: 10px;\n  }\n</style>\n'),
  'Market stall layout': async (page) => typeCode(page, '<style>\n  .stalls {\n    display: flex;\n    flex-direction: row;\n  }\n\n  @media (max-width: 600px) {\n    .stalls {\n      flex-direction: column;\n    }\n  }\n</style>\n'),
  // Answer form (spot-the-bug): grading never touches the runtime adapter at
  // all here, proving the in-place chain itself settles cleanly even when a
  // step isn't runtime-graded. The visible test names the broken line
  // directly: `grid-template-column` (missing its trailing `s`) on line 13.
  'Conference schedule grid': async (page) => { await page.getByRole('button', { name: 'Line 13' }).click() },
}

async function typeCode(page: Page, code: string) {
  const editor = page.getByRole('textbox', { name: 'Code editor' })
  // T2.2's in-place next() keeps the same mounted Editor/EditorView across
  // exercises (fix round C1) and swaps its content externally the instant the
  // new exercise's starter code lands. Typing immediately after next()'s own
  // click can race that external swap - this editor is still catching up on
  // the previous transition's own value, and keystrokes typed into the old
  // instance right on the boundary can be lost to it. Wait for the editor's
  // content to stop changing (it just got here) before driving it as a user
  // naturally would, rather than assuming the swap already landed.
  let previous: string | null = null
  for (let i = 0; i < 20; i++) {
    const current = await editor.textContent()
    if (current !== null && current === previous) break
    previous = current
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(code)
  // Confirm the keystrokes actually landed and stuck, rather than trusting a
  // synchronous API that only proves the events were dispatched.
  await expect(editor).toContainText(code.trim().split('\n')[0].trim(), { timeout: 5_000 })
}

test('three consecutive web submissions, in place, all pass with no run over budget', async ({ page, context, baseURL }) => {
  test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
  // Three rounds, each tolerating a real (non-dry-run) agent round trip before
  // canAdvance -- well above playwright.config.ts's default 120s.
  test.setTimeout(300_000)
  const service = serviceClient(env as E2eEnv)

  const contactRow = await service.from('exercises').select('id,title').eq('clo_id', 'INFS2101-2').eq('title', 'Chat contact row').single()
  if (contactRow.error) throw new Error('Load the INFS2101 seed before running this spec.', { cause: contactRow.error })
  const exerciseId: string = contactRow.data.id

  const email = `brogram-consecutive-runs-${randomUUID()}@test.edu.qa`
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
    state.nextExerciseIds = [exerciseId]
    state.version = 0
    const initial = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
    if (initial.error) throw initial.error

    await mintSession(env as E2eEnv, context, baseURL!, link.data)

    // useLockdown's 15s idle guard would otherwise cover the workspace mid-wait
    // (the same reason python-run.spec.ts nudges the mouse during Pyodide's
    // cold boot); queueNext's own bank fetch/Planner call runs against the
    // real agent API here (this suite runs against the already-running dev
    // server, not a fresh AGENT_DRY_RUN=true spawn), so canAdvance can take
    // longer than that threshold - nudge on a tight interval, independent of
    // any single assertion's own retry cadence, for every wait in this spec.
    const nudge = () => page.mouse.move(200 + Math.random() * 20, 200 + Math.random() * 20)
    async function whileNudging<T>(fn: () => Promise<T>): Promise<T> {
      const timer = setInterval(() => { void nudge() }, 2_000)
      try { return await fn() } finally { clearInterval(timer) }
    }

    const submitAndAssertPassed = async (label: string) => {
      const start = Date.now()
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await whileNudging(() => expect(page.locator('[data-testid="verdict-banner"]')).toContainText('Passed', { timeout: 25_000 }))
      const elapsedMs = Date.now() - start
      // Three consecutive runs must never degrade into the reported ~20s
      // hang: a passing web submission settles quickly, well inside the
      // per-test 5s budget even accounting for several graded tests plus
      // the reviewer/mastery background chain this hook kicks off.
      expect(elapsedMs, `${label} took ${elapsedMs}ms`).toBeLessThan(10_000)
    }
    const advance = async (isLast: boolean) => {
      // T2.2 round 3 (f703e81): the open-CLO label reads with the bank's rep wording now
      // (src/lib/voice/glossary.ts's `repWord()` -> 'rep'), so "Next exercise" is stale here.
      // The closed-CLO label is unchanged -- src/app/(app)/exercise/[id]/page.tsx still reads
      // literally `loop.closed ? 'Back to your path' : \`Next ${repWord()}\`` -- so that
      // alternative stays as-is; line 136 below already asserts it verbatim.
      const button: Locator = page.getByRole('button', { name: /Next rep|Back to your path/, exact: false })
      // queueNext's own bank fetch, and the Reviewer call that always precedes
      // it, are real (non-dry-run) agent round trips against this suite's
      // already-running dev server - generous, matching python-run.spec.ts's
      // own tolerance for a real cold external dependency.
      await whileNudging(() => expect(button).toBeEnabled({ timeout: 45_000 }))
      const label = await button.textContent()
      // The CLO closes at exactly three (src/lib/learner/score.ts) since all
      // three of this CLO's exercises carry distinct patterns - it must close
      // on the third pass, never earlier, and never still be open after it.
      expect(label?.includes('Back to your path'), `advance() after run ${isLast ? 3 : '<3'}: button read "${label}"`).toBe(isLast)
      await button.click()
    }

    await page.goto(`/exercise/${exerciseId}`)
    // useExerciseLoop's own transition (mount or next()) is not guaranteed to
    // preserve this component's identity in practice - the Submit button only
    // renders once loop.exercise is genuinely populated, so wait for it
    // instead of assuming a specific heading text is already live.
    await page.getByRole('button', { name: 'Submit', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })

    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const title = (await page.locator('h1').first().textContent())?.trim() ?? ''
      seen.push(title)
      const solve = SOLUTIONS[title]
      expect(solve, `no hand-written solution for "${title}" (run ${i + 1}); expected one of ${Object.keys(SOLUTIONS).join(', ')}`).toBeDefined()
      await solve(page)
      await submitAndAssertPassed(`run ${i + 1} (${title})`)
      await advance(i === 2)
      if (i < 2) await page.getByRole('button', { name: 'Submit', exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
    }
    expect(new Set(seen).size, `expected three distinct exercises, saw ${JSON.stringify(seen)}`).toBe(3)

    const attempts = await service.from('attempts').select('passed,results').eq('user_id', userId).order('created_at')
    if (attempts.error) throw attempts.error
    expect(attempts.data).toHaveLength(3)
    expect(attempts.data.every((row) => row.passed)).toBe(true)
    for (const row of attempts.data) {
      const results = (row.results ?? []) as { durationMs?: number }[]
      for (const result of results) if (typeof result.durationMs === 'number') expect(result.durationMs).toBeLessThan(5_000)
    }
  } finally {
    const deletedInvite = await service.from('invites').delete().eq('code', inviteCode)
    if (deletedInvite.error) throw deletedInvite.error
    if (userId) {
      const deleted = await service.auth.admin.deleteUser(userId)
      if (deleted.error) throw deleted.error
    }
  }
})
