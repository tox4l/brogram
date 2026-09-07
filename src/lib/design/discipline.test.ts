// T4.1 -- the design-discipline gates (wave 4 spec section 10 family B;
// plan T4.1 Step 3). Two layers:
//
//  1. Fixture-level tests of every pure `match*` function in
//     scripts/check-design-tokens.mjs, pinning exact match/no-match cases
//     with no filesystem access -- this is the part a future rule change
//     reviews against, and the part that would catch a regex regression
//     (e.g. a rule quietly starting to match `text-lede`, or a `2xl` radius
//     being rejected) long before the real-tree gate below would notice.
//  2. The real-tree gate: every `RULES` entry, scanned against the actual
//     source tree, asserted at zero violations outside
//     `src/lib/design/allowlist.ts`'s per-rule, per-task entries -- plus a
//     check that the allowlist itself never carries an ownerless or
//     out-of-plan entry (a review failure per the plan's own wording).
//
// Extending a rule? Add its fixture tests here, its `match*`/`rule*` pair
// and its `RULES` entry in check-design-tokens.mjs, and (if it inherits
// today's debt) its allowlist entries in allowlist.ts.

import { describe, expect, it } from 'vitest'
import {
  matchRawTextScale,
  matchPaletteClasses,
  matchSpacingScale,
  matchRadii,
  matchIconSize,
  matchMotionCss,
  matchFilledButtonsPerRoute,
  matchFontWeightCounts,
  matchWillChangeTransform,
  stripComments,
  RULES,
  ruleFontWeightRatio,
} from '../../../scripts/check-design-tokens.mjs'
import { ALLOWLIST, FONT_WEIGHT_RATIO_ALLOWANCE, type AllowlistEntry } from './allowlist'

type Entry = { file: string; content: string }

function fx(content: string, file = 'fixture.tsx'): Entry[] {
  return [{ file, content }]
}

// ---------------------------------------------------------------------------
// 1. Fixture-level rule tests
// ---------------------------------------------------------------------------

describe('matchRawTextScale', () => {
  it('flags every raw Tailwind type-scale step', () => {
    const hits = matchRawTextScale(fx('<p className="text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-4xl">x</p>'))
    expect(hits.map((h: { match: string }) => h.match)).toEqual([
      'text-xs',
      'text-sm',
      'text-base',
      'text-lg',
      'text-xl',
      'text-2xl',
      'text-3xl',
      'text-4xl',
    ])
  })

  it('does not flag the additive scale BroGram actually ships', () => {
    expect(matchRawTextScale(fx('<p className="text-lede text-hero text-hero-lg text-micro text-small text-body">x</p>'))).toHaveLength(0)
  })

  it('matches regardless of a variant prefix', () => {
    expect(matchRawTextScale(fx('<p className="dark:text-sm sm:text-2xl">x</p>'))).toHaveLength(2)
  })
})

describe('matchPaletteClasses', () => {
  it('flags a hard-coded hue at a two- or three-digit step', () => {
    const hits = matchPaletteClasses(fx('className="bg-emerald-300 text-neutral-900 border-sky-50"'))
    expect(hits.map((h: { match: string }) => h.match)).toEqual(['bg-emerald-300', 'text-neutral-900', 'border-sky-50'])
  })

  it('does not flag a semantic token', () => {
    expect(matchPaletteClasses(fx('className="bg-primary text-foreground border-rule ring-ring"'))).toHaveLength(0)
  })
})

