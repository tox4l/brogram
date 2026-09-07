import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'
import { readEnv, hasEnv, serviceClient, mintSession, deleteInvitedUser, type E2eEnv } from './support/session'

/**
 * Wave 4 spec §10 family F (plan T4.10 step 4). `[data-shader-surface]` must never appear on
 * `/dashboard`, `/lesson/*`, `/exercise/*` or a lockdown surface; a live field's `requestAnimationFrame`
 * count must go flat after the settle-and-freeze at `SETTLE_MS` (4500ms, `ShaderField.tsx`);
 * `gl.isContextLost()` must be true once frozen, with the surface still visibly non-uniform; under
 * reduced motion, no canvas and no shader chunk ever reaches the network.
 *
 * `/login` (public, no session needed) is this file's one live-shader surface: it renders
 * `<ShaderSurface motionPref="system" .../>` unconditionally (`src/app/(auth)/login/page.tsx`), so
 * `motionPref` resolves purely from the OS `prefers-reduced-motion` signal Playwright's own
 * `contextOptions.reducedMotion`/`page.emulateMedia` control -- no learner account, no wellness row,
 * no mint required to exercise either channel.
 *
 * Two techniques below were validated live against this tree (2026-09-08) because the obvious ones
 * do not work on this component, on purpose:
 *
 * 1. Reading the frozen canvas's own pixels via `canvas.getContext('2d')` returns `null` -- a
 *    `<canvas>` element is locked to whichever context type it first returned (WebGL2 here) for its
 *    whole life; the frozen 2D repaint happens through the *component's own* ref callback, which
 *    holds that context, never through a second, later `getContext('2d')` call this test could make.
 *    A real screenshot (`page.screenshot`, decoded back through an `<img>` + a fresh, untouched
 *    canvas, entirely inside the page) sidesteps the lock by reading what the compositor actually
 *    painted, exactly the "visibly non-uniform" the spec asks for.
 * 2. `gl.isContextLost()` cannot be read off the DOM once frozen either -- the live WebGL canvas is
 *    gone from the tree by then. `HTMLCanvasElement.prototype.getContext` is patched (an
 *    `addInitScript`, before any app code runs) to keep the one `webgl2` context object this page
 *    ever creates, so `isContextLost()` stays callable long after its canvas has been swapped out.
 *
 * Fix round (2026-09-08, review finding T410-01): the "visibly non-uniform" pixel read had two bugs.
 * It stepped one byte at a time across an RGBA buffer, folding the always-255 alpha byte into `max` --
 * the metric degenerated to `255 - darkestRGBchannel`, which reads as real variation on any dark, flat
 * fill. And a bare `max - min` range lets one antialiased edge pixel carry the whole assertion. Both
 * are fixed below: the scan skips every 4th (alpha) byte, and the assertion is on the sample's
 * *variance*, not its range. Proven live against this tree: a probe div forced to a flat
 * `rgb(9,9,12)` fill scores range 246 under the old, alpha-inclusive metric (and would have passed
 * `> 10`) but a real, near-zero variance (0.89) under the fixed one.
 *
 * The clip rectangle is also no longer a hard-coded `{0,0,200,200}` -- that square was shader-only
 * only because the login card happens to be centred and `max-w-[34rem]`; a wider or repositioned
 * card (T4.9's call, not this file's) could silently start clipping into it with nobody noticing.
 * It is now derived from two real, live bounding boxes (the shader surface's own, and the login
 * card's) at test time: a square anchored at the surface's top-left corner, sized to the smaller of
 * the two real margins around the card. That square is geometrically guaranteed to never overlap the
 * card, at any viewport or card size, rather than assumed to.
 */

/** A unique property key from `ShaderField.tsx`'s own `SHADER_CONTEXT_ATTRIBUTES` object literal --
 *  property keys survive minification (only identifiers/locals get mangled), so this string reaching
 *  a network response body means the shader chunk was actually requested, in dev or in a production
 *  build alike. */
const SHADER_CHUNK_MARKER = 'failIfMajorPerformanceCaveat'

/** `ShaderField.tsx`'s own settle timer. The live channel below samples on either side of it with
 *  headroom (spec: "flat from t=6s to t=12s", "lost ... at t=6s") to absorb page-load and navigation
 *  overhead ahead of the first drawn frame, which the settle clock only starts counting from. */
const SETTLE_MS = 4500
const SAMPLE_AT_MS = 6000
const RECHECK_AT_MS = 12000

/** Smallest square worth reading a variance from -- below this, a viewport or card change has
 *  eaten so much of the margin that the sample would be noise-dominated regardless of the shader. */
const MIN_CLIP_PX = 40
const MAX_CLIP_PX = 200
/** A truly flat single-colour fill measures variance under ~1 (PNG re-encode noise only, confirmed
 *  live: a probe div forced to `rgb(9,9,12)` scored 0.89); a real, painted frame on this tree
 *  measures in the tens. 15 sits with real margin above the former and below the latter. */
const MIN_NONUNIFORM_VARIANCE = 15

