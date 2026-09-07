import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { THEMES } from '../src/lib/theme/themes'
import { readEnv, hasEnv, serviceClient, mintSession, deleteInvitedUser, type E2eEnv } from './support/session'

/**
 * Wave 4 spec §10 family G's palette rows (plan T4.10 step 5). Each of the five applied in turn:
 * `data-theme` lands on `<html>`; no half-themed component; the focus ring clears 3:1 against the
 * background in all five; the choice survives a reload.
 *
 * Run on `/dashboard`, never a shader route (`/login`, `/derot`, `/course/[code]`): the live WebGL
 * field repaints every frame under Eclipse + full motion, which would make a plain two-screenshot
 * diff flag real, intended motion as a "half-themed" failure -- the wave gate's own manual pass
 * ("Open Account. Switch palette.") exercises exactly this surface for the same reason.
 *
 * The "no half-themed component" screenshot diff is clipped to the header band (`y: 0..200`), not
 * the full page: confirmed live against this tree (2026-09-08) that an unclipped diff is
 * unrelated-content-flaky -- the wellness dock's prayer-time text can tick over a minute boundary
 * between two captures a couple hundred ms apart, which is a real clock, not a half-applied theme.
 * Three full runs (15 checks) at this clip were stable; the header band is also where the
 * theme-defining chrome (wordmark, nav, the swatch trigger) actually lives.
 *
 * The focus-ring contrast check reads `--ring` and `--background` through a throwaway probe
 * element's own `background-color` (never a focused element's cascaded style) so both values pass
 * through the same CSS color-serialization path: Chromium returns registered custom properties in
 * different colour-function notations depending on which real CSS property resolves them
 * (`lab()` for `background-color`, `oklab()` for `outline-color` -- confirmed live), and reading
 * both off one property keeps this file to one small, generic Lab-to-linear-sRGB conversion instead
 * of two colour-space parsers.
 */

const env = readEnv()

function parseLab(value: string): { l: number; a: number; b: number; alpha: number } {
  const match = /^lab\(\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(value.trim())
  if (!match) throw new Error(`palette.spec.ts: not a lab() colour -- "${value}"`)
  return { l: Number(match[1]), a: Number(match[2]), b: Number(match[3]), alpha: match[4] !== undefined ? Number(match[4]) : 1 }
}

/** CIE Lab (D50) -> XYZ (D50) -> Bradford-adapted XYZ (D65) -> linear sRGB. Standard, public colour
 *  math (the same reference algorithm behind the CSS Color 4 `lab()` conversion), not BroGram
 *  business logic -- kept local rather than imported from `src/lib/theme/contrast.ts`, whose
 *  `wcagRatio`/`oklchToSrgb` only ever accept `oklch()` strings, the wrong colour function for what
 *  the browser hands back here. */
function labToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
  const delta = 6 / 29
  const finv = (t: number) => (t > delta ? t ** 3 : 3 * delta * delta * (t - 4 / 29))
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const [xn, yn, zn] = [0.9642956764295677, 1, 0.8251046025104602] // D50 white point
  const x = finv(fx) * xn
  const y = finv(fy) * yn
  const z = finv(fz) * zn
  const xd = 0.9555766 * x - 0.0230393 * y + 0.0631636 * z
  const yd = -0.0282895 * x + 1.0099416 * y + 0.0210077 * z
  const zd = 0.0122982 * x - 0.020483 * y + 1.3299098 * z
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return [
    clamp(3.2404542 * xd - 1.5371385 * yd - 0.4985314 * zd),
    clamp(-0.969266 * xd + 1.8760108 * yd + 0.041556 * zd),
    clamp(0.0556434 * xd - 0.2040259 * yd + 1.0572252 * zd),
  ]
}

function srgbGammaEncode(linear: number): number {
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
}

function compositeOver(fg: [number, number, number], alpha: number, bg: [number, number, number]): [number, number, number] {
  return [fg[0] * alpha + bg[0] * (1 - alpha), fg[1] * alpha + bg[1] * (1 - alpha), fg[2] * alpha + bg[2] * (1 - alpha)]
}