describe('matchSpacingScale', () => {
  it('flags a half-step and an arbitrary value', () => {
    const hits = matchSpacingScale(fx('className="p-5 gap-1.5 mt-[10px] space-y-7"'))
    expect(hits.map((h: { match: string }) => h.match)).toEqual(['p-5', 'gap-1.5', 'mt-[10px]', 'space-y-7'])
  })

  it('allows the eight-step rhythm plus zero, on every box-model prefix', () => {
    const clean = 'className="p-0 p-1 p-2 p-3 p-4 p-6 p-8 p-12 p-16 mx-4 my-4 gap-4 gap-x-8 gap-y-8 space-x-8 space-y-8"'
    expect(matchSpacingScale(fx(clean))).toHaveLength(0)
  })

  it('does not touch width/height/size utilities (a different scale on purpose)', () => {
    expect(matchSpacingScale(fx('className="w-1/2 h-full size-10 w-[22rem]"'))).toHaveLength(0)
  })

  // Fix round (review M3): the plan's literal prefix list was margin/
  // padding/gap/space only, omitting Tailwind's logical properties and the
  // inset family, which read the same spacing scale.
  it('flags the logical and inset-family prefixes on the same rhythm', () => {
    const hits = matchSpacingScale(fx('className="ps-5 me-7 inset-5 inset-x-5 top-5"'))
    expect(hits.map((h: { match: string }) => h.match)).toEqual(['ps-5', 'me-7', 'inset-5', 'inset-x-5', 'top-5'])
  })

  it('allows the rhythm on the logical and inset-family prefixes too', () => {
    expect(matchSpacingScale(fx('className="ps-4 me-4 inset-4 inset-x-4 top-4"'))).toHaveLength(0)
  })

  // The `-px` step (Tailwind's literal 1px) was previously invisible, not
  // merely misclassified -- the value group required a digit, so `p-px`
  // never matched at all.
  it('flags the -px step, which is not part of the eight-step rhythm', () => {
    const hits = matchSpacingScale(fx('className="p-px m-px"'))
    expect(hits.map((h: { match: string }) => h.match)).toEqual(['p-px', 'm-px'])
  })
})

describe('matchRadii', () => {
  it('flags the bare default radius and every disallowed named size', () => {
    const hits = matchRadii(fx('className="rounded rounded-sm rounded-md rounded-none rounded-3xl"'))
    expect(hits.map((h: { match: string }) => h.match)).toEqual(['rounded', 'rounded-sm', 'rounded-md', 'rounded-none', 'rounded-3xl'])
  })

  it('allows exactly the four licensed sizes, bare or on a side/corner', () => {
    const clean = 'className="rounded-lg rounded-xl rounded-2xl rounded-full rounded-t-lg rounded-tl-2xl rounded-b-full"'
    expect(matchRadii(fx(clean))).toHaveLength(0)
  })

  it('does not confuse rounded-3xl with the allowed rounded-2xl/xl', () => {
    const hits = matchRadii(fx('className="rounded-3xl"'))
    expect(hits).toHaveLength(1)
  })

  // Fix round (review I1): the suffix used to be matched against a closed
  // eight-name enumeration, and the trailing negative lookahead rejected
  // the *whole* match whenever the suffix was anything else -- so an
  // unrecognised radius produced no match at all instead of a violation.
  it('flags rounded-4xl, an arbitrary value, and an arbitrary value on a side (all previously invisible)', () => {
    const hits = matchRadii(fx('className="rounded-4xl rounded-[6px] rounded-t-[6px] rounded-[inherit]"'))
    expect(hits.map((h: { match: string }) => h.match)).toEqual(['rounded-4xl', 'rounded-[6px]', 'rounded-t-[6px]', 'rounded-[inherit]'])
  })

  it('flags an arbitrary radius wrapping a CSS function, unbroken by the parens inside it', () => {
    const hits = matchRadii(fx('className="rounded-[min(var(--radius-md),10px)]"'))
    expect(hits).toHaveLength(1)
    expect(hits[0].match).toBe('rounded-[min(var(--radius-md),10px)]')
  })
})