/** A square clip guaranteed to sit entirely outside `cardBox`, anchored at `surfaceBox`'s own
 *  top-left corner -- see the file header's "Fix round" note. Derived from live geometry so a
 *  resized or repositioned card (T4.9's call) can never silently start bleeding into the sample. */
function shaderOnlyClip(surfaceBox: { x: number; y: number }, cardBox: { x: number; y: number }) {
  const marginX = cardBox.x - surfaceBox.x
  const marginY = cardBox.y - surfaceBox.y
  const size = Math.min(MAX_CLIP_PX, marginX, marginY)
  return { size, clip: { x: Math.round(surfaceBox.x), y: Math.round(surfaceBox.y), width: Math.round(size), height: Math.round(size) } }
}

async function armShaderProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __rafCount: number; __glContexts: WebGL2RenderingContext[] }
    w.__rafCount = 0
    w.__glContexts = []
    const rawRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      w.__rafCount += 1
      return rawRaf(callback)
    }
    const rawGetContext = HTMLCanvasElement.prototype.getContext as (...args: unknown[]) => unknown
    const patched = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      const context = rawGetContext.call(this, type, ...args)
      if (type === 'webgl2' && context) w.__glContexts.push(context as WebGL2RenderingContext)
      return context
    }
    HTMLCanvasElement.prototype.getContext = patched as typeof HTMLCanvasElement.prototype.getContext
  })
}

function armShaderChunkWatch(page: Page): { hits: string[] } {
  const hits: string[] = []
  page.on('response', (response) => {
    const url = response.url()
    if (!url.endsWith('.js')) return
    response.text().then((body) => {
      if (body.includes(SHADER_CHUNK_MARKER)) hits.push(url)
    }).catch(() => undefined)
  })
  return { hits }
}