function linearizeWcag(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearizeWcag(r) + 0.7152 * linearizeWcag(g) + 0.0722 * linearizeWcag(b)
}

function wcagRatioFromLab(fgLab: string, bgLab: string): number {
  const fg = parseLab(fgLab)
  const bg = parseLab(bgLab)
  const bgSrgb = labToLinearSrgb(bg.l, bg.a, bg.b).map(srgbGammaEncode) as [number, number, number]
  let fgSrgb = labToLinearSrgb(fg.l, fg.a, fg.b).map(srgbGammaEncode) as [number, number, number]
  if (fg.alpha < 1) fgSrgb = compositeOver(fgSrgb, fg.alpha, bgSrgb)
  const lighter = Math.max(relativeLuminance(fgSrgb), relativeLuminance(bgSrgb))
  const darker = Math.min(relativeLuminance(fgSrgb), relativeLuminance(bgSrgb))
  return (lighter + 0.05) / (darker + 0.05)
}

async function readRingAndBackground(page: Page): Promise<{ ring: string; background: string }> {
  return page.evaluate(() => {
    function probe(varName: string): string {
      const div = document.createElement('div')
      div.style.backgroundColor = `var(${varName})`
      document.body.appendChild(div)
      const color = getComputedStyle(div).backgroundColor
      div.remove()
      return color
    }
    return { ring: probe('--ring'), background: probe('--background') }
  })
}

async function chooseTheme(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Choose theme' }).click()
  await page.getByRole('radio', { name }).click()
}

const HEADER_CLIP = { x: 0, y: 0, width: 1280, height: 200 } as const
const MIN_FOCUS_RING_CONTRAST = 3

test.describe('palette (spec family G, five applied in turn)', () => {
  test('each of the five palettes: data-theme lands, no half-themed component, focus ring >= 3:1, survives a reload', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const service = serviceClient(env as E2eEnv)
    const email = `brogram-palette-${randomUUID()}@test.edu.qa`
    const inviteCode = randomUUID()
    const invite = await service.from('invites').insert({ code: inviteCode, email })
    if (invite.error) throw invite.error
    const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    const userId = link.data.user.id
    const state = {
      profile: { onboardingComplete: true, displayName: 'Palette' },
      currentCourse: 'INFS2101',
      path: ['INFS2101-3'],
      nextExerciseIds: [] as string[],
      mastery: {},
      streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
      version: 0,
    }
    const inserted = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
    if (inserted.error) throw inserted.error

    try {
      await mintSession(env as E2eEnv, context, baseURL!, link.data)
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      let lastAppliedId: string | undefined
      for (const theme of THEMES) {
        await chooseTheme(page, theme.name)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
        lastAppliedId = theme.id

        // No half-themed component: two captures of the same, now-settled state should be
        // pixel-identical with animations forced to their end state.
        await page.waitForTimeout(300)
        const shotA = await page.screenshot({ animations: 'disabled', clip: HEADER_CLIP })
        await page.waitForTimeout(200)
        const shotB = await page.screenshot({ animations: 'disabled', clip: HEADER_CLIP })
        expect(shotA.equals(shotB), `"${theme.name}" header band still differs 200ms apart -- a component may still be mid-transition or off-theme`).toBe(true)

        // Focus ring contrast >= 3:1 against the background.
        const { ring, background } = await readRingAndBackground(page)
        const ratio = wcagRatioFromLab(ring, background)
        expect(ratio, `"${theme.name}": --ring vs --background measured ${ratio.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(MIN_FOCUS_RING_CONTRAST)
      }

      // The choice survives a reload (next-themes' own client-only localStorage read, the same
      // mechanism `e2e/dock-and-theme.spec.ts` already relies on for its four themes).
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', lastAppliedId!)
    } finally {
      await deleteInvitedUser(service, userId, inviteCode)
    }
  })
})
