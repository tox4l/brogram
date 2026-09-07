import { randomUUID } from 'node:crypto'
import { test, expect, type Locator } from '@playwright/test'
import { readEnv, hasEnv, serviceClient, mintSession, deleteInvitedUser, type E2eEnv } from './support/session'

/**
 * Wave 4 spec §10 family C (plan T4.10 step 3), at 1280 x 800: the walkthrough prose column, the
 * CLO list, the exercise brief and the reports intro measure 55-80 rendered characters per line
 * (the exercise brief's own band is 42-60, by the 22:30 Doha ruling); the brief column is >= 320px
 * and the editor column >= 480px; the three exercise panels share a top edge within 2px (at the
 * >=75rem, dock-off-the-rail three-column step -- the ruling names this as where all three land on
 * one row); the header is 56px; every nav target is >= 24x24 CSS px and Buddy/sound/theme are
 * >= 44x44; the wellness rail's first label baseline sits within 2px of the page H1 baseline.
 *
 * "Rendered characters per line" cannot be read off any DOM property directly -- it is measured the
 * same way every fix round this wave already did by hand (T4.4/T4.6/T4.7's own commit messages: "ch
 * is the advance of a zero, not of an average prose glyph", "measured live in the DOM, real compiled
 * CSS, real Geist Sans"): a column's rendered width in CSS px, divided by the font's own average
 * advance per character. `charsPerLine` below measures that average from a fixed, letter-frequency-
 * balanced reference sentence (a pangram) rather than from whatever text the element happens to
 * contain -- confirmed live against this tree (2026-09-08) that measuring from the element's OWN
 * text instead is not safe: the reports intro's real fallback string ("Next exercises are still
 * being prepared.") is short and unusually narrow-glyph-heavy, and self-measuring against it read
 * ~99 chars/line on a column that reference-measures at ~65 -- the same distortion a one-word label
 * ("example") produced on the exercise brief. The reference sentence is long enough (75 chars, mixed
 * case, every letter of the alphabet at least once) that its own average advance is stable across
 * the faces this wave ships (Geist Sans, Archivo, Newsreader).
 */
const CHARS_PER_LINE_REFERENCE = 'The quick brown fox jumps over the lazy dog and reads twelve boxes fully.'

const FAMILY_C_BAND = { min: 55, max: 80 } as const
/** Ruling (22:30 Doha, 2026-09-07): the brief is a side panel beside a code editor, not a reading
 *  column -- its own band is narrower, measured 43-50 across the bank on the reference commit. */
const BRIEF_BAND = { min: 42, max: 60 } as const
const BRIEF_FLOOR_PX = 320
const EDITOR_FLOOR_PX = 480
const HEADER_HEIGHT_PX = 56
const NAV_TARGET_MIN_PX = 24
const CONTROL_TARGET_MIN_PX = 44
const PANEL_FLUSH_TOLERANCE_PX = 2
const BASELINE_TOLERANCE_PX = 2

async function charsPerLine(locator: Locator): Promise<number> {
  return locator.evaluate((el, reference) => {
    const style = getComputedStyle(el)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const avgCharWidth = ctx.measureText(reference).width / reference.length
    return el.getBoundingClientRect().width / avgCharWidth
  }, CHARS_PER_LINE_REFERENCE)
}

/**
 * Approximates a text element's baseline in viewport-space CSS px from the font's own metrics
 * (`fontBoundingBoxAscent`/`Descent`, via a throwaway canvas) plus the element's own line-height,
 * rather than assuming `rect.top`/`rect.bottom` line up with it -- two elements at different font
 * sizes never share a `rect` edge even when their baselines are pixel-aligned. Validated against
 * this tree (2026-09-08, dashboard, Midnight): H1 ("Today.", 32px/40px) and the wellness rail's
 * "Wellness" h2 (13px/20px) come back 1.0px apart despite an 11px gap between their `rect.top`s and
 * a 20px difference in line-height, which is the actual, reviewed fix (8c062bd, "rail baseline
 * offset") this assertion exists to hold in place.
 */
async function baselineY(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = ctx.measureText(el.textContent || 'Hg')
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? 0
    const rect = el.getBoundingClientRect()
    const lineHeight = Number.parseFloat(style.lineHeight)
    const halfLeading = (lineHeight - (ascent + descent)) / 2
    return rect.top + halfLeading + ascent
  })
}

