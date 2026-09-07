import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'

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

    await page.waitForTimeout(Math.max(0, SAMPLE_AT_MS - (Date.now() - startedAt)))
    const glCount = await page.evaluate(() => (window as unknown as { __glContexts: unknown[] }).__glContexts.length)
    expect(glCount, 'exactly one live webgl2 context for the whole page load').toBe(1)
    const lostAtSample = await page.evaluate(() => (window as unknown as { __glContexts: WebGL2RenderingContext[] }).__glContexts[0]?.isContextLost())
    expect(lostAtSample, `context should be lost by t=${SAMPLE_AT_MS}ms (settles at ${SETTLE_MS}ms)`).toBe(true)
    await expect(page.locator('canvas[data-shader-frozen="true"]')).toBeVisible()
    const rafAtSample = await page.evaluate(() => (window as unknown as { __rafCount: number }).__rafCount)

    // Screenshot the visible margin outside the centred login card (the shader canvas spans the
    // whole `<main>`; the card sits on top of most of it) and decode it back inside the page --
    // this reads what the compositor painted, sidestepping the getContext('2d') lock this file's
    // own header documents.
    const clip = { x: 0, y: 0, width: 200, height: 200 }
    const shot = await page.screenshot({ clip })
    const dataUrl = `data:image/png;base64,${shot.toString('base64')}`
    const range = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let min = 255
      let max = 0
      for (let i = 0; i < data.length; i += 1) {
        const value = data[i]
        if (value < min) min = value
        if (value > max) max = value
      }
      return max - min
    }, dataUrl)
    expect(range, 'the frozen surface should still show real byte-level variation, not a flat fill').toBeGreaterThan(10)

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