describe('matchIconSize', () => {
  it('flags a named lucide import at size-3 or a numeric size prop under 16', () => {
    const src = `import { Check, X } from 'lucide-react'\nfunction C() { return <div><Check className="size-3" /><X size={12} /></div> }`
    expect(matchIconSize(fx(src))).toHaveLength(2)
  })

  it('flags size-3.5 and does not flag size-4', () => {
    const src = `import { Check } from 'lucide-react'\nfunction C() { return <Check className="size-3.5" /> }`
    expect(matchIconSize(fx(src))).toHaveLength(1)
    const clean = `import { Check } from 'lucide-react'\nfunction C() { return <Check className="size-4" /> }`
    expect(matchIconSize(fx(clean))).toHaveLength(0)
  })

  it('does not flag a same-named local component that never came from lucide-react', () => {
    const src = `function Check() { return null }\nfunction C() { return <Check className="size-3" /> }`
    expect(matchIconSize(fx(src))).toHaveLength(0)
  })

  it('resolves an aliased import to its local name', () => {
    const src = `import { Check as CheckIcon } from 'lucide-react'\nfunction C() { return <CheckIcon size={10} /> }`
    expect(matchIconSize(fx(src))).toHaveLength(1)
  })

  // Fix round (review M1): a parent wrapper utility sizes every lucide
  // glyph inside it without the sizing ever appearing on the icon's own
  // tag -- the element loop above cannot see it. No lucide import is
  // needed for this sub-pattern to fire; it reads the parent's own class.
  it('flags a size-3-or-smaller parent selector even with no lucide import in the file', () => {
    const hits = matchIconSize(fx('className="[&>svg]:size-3!"'))
    expect(hits).toHaveLength(1)
    expect(hits[0].detail).toBe('parent selector size-3')
  })

  it('finds two genuine parent selectors on one line independently, and never crosses a newline into a later one', () => {
    const twoOnOneLine = matchIconSize(fx('className="[&>svg]:size-3 [&>svg]:size-2"'))
    expect(twoOnOneLine.map((h: { detail?: string }) => h.detail)).toEqual(['parent selector size-3', 'parent selector size-2'])

    const acrossLines = matchIconSize(fx('const a = "[&_svg]:opacity-50"\nconst b = "[&_svg]:size-3"'))
    expect(acrossLines).toHaveLength(1)
    expect(acrossLines[0].match).toBe('[&_svg]:size-3')
  })

  it('does not flag a parent selector at size-4 or larger', () => {
    expect(matchIconSize(fx('className="[&_svg]:size-4"'))).toHaveLength(0)
  })

  // Fix round (review I2, mirror bug): the same non-greedy-to-first-`>`
  // shape on the lucide tag regex missed a `className` written after an
  // arrow-function `onClick` -- so this genuine size-3 hazard reported
  // clean.
  it('still finds a size-3 className that follows an arrow-function onClick handler', () => {
    const src = `import { Check } from 'lucide-react'\nfunction C() { return <Check onClick={() => go()} className="size-3" /> }`
    expect(matchIconSize(fx(src))).toHaveLength(1)
  })
})

describe('matchMotionCss', () => {
  it('flags transition-all, ease-in and an animated dimension, never ease-in-out', () => {
    const hits = matchMotionCss(fx('className="transition-all ease-in ease-in-out transition-[width]"'))
    const details = hits.map((h: { detail?: string }) => h.detail)
    expect(details).toEqual(
      expect.arrayContaining(['transition: all', 'ease-in', 'animated width|height|top|left']),
    )
    expect(hits.some((h: { match: string }) => h.match === 'ease-in-out')).toBe(false)
  })

  it('flags a literal CSS transition-property and a multi-line gsap.to() config', () => {
    const css = 'const s = "transition-property: width; transition-duration: 200ms;"'
    expect(matchMotionCss(fx(css)).some((h: { detail?: string }) => h.detail === 'animated width|height|top|left')).toBe(true)
    const gsapCall = 'gsap.to(el, {\n  duration: 0.3,\n  width: 200,\n})'
    expect(matchMotionCss(fx(gsapCall)).some((h: { detail?: string }) => h.detail === 'animated width|height|top|left')).toBe(true)
  })

  it('never fires on a comment once comments are stripped (as the real-tree scan does)', () => {
    const source = "// No `ease-in` values in this table\n/* transition-all is banned here too */\nconst x = 1"
    expect(matchMotionCss(fx(stripComments(source)))).toHaveLength(0)
    // Unstripped, the same fixture *does* fire -- proves the assertion above
    // is exercising stripComments, not a coincidentally-lenient regex.
    expect(matchMotionCss(fx(source)).length).toBeGreaterThan(0)
  })
})