async function expectBandForEach(locator: Locator, band: { min: number; max: number }, label: string) {
  const count = await locator.count()
  expect(count, `expected at least one "${label}" element to measure`).toBeGreaterThan(0)
  for (let i = 0; i < count; i += 1) {
    const value = await charsPerLine(locator.nth(i))
    expect(value, `${label}[${i}] measured ${value.toFixed(1)} chars/line, outside ${band.min}-${band.max}`).toBeGreaterThanOrEqual(band.min)
    expect(value, `${label}[${i}] measured ${value.toFixed(1)} chars/line, outside ${band.min}-${band.max}`).toBeLessThanOrEqual(band.max)
  }
}

const env = readEnv()

/** A minimal, always-valid `learner_state.state` document: `(app)/layout.tsx` only trusts a stored
 *  row once `profile`, `streak` and `mastery` are each present as objects (its own `record()` guard)
 *  -- a document missing any of the three is treated as absent and every page falls back to a fresh
 *  compiled default (`currentCourse: null`), which is silently wrong for a measure test that expects
 *  a real course home / lesson / exercise / report render. Confirmed live: omitting `streak`/`mastery`
 *  is exactly what made `/reports` render its course-less empty state even with `currentCourse` set. */
function learnerState(currentCourse: string | null, nextExerciseIds: string[] = []) {
  return {
    profile: { onboardingComplete: true, displayName: 'Measure' },
    currentCourse,
    path: currentCourse ? ['INFS2101-3'] : [],
    nextExerciseIds,
    mastery: {},
    streak: { exerciseDays: 0, derotDays: 0, lastExerciseDate: null, lastDerotDate: null },
    version: 0,
  }
}

async function mintMeasureUser(service: ReturnType<typeof serviceClient>, tag: string, state: ReturnType<typeof learnerState>) {
  const email = `brogram-measure-${tag}-${randomUUID()}@test.edu.qa`
  const inviteCode = randomUUID()
  const invite = await service.from('invites').insert({ code: inviteCode, email })
  if (invite.error) throw invite.error
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const userId = link.data.user.id
  const inserted = await service.from('learner_state').insert({ user_id: userId, state, version: 0 })
  if (inserted.error) throw inserted.error
  return { userId, inviteCode, link: link.data }
}