test.describe('shader containment (spec family F)', () => {
  test('[data-shader-surface] is absent from dashboard, lesson, exercise and every lockdown surface', async () => {
    // The three placements the shader ever mounts on (`/login`, `/derot`, `/course/[code]`, per
    // `src/components/visual/ShaderSurface.tsx`'s only three call sites) are the complete allow
    // list; asserting these three routes never render it is therefore a static, source-level fact
    // this test pins mechanically rather than by re-deriving it from a live, authenticated crawl of
    // every route (dashboard/lesson/exercise carry no wellness or agent dependency worth minting a
    // session for just to prove a negative the import graph already guarantees).
    let grep = ''
    try {
      grep = execFileSync('git', [
        'grep', '-l', 'ShaderSurface', '--',
        'src/app/(app)/dashboard', 'src/app/(app)/lesson', 'src/app/(app)/exercise',
        'src/components/exercise/LockdownOverlay.tsx', 'src/components/shell/AccountNotice.tsx', 'src/components/account/IntegrityPanel.tsx',
      ], { encoding: 'utf8' })
    } catch (error) {
      // `git grep` exits 1 when nothing matches -- the desired outcome here, not a failure.
      if ((error as { status?: number }).status !== 1) throw error
    }
    expect(grep.trim(), `ShaderSurface must never be imported by dashboard, lesson, exercise or an enforcement surface; found: ${grep}`).toBe('')
  })

  test('[data-shader-surface] has zero count on real dashboard/lesson/exercise navigations, and under lockdown', async ({ page, context, baseURL }) => {
    // Fix round (T410-04): the git-grep test above pins the *source-level* fact that only three
    // files ever import `ShaderSurface`, but it never actually loads dashboard/lesson/exercise --
    // a shell- or layout-level `<ShaderSurface>` (e.g. `AppShell.tsx` or `(app)/layout.tsx`, neither
    // named in that grep's path list) would slip past it silently. This test mints a real learner
    // and checks the DOM directly on each route, plus under a real lockdown overlay.
    const env = readEnv()
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)
    const seeded = await service.from('exercises').select('id').eq('clo_id', 'INFS2101-3').eq('title', 'Username check').single()
    if (seeded.error) throw new Error('Load the smoke seed before running shader.spec.ts.', { cause: seeded.error })
    const exerciseId: string = seeded.data.id
    const email = `brogram-shader-${randomUUID()}@test.edu.qa`
    const inviteCode = randomUUID()
    const invite = await service.from('invites').insert({ code: inviteCode, email })
    if (invite.error) throw invite.error
    const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    const userId = link.data.user.id
    const state = {
      profile: { onboardingComplete: true, displayName: 'Shader' },
      currentCourse: 'INFS2101',
      path: ['INFS2101-3'],
      nextExerciseIds: [exerciseId],
      mastery: {},
      streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
      version: 0,
    }
    const inserted = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
    if (inserted.error) throw inserted.error

    try {
      await mintSession(env as E2eEnv, context, baseURL!, link.data)
      for (const path of ['/dashboard', '/lesson/INFS2101-3', `/exercise/${exerciseId}`]) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        await expect(page.locator('[data-shader-surface]'), `${path} rendered a shader surface`).toHaveCount(0)
      }

      // The lockdown overlay too, the same synthetic-blur technique motion.spec.ts and
      // blur-overlay.spec.ts already use, independent of the OS actually switching windows.
      await page.goto(`/exercise/${exerciseId}`)
      await expect(page.getByTestId('exercise-workspace')).toBeVisible()
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await expect(page.getByTestId('lockdown-overlay')).toBeVisible()
      await expect(page.locator('[data-shader-surface]'), 'lockdown overlay rendered a shader surface').toHaveCount(0)
    } finally {
      await deleteInvitedUser(service, userId, inviteCode)
    }
  })

  test('live (Eclipse, motion on): one context ever, RAF flat after settle, context lost and the frozen surface still visibly non-uniform', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await armShaderProbes(page)
    await page.addInitScript(() => {
      try { window.localStorage.setItem('brogram:theme', 'eclipse') } catch { /* no storage access */ }
    })
    const { hits } = armShaderChunkWatch(page)

    const startedAt = Date.now()
    await page.goto('/login', { waitUntil: 'load' })
    await expect(page.locator('[data-shader-surface]')).toHaveCount(1)
    await expect(page.locator('canvas[data-shader-field]')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'eclipse')

    // Two live boxes to derive a shader-only clip from -- see the file header's "Fix round" note.
    // `main > div` nth(1) is the login card (the surface itself is `main > div` nth(0), matching
    // `ShaderSurface`'s and `LoginPage`'s own sibling order in `src/app/(auth)/login/page.tsx`).
    const surfaceBox = await page.locator('[data-shader-surface]').boundingBox()
    const cardBox = await page.locator('main > div').nth(1).boundingBox()
    expect(surfaceBox, 'shader surface box').not.toBeNull()
    expect(cardBox, 'login card box').not.toBeNull()
    const { size, clip } = shaderOnlyClip(surfaceBox!, cardBox!)
    expect(size, 'no shader-only margin left around the login card to sample -- viewport or card size changed').toBeGreaterThanOrEqual(MIN_CLIP_PX)

    await page.waitForTimeout(Math.max(0, SAMPLE_AT_MS - (Date.now() - startedAt)))
    const glCount = await page.evaluate(() => (window as unknown as { __glContexts: unknown[] }).__glContexts.length)
    expect(glCount, 'exactly one live webgl2 context for the whole page load').toBe(1)
    const lostAtSample = await page.evaluate(() => (window as unknown as { __glContexts: WebGL2RenderingContext[] }).__glContexts[0]?.isContextLost())
    expect(lostAtSample, `context should be lost by t=${SAMPLE_AT_MS}ms (settles at ${SETTLE_MS}ms)`).toBe(true)
    await expect(page.locator('canvas[data-shader-frozen="true"]')).toBeVisible()
    const rafAtSample = await page.evaluate(() => (window as unknown as { __rafCount: number }).__rafCount)

    // Screenshot the shader-only margin and decode it back inside the page -- this reads what the
    // compositor painted, sidestepping the getContext('2d') lock this file's own header documents.
    const shot = await page.screenshot({ clip })
    const dataUrl = `data:image/png;base64,${shot.toString('base64')}`
    const variance = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      // Every 4th byte is alpha, always 255 for an opaque page render -- folding it into a
      // min/max scan degenerates the metric into "255 minus the darkest colour channel", which
      // reads as real variation on any dark, perfectly flat fill (fix round, T410-01).
      let sum = 0
      let sumSq = 0
      let n = 0
      for (let i = 0; i < data.length; i += 1) {
        if (i % 4 === 3) continue
        const value = data[i]
        sum += value
        sumSq += value * value
        n += 1
      }
      const mean = sum / n
      return sumSq / n - mean * mean
    }, dataUrl)
    expect(variance, 'the frozen surface should still show real pixel variance, not a flat fill').toBeGreaterThan(MIN_NONUNIFORM_VARIANCE)

    await page.waitForTimeout(Math.max(0, RECHECK_AT_MS - (Date.now() - startedAt)))
    const rafAtRecheck = await page.evaluate(() => (window as unknown as { __rafCount: number }).__rafCount)
    expect(rafAtRecheck, `requestAnimationFrame call count must be flat from t=${SAMPLE_AT_MS} to t=${RECHECK_AT_MS}`).toBe(rafAtSample)

    expect(hits.length, 'the shader chunk was legitimately requested on the live channel').toBeGreaterThan(0)
    await context.close()
  })

  test('reduced motion: no canvas and no shader chunk ever reaches the network, even in Eclipse', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.addInitScript(() => {
      try { window.localStorage.setItem('brogram:theme', 'eclipse') } catch { /* no storage access */ }
    })
    const { hits } = armShaderChunkWatch(page)

    await page.goto('/login', { waitUntil: 'load' })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'eclipse')
    // The CSS floor (`data-shader-surface`) still paints -- spec §6.1's "a finished look, not a
    // degraded one" -- only the live WebGL field is gated on motion.
    await expect(page.locator('[data-shader-surface]')).toHaveCount(1)
    await expect(page.locator('canvas[data-shader-field]')).toHaveCount(0)
    expect(hits, `the shader chunk must never be requested under reduced motion; saw ${hits.join(', ')}`).toHaveLength(0)
    await context.close()
  })
})