describe('stripComments', () => {
  it('blanks a line comment and a block comment, keeping every newline', () => {
    const source = 'const a = 1 // trailing\n/* block\n   spanning */\nconst b = 2'
    const stripped = stripComments(source)
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length)
    expect(stripped).not.toMatch(/trailing|block|spanning/)
    expect(stripped).toContain('const a = 1')
    expect(stripped).toContain('const b = 2')
  })

  it('leaves string and template literal content untouched', () => {
    const source = 'const a = "not // a comment"\nconst b = `also /* not */ a comment`'
    const stripped = stripComments(source)
    expect(stripped).toBe(source)
  })
})

describe('matchFilledButtonsPerRoute', () => {
  it('counts a bare <Button> and an explicit variant="default" as filled, not variant="outline"', () => {
    const src = '<Button>A</Button><Button variant="outline">B</Button><Button variant="default">C</Button>'
    const hits = matchFilledButtonsPerRoute(fx(src, 'page.tsx'))
    expect(hits).toHaveLength(1)
    expect(hits[0].match).toBe('2 filled-variant buttons')
  })

  it('counts a buttonVariants({ variant: "default" }) call site', () => {
    const src = "<Button variant=\"outline\">A</Button><a className={buttonVariants({ variant: 'default' })}>B</a>"
    // One filled-variant Button-shaped hit from buttonVariants alone is not
    // "more than one" -- needs a second filled site to become a violation.
    expect(matchFilledButtonsPerRoute(fx(src, 'page.tsx'))).toHaveLength(0)
    const two = src + "<a className={buttonVariants({ variant: 'default' })}>C</a>"
    expect(matchFilledButtonsPerRoute(fx(two, 'page.tsx'))).toHaveLength(1)
  })

  it('does not flag a route with at most one filled button', () => {
    const src = '<Button>Only one</Button><Button variant="outline">B</Button><Button variant="ghost">C</Button>'
    expect(matchFilledButtonsPerRoute(fx(src, 'page.tsx'))).toHaveLength(0)
  })

  // Fix round (review I2): `[\s\S]*?` used to be non-greedy to the *first*
  // `>`, and an `onClick={() => ...}` handler contains one -- so a `variant`
  // prop written after the handler was invisible and the button counted as
  // filled by luck. Two outline buttons, one with the handler first, must
  // both read as non-filled -- if either regresses this reports 2 filled.
  it('still reads a variant prop that follows an arrow-function handler', () => {
    const src =
      '<Button onClick={() => void loop.retry()} variant="outline">A</Button>' +
      '<Button onClick={() => void loop.next()} variant="ghost">B</Button>'
    expect(matchFilledButtonsPerRoute(fx(src, 'page.tsx'))).toHaveLength(0)
  })

  it('reorders to variant-before-handler and gets the same (correct) answer either way', () => {
    const reordered =
      '<Button variant="outline" onClick={() => void loop.retry()}>A</Button>' +
      '<Button variant="ghost" onClick={() => void loop.next()}>B</Button>'
    expect(matchFilledButtonsPerRoute(fx(reordered, 'page.tsx'))).toHaveLength(0)
  })
})

describe('matchFontWeightCounts', () => {
  it('counts font-normal and font-medium independently', () => {
    expect(matchFontWeightCounts(fx('className="font-normal font-medium font-medium"'))).toEqual({ normal: 1, medium: 2 })
  })
})