test.describe('measure: reading columns, panel geometry, targets (1280x800)', () => {
  test('walkthrough prose column measures 55-80 characters per line', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const svc = serviceClient(env as E2eEnv)
    const u = await mintMeasureUser(svc, 'lesson', learnerState('INFS2101'))
    try {
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto('/lesson/INFS2101-3')
      await page.waitForLoadState('networkidle')
      await expectBandForEach(page.locator('p.font-prose'), FAMILY_C_BAND, 'walkthrough prose')
    } finally {
      await deleteInvitedUser(svc, u.userId, u.inviteCode)
    }
  })

  test('course home CLO list measures 55-80 characters per line', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const svc = serviceClient(env as E2eEnv)
    const u = await mintMeasureUser(svc, 'course', learnerState('INFS2101'))
    try {
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto('/course/INFS2101')
      await page.waitForLoadState('networkidle')
      // Scoped to the node title span specifically (`font-medium text-body`), not every
      // `max-w-[34rem]` block in a node -- the smaller "Builds on X" prerequisite sub-line
      // (`text-small`) is a caption, not a reading paragraph, and reference-measures at ~90
      // chars/line (its smaller glyphs fit more per the same 34rem column) -- a real number for
      // that element, just not the one family C is naming with "the CLO list".
      await expectBandForEach(page.locator('li[id^="clo-node-"] span.font-medium.text-body'), FAMILY_C_BAND, 'CLO title')
    } finally {
      await deleteInvitedUser(svc, u.userId, u.inviteCode)
    }
  })

  test('reports intro measures 55-80 characters per line', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    // A brand-new account with no `learner_state` row at all: `(app)/layout.tsx` then compiles a
    // fresh default (`currentCourse: null`), which is exactly Reports' own "no course chosen yet"
    // intro -- the one reports paragraph that is genuinely a reading column (`max-w-[34rem]`), as
    // opposed to the printed report's own fixed-width A4 page (794px, a print-page convention with
    // its own wider, deliberately different measure -- out of scope for this reading-column band).
    const svc = serviceClient(env as E2eEnv)
    const email = `brogram-measure-reports-${randomUUID()}@test.edu.qa`
    const inviteCode = randomUUID()
    const invite = await svc.from('invites').insert({ code: inviteCode, email })
    if (invite.error) throw invite.error
    const link = await svc.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    const userId = link.data.user.id
    try {
      await mintSession(env as E2eEnv, context, baseURL!, link.data)
      await page.goto('/reports')
      await page.waitForLoadState('networkidle')
      await expect(page.getByText('Choose a course to see progress.')).toBeVisible()
      await expectBandForEach(page.locator('div.max-w-\\[34rem\\].space-y-3 p'), FAMILY_C_BAND, 'reports intro')
    } finally {
      await deleteInvitedUser(svc, userId, inviteCode)
    }
  })

  test('exercise brief measures 42-60 characters per line, brief/editor floors hold at the default dock', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const svc = serviceClient(env as E2eEnv)
    const seeded = await svc.from('exercises').select('id').eq('clo_id', 'INFS2101-3').eq('title', 'Username check').single()
    if (seeded.error) throw new Error('Load the smoke seed before running measure.spec.ts.', { cause: seeded.error })
    const exerciseId: string = seeded.data.id
    const u = await mintMeasureUser(svc, 'exercise', learnerState('INFS2101', [exerciseId]))
    try {
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto(`/exercise/${exerciseId}`)
      await page.waitForLoadState('networkidle')

      const brief = page.getByRole('region', { name: 'Rep prompt' })
      await expect(brief).toBeVisible()
      // The task-description paragraphs specifically (`font-normal text-body`), not the example
      // labels ("example", "short") or the CLO outcome line beneath (`text-small`) -- those are
      // captions, and the one-word labels reference-measure far outside any band by construction.
      await expectBandForEach(brief.locator('p.font-normal.text-body'), BRIEF_BAND, 'exercise brief')

      const briefBox = await brief.boundingBox()
      expect(briefBox?.width, 'brief column width').toBeGreaterThanOrEqual(BRIEF_FLOOR_PX)

      // "Editor column" is the Work region's own track (the grid column CodeMirror sits inside),
      // not the CodeMirror content box itself -- confirmed live: at the default right-rail dock
      // (shell affords 888px, ruling 22:30 Doha) the Work region measures 512px but the inner
      // `textbox` measures 478.6px (CodeMirror's own gutter/padding), under the 480px floor by
      // construction; the brief's own 320px floor is checked the same way, against its column.
      const work = page.getByRole('region', { name: 'Work' })
      const workBox = await work.boundingBox()
      expect(workBox?.width, 'editor (Work) column width').toBeGreaterThanOrEqual(EDITOR_FLOOR_PX)
    } finally {
      await deleteInvitedUser(svc, u.userId, u.inviteCode)
    }
  })

  test('exercise: three panels share a top edge within 2px at the three-column step', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    // Ruling (22:30 Doha, 2026-09-07): the two-column step (brief beside code, results spanning
    // below) applies at the default right-rail dock; the three-column layout (all three flush on
    // one row) applies from 75rem, reached here by taking the dock off the rail (`placement:
    // 'hidden'`) rather than by widening the viewport past this suite's fixed 1280x800.
    const svc = serviceClient(env as E2eEnv)
    const seeded = await svc.from('exercises').select('id').eq('clo_id', 'INFS2101-3').eq('title', 'Username check').single()
    if (seeded.error) throw new Error('Load the smoke seed before running measure.spec.ts.', { cause: seeded.error })
    const exerciseId: string = seeded.data.id
    const u = await mintMeasureUser(svc, 'panels', learnerState('INFS2101', [exerciseId]))
    try {
      const dock = await svc.from('wellness').upsert({ user_id: u.userId, prefs: { dock: { placement: 'hidden' } } }, { onConflict: 'user_id' })
      if (dock.error) throw dock.error
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto(`/exercise/${exerciseId}`)
      await page.waitForLoadState('networkidle')

      const brief = page.getByRole('region', { name: 'Rep prompt' })
      const work = page.getByRole('region', { name: 'Work' })
      // The results panel carries no `aria-label` of its own; it is the workspace grid's third
      // and last direct child (brief wrapper, Work section, results) -- the same grid `brief`/
      // `work` resolve into, selected by its own literal Tailwind class list (this task's own
      // e2e file, not a change to the page it measures).
      const results = page.locator('div.grid.min-w-0.items-start.gap-6 > *').last()

      const [briefBox, workBox, resultsBox] = await Promise.all([brief.boundingBox(), work.boundingBox(), results.boundingBox()])
      expect(briefBox, 'brief box').not.toBeNull()
      expect(workBox, 'work box').not.toBeNull()
      expect(resultsBox, 'results box').not.toBeNull()
      const tops = [briefBox!.y, workBox!.y, resultsBox!.y]
      const spread = Math.max(...tops) - Math.min(...tops)
      expect(spread, `the three panels' top edges span ${spread}px; expected <= ${PANEL_FLUSH_TOLERANCE_PX}px`).toBeLessThanOrEqual(PANEL_FLUSH_TOLERANCE_PX)
    } finally {
      await deleteInvitedUser(svc, u.userId, u.inviteCode)
    }
  })

  test('header is 56px; nav targets >= 24x24; Buddy, sound and theme are >= 44x44', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const svc = serviceClient(env as E2eEnv)
    const u = await mintMeasureUser(svc, 'header', learnerState('INFS2101'))
    try {
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      const headerRow = page.locator('header > div')
      const headerBox = await headerRow.boundingBox()
      expect(headerBox?.height, 'header content height').toBeCloseTo(HEADER_HEIGHT_PX, 0)

      for (const name of ['Courses', 'De-rot', 'Progress']) {
        const box = await page.getByRole('link', { name, exact: true }).first().boundingBox()
        expect(box, `nav target "${name}"`).not.toBeNull()
        expect(box!.width, `nav target "${name}" width`).toBeGreaterThanOrEqual(NAV_TARGET_MIN_PX)
        expect(box!.height, `nav target "${name}" height`).toBeGreaterThanOrEqual(NAV_TARGET_MIN_PX)
      }

      const buddy = await page.getByRole('button', { name: 'Buddy' }).boundingBox()
      const theme = await page.getByRole('button', { name: 'Choose theme' }).boundingBox()
      const sound = await page.getByRole('button', { name: /Mute sound|Unmute sound/ }).boundingBox()
      for (const [label, box] of [['Buddy', buddy], ['theme', theme], ['sound', sound]] as const) {
        expect(box, `control "${label}"`).not.toBeNull()
        expect(box!.width, `control "${label}" width`).toBeGreaterThanOrEqual(CONTROL_TARGET_MIN_PX)
        expect(box!.height, `control "${label}" height`).toBeGreaterThanOrEqual(CONTROL_TARGET_MIN_PX)
      }
    } finally {
      await deleteInvitedUser(svc, u.userId, u.inviteCode)
    }
  })

  test('the wellness rail\'s first label baseline is within 2px of the page H1 baseline', async ({ page, context, baseURL }) => {
    test.skip(!hasEnv(env), 'Pending C5: configure Supabase and run node scripts/seed-load.mjs first.')
    const svc = serviceClient(env as E2eEnv)
    const u = await mintMeasureUser(svc, 'baseline', learnerState('INFS2101'))
    try {
      await mintSession(env as E2eEnv, context, baseURL!, u.link)
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      const h1 = page.getByRole('heading', { level: 1 }).first()
      const wellnessLabel = page.getByRole('heading', { name: 'Wellness', level: 2 }).first()
      await expect(h1).toBeVisible()
      await expect(wellnessLabel).toBeVisible()

      const [h1Baseline, railBaseline] = await Promise.all([baselineY(h1), baselineY(wellnessLabel)])
      const delta = Math.abs(h1Baseline - railBaseline)
      expect(delta, `rail label baseline is ${delta.toFixed(1)}px from the H1 baseline; expected <= ${BASELINE_TOLERANCE_PX}px`).toBeLessThanOrEqual(BASELINE_TOLERANCE_PX)
    } finally {
      await deleteInvitedUser(svc, u.userId, u.inviteCode)
    }
  })
})
