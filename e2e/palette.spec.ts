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
 * element's own `background-color` (never a focused element's cascaded style), then paints that
 * resolved value onto a second, throwaway 1x1 `<canvas>` and reads the pixel back, rather than
 * parsing the resolved value's own text at all: Chromium returns registered custom properties in
 * different colour-function notations depending on which real CSS property resolves them
 * (`lab()` for `background-color`, `oklab()` for `outline-color` -- confirmed live), and a
 * colour-function-specific parser (this file used to hard-fail on anything but `lab()`) breaks on
 * the next Chromium release that changes which notation a given property serializes to.
 * `fillStyle`'s own *getter* turned out not to be the stable middleman the obvious fix reaches
 * for -- confirmed live against this tree that a `lab(... / 0.9)` alpha value round-trips through
 * `ctx.fillStyle = raw; ctx.fillStyle` completely unchanged (Chromium's canvas serializer keeps a
 * wide-gamut colour in its own notation rather than forcing it through lossy legacy `rgba()`), so
 * that string would still need a `lab()`-shaped parser, the exact fragility this fix removes.
 * `getImageData` has no such escape hatch: it is spec-guaranteed to return plain 8-bit sRGB bytes
 * for a default canvas regardless of what functional notation `fillStyle` was assigned (fix round,
 * T410-08) -- the same approach `ShaderField.tsx`'s own `readTokenColor` already uses, for the
 * same reason. Everything downstream of that round-trip is therefore plain sRGB byte math, never
 * colour-space conversion or string parsing.
 *
 * "No half-themed component" is checked two ways (fix round, T410-02): the original intra-theme
 * settle check (two captures of the *same*, now-settled theme, 200ms apart, byte-identical) proves
 * a component is not still mid-transition -- but it can never catch a component whose colour never
 * changes with the theme at all, since two captures of an unchanging thing are trivially identical
 * regardless of whether theming ever ran. The plan's own risk table names this exact gap ("A
 * screenshot looks the same in two palettes"). The second check closes it: one capture per theme is
 * kept, and every one of the ten distinct pairs is asserted to differ -- a hard-coded colour that
 * never varies with `data-theme` is stable within a theme (passes the first check) but identical
 * across all five (fails the second).
 */

const env = readEnv()

interface SrgbColor { r: number; g: number; b: number; alpha: number }

function compositeOver(fg: SrgbColor, bg: SrgbColor): SrgbColor {
  if (fg.alpha >= 1) return fg
  return {
    r: fg.r * fg.alpha + bg.r * (1 - fg.alpha),
    g: fg.g * fg.alpha + bg.g * (1 - fg.alpha),
    b: fg.b * fg.alpha + bg.b * (1 - fg.alpha),
    alpha: 1,
  }
}

function linearizeWcag(byte: number): number {
  const channel = byte / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(c: SrgbColor): number {
  return 0.2126 * linearizeWcag(c.r) + 0.7152 * linearizeWcag(c.g) + 0.0722 * linearizeWcag(c.b)
}

/** Standard WCAG contrast ratio (plain sRGB byte math -- no colour-space conversion needed once
 *  both inputs have already been normalized to sRGB by `readRingAndBackground`'s canvas
 *  round-trip). Not imported from `src/lib/theme/contrast.ts`: that file's `wcagRatio` only ever
 *  accepts parsed `oklch()` tuples, the wrong shape for the plain sRGB bytes this file works with. */
function wcagRatio(fg: SrgbColor, bg: SrgbColor): number {
  const fgOverBg = compositeOver(fg, bg)
  const lighter = Math.max(relativeLuminance(fgOverBg), relativeLuminance(bg))
  const darker = Math.min(relativeLuminance(fgOverBg), relativeLuminance(bg))
  return (lighter + 0.05) / (darker + 0.05)
}

async function readRingAndBackground(page: Page): Promise<{ ring: SrgbColor; background: SrgbColor }> {
  return page.evaluate(() => {
    function normalizeToSrgb(raw: string): { r: number; g: number; b: number; alpha: number } {
      // See the file header's "Fix round, T410-08": `getImageData` always returns plain 8-bit
      // sRGB bytes for a default canvas, regardless of which CSS Color 4 notation `fillStyle` was
      // assigned -- unlike `fillStyle`'s own getter, which can hand a wide-gamut colour straight
      // back in its original notation.
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = raw
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r, g, b, alpha: a / 255 }
    }
    function probe(varName: string) {
      const div = document.createElement('div')
      div.style.backgroundColor = `var(${varName})`
      document.body.appendChild(div)
      const raw = getComputedStyle(div).backgroundColor
      div.remove()
      return normalizeToSrgb(raw)
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
      const headerShots = new Map<string, Buffer>()
      for (const theme of THEMES) {
        await chooseTheme(page, theme.name)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
        lastAppliedId = theme.id

        // No half-themed component, part one: two captures of the same, now-settled state should
        // be pixel-identical with animations forced to their end state -- proves nothing is still
        // mid-transition, but says nothing about whether the theme actually applied (T410-02).
        await page.waitForTimeout(300)
        const shotA = await page.screenshot({ animations: 'disabled', clip: HEADER_CLIP })
        await page.waitForTimeout(200)
        const shotB = await page.screenshot({ animations: 'disabled', clip: HEADER_CLIP })
        expect(shotA.equals(shotB), `"${theme.name}" header band still differs 200ms apart -- a component may still be mid-transition or off-theme`).toBe(true)
        headerShots.set(theme.id, shotA)

        // Focus ring contrast >= 3:1 against the background.
        const { ring, background } = await readRingAndBackground(page)
        const ratio = wcagRatio(ring, background)
        expect(ratio, `"${theme.name}": --ring vs --background measured ${ratio.toFixed(2)}:1, below the 3:1 floor`).toBeGreaterThanOrEqual(MIN_FOCUS_RING_CONTRAST)
      }

      // No half-themed component, part two (fix round, T410-02): every one of the ten distinct
      // pairs of palettes must render the header band differently from every other. A component
      // whose colour never actually changes with `data-theme` (a hard-coded literal instead of a
      // token) passes the intra-theme check above -- it never fails to be "pixel-identical to
      // itself" -- but is caught here, since it is then pixel-identical across *every* theme.
      for (const a of THEMES) {
        for (const b of THEMES) {
          if (a.id >= b.id) continue
          expect(
            headerShots.get(a.id)!.equals(headerShots.get(b.id)!),
            `"${a.name}" and "${b.name}" render the header band identically -- a palette did not apply`,
          ).toBe(false)
        }
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