describe('matchWillChangeTransform', () => {
  it('flags both the CSS form and the camelCase JS style-object form', () => {
    const hits = matchWillChangeTransform(fx('const s = "will-change: transform"\nconst style = { willChange: "transform" }'))
    expect(hits).toHaveLength(2)
  })

  // Fix round (review C1): both original alternatives required a literal
  // `:`, so the idiomatic Tailwind utility (`will-change-transform`, a
  // hyphen) -- five real occurrences in this tree -- was invisible.
  it('flags the Tailwind utility form (a hyphen, never a colon)', () => {
    expect(matchWillChangeTransform(fx('className="absolute will-change-transform"'))).toHaveLength(1)
  })

  it('does not double-count a utility-form and CSS-form hit that both appear in one file', () => {
    const hits = matchWillChangeTransform(fx('className="will-change-transform"\nconst s = "will-change: transform"'))
    expect(hits).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 2. The real-tree gate
// ---------------------------------------------------------------------------

const KNOWN_OWNERSHIP_PREFIXES: Record<string, string> = {
  'src/components/lesson': 'T4.4',
  'src/app/(app)/lesson': 'T4.4',
  'src/components/shell': 'T4.5',
  'src/components/wellness': 'T4.5',
  'src/components/buddy': 'T4.5',
  'src/components/ui': 'T4.5',
  'src/app/(app)/account': 'T4.5',
  'src/components/account': 'T4.5',
  'src/app/(app)/dashboard': 'T4.6',
  'src/app/(app)/courses': 'T4.6',
  'src/app/(app)/course': 'T4.6',
  'src/components/course': 'T4.6',
  'src/app/(app)/exercise': 'T4.7',
  'src/components/exercise': 'T4.7',
  'src/app/(app)/derot': 'T4.8',
  'src/components/derot': 'T4.8',
  'src/components/rewards': 'T4.8',
  'src/components/play': 'T4.8',
  'src/app/(app)/reports': 'T4.9',
  'src/components/report': 'T4.9',
  'src/app/(auth)': 'T4.9',
  'src/app/(app)/onboarding': 'T4.9',
  'src/app/page.tsx': 'T4.9',
  // Fix round (review I3): carried debt with no Wave 4 owner, tracked under
  // the wave-review task rather than left unscoped and unallowlisted.
  'src/app/(admin)': 'T4.11',
  'src/components/admin': 'T4.11',
  'src/app/layout.tsx': 'T4.11',
  'src/app/error.tsx': 'T4.11',
}

function fileMatchesPrefix(file: string, pathPrefix: string): boolean {
  return file === pathPrefix || file.startsWith(`${pathPrefix}/`)
}

describe('allowlist hygiene (review requirement: no ownerless or invented entry)', () => {
  const allEntries: AllowlistEntry[] = Object.values(ALLOWLIST).flat()

  it('is not empty (there is real, tracked debt today)', () => {
    expect(allEntries.length).toBeGreaterThan(0)
  })

  it.each(allEntries)('%o names a real plan task and a real ownership-map prefix', (entry) => {
    expect(entry.owner).toMatch(/^T4\.\d+$/)
    expect(KNOWN_OWNERSHIP_PREFIXES[entry.pathPrefix]).toBe(entry.owner)
    expect(entry.note.length).toBeGreaterThan(0)
  })

  it('every ALLOWLIST key is a real rule id', () => {
    const ruleIds = new Set(RULES.map((r) => r.id))
    for (const key of Object.keys(ALLOWLIST)) expect(ruleIds.has(key)).toBe(true)
  })
})

describe('the real-tree gate: zero violations outside the allowlist', () => {
  for (const rule of RULES) {
    it(`${rule.id}: zero unallowlisted violations`, () => {
      const violations = rule.run() as { file: string; line: number; match: string }[]
      const entries = ALLOWLIST[rule.id] ?? []
      const unallowlisted = violations.filter((v) => !entries.some((e) => fileMatchesPrefix(v.file, e.pathPrefix)))
      expect(unallowlisted).toEqual([])
    })
  }
})

describe('the real-tree gate: single-number budgets', () => {
  // Fix round (review M2): the old assertion here (`owners.length` against a
  // hard-coded array literal) could never fail while its comment claimed it
  // "starts failing loudly the day the allowance should be deleted." Made
  // real: it now pins the ratio's actual known-bad state and breaks the day
  // that state changes.
  it('font-normal : font-medium is at least 1:3, or has not regressed below the recorded floor', () => {
    const ratio = ruleFontWeightRatio()
    const regressed = ratio.ratio !== null && ratio.ratio < FONT_WEIGHT_RATIO_ALLOWANCE.baselineRatio - 1e-9
    expect(regressed).toBe(false)
    expect(ratio.ok, 'ratio cleared 1:3; delete FONT_WEIGHT_RATIO_ALLOWANCE and this branch').toBe(false)
  })
})
