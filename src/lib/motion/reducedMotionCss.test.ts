import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// V3/A11Y-04 (wave 2 review, section 5): verifies the three-state CSS gate
// this fix lane added to `src/app/globals.css` -- a global source-scan
// assertion, the same shape `src/lib/theme/contrast.test.ts` already uses
// against the same file, so a future edit to the reduced-motion block
// cannot silently drop a state without a test noticing.

const SRC_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const GLOBALS_CSS_PATH = join(SRC_DIR, 'app', 'globals.css')
const css = readFileSync(GLOBALS_CSS_PATH, 'utf8')

describe('globals.css: the reduced-motion gate for looping utility animations', () => {
  it('freezes animate-pulse/bounce/ping under an explicit data-motion="reduced" (the in-app choice always wins)', () => {
    expect(css).toMatch(/:root\[data-motion=['"]reduced['"]\][^{]*\.animate-pulse/)
    expect(css).toMatch(/:root\[data-motion=['"]reduced['"]\][^{]*\.animate-bounce/)
    expect(css).toMatch(/:root\[data-motion=['"]reduced['"]\][^{]*\.animate-ping/)
  })

  it('also freezes them from a bare OS prefers-reduced-motion signal, but only while data-motion has not been explicitly set to "full" -- resolveMotion(\'full\', true) === false must not get frozen skeletons', () => {
    const mediaBlockMatch = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)
    expect(mediaBlockMatch, 'expected at least one @media (prefers-reduced-motion: reduce) block').toBeTruthy()
    const motionUtilityBlock = mediaBlockMatch!.find((block) => block.includes('.animate-pulse'))
    expect(motionUtilityBlock, 'no @media (prefers-reduced-motion: reduce) block gates .animate-pulse').toBeTruthy()
    expect(motionUtilityBlock).toContain(":not([data-motion='full'])")
    expect(motionUtilityBlock).toContain('.animate-bounce')
    expect(motionUtilityBlock).toContain('.animate-ping')
  })

  it('deliberately does not freeze animate-spin -- the app\'s only two current uses of it are indeterminate progress spinners, not decorative loops', () => {
    // Isolate just the two rule blocks this lane added (identified by their
    // shared `animation-iteration-count: 1` declaration, distinct from the
    // pre-existing view-transition kill switches above them) and confirm
    // neither one's selector list names `.animate-spin`.
    const iterationCountBlocks = css.match(/[^}]*animation-iteration-count: 1 !important;[^}]*\}/g) ?? []
    expect(iterationCountBlocks.length).toBeGreaterThan(0)
    for (const block of iterationCountBlocks) expect(block).not.toContain('.animate-spin')
  })
})
