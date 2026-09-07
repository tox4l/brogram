#!/usr/bin/env node
// T4.1 -- the design-discipline gates (wave 4 spec docs/superpowers/specs/
// 2026-09-07-brogram-wave4-premium.md, section 10 family B; plan
// docs/superpowers/plans/2026-09-07-brogram-wave4-plan.md, task T4.1).
//
// A pure Node source scanner -- no CSS is ever regexed, only .ts/.tsx/.js/
// .jsx under src/. It reports six counted rules plus a weight ratio and two
// count-style gates, each with a file:line list, and exits 1 on any
// violation when run as a CLI (`npm run design:check`). Nothing here reads
// `.css` files: the whole discipline is a Tailwind-class-and-source
// discipline, not a stylesheet one, per the T4.1 review requirement.
//
// Every rule function is built on a pure matcher (`match*`) that takes
// `{ file, content }` entries so `src/lib/design/discipline.test.ts` can
// exercise exact match/no-match cases against tiny fixtures with no
// filesystem access, plus a `rule*` wrapper that scans the real tree via
// `scopeAppComponents`/`scopeAllSrc`. The CLI and the in-process Vitest gate
// both call the `rule*` wrappers so they can never disagree.
//
// This file is imported directly (not spawned) by discipline.test.ts -- it
// never runs its own main() unless invoked as `node
// scripts/check-design-tokens.mjs` from the command line, so importing it
// has no side effect (unlike scripts/verify-lesson.mjs, which is a CLI-only
// module by design).
//
// New rule? Extend the `RULES` array below with a `{ id, label, run }` entry
// and, if it is a violations-list rule, add its allowlist bucket in
// src/lib/design/allowlist.ts. That is the whole extension point.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SRC_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const ALWAYS_EXCLUDED_DIR_NAMES = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage'])

function toRelPath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

function isTestOrDeclarationFile(name) {
  return /\.(test|spec|stories)\.[cm]?[tj]sx?$/.test(name) || name.endsWith('.d.ts')
}

// Walks `dir` (an absolute path) for source files, skipping test/declaration
// files, `node_modules`-shaped noise, and any relative path under
// `excludeRelPrefixes` (e.g. 'src/app/preview' -- constraint 13: preview is
// excluded from every T4.1 rule "by name, not by accident").
function walkSourceFiles(dir, excludeRelPrefixes = []) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = toRelPath(full)
    if (excludeRelPrefixes.some((p) => rel === p || rel.startsWith(`${p}/`))) continue
    if (entry.isDirectory()) {
      if (ALWAYS_EXCLUDED_DIR_NAMES.has(entry.name)) continue
      out.push(...walkSourceFiles(full, excludeRelPrefixes))
    } else if (entry.isFile()) {
      if (!SRC_EXTENSIONS.has(path.extname(entry.name))) continue
      if (isTestOrDeclarationFile(entry.name)) continue
      if (OUT_OF_WAVE_EXACT_FILES.has(rel)) continue
      out.push(full)
    }
  }
  return out
}

// Blanks out `//` and `/* */` comments (same length, newlines kept, so line
// numbers computed against the result still line up with the real file) so
// a doc comment that *talks about* `ease-in` or `text-sm` -- exactly the
// kind of comment this file itself carries -- is never mistaken for a
// class or a value actually shipped. Strings and template literals are
// left untouched, because that is where the classNames this scanner cares
// about actually live. Not a real lexer (a `//` inside a regex literal, or
// a `${}` interpolation inside a template literal, are not modelled) --
// good enough for a source-discipline heuristic, not a compiler.
export function stripComments(source) {
  let out = ''
  let state = 'code'
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    const c2 = source[i + 1]
    if (state === 'code') {
      if (c === '/' && c2 === '/') {
        state = 'line-comment'
        out += '  '
        i++
        continue
      }
      if (c === '/' && c2 === '*') {
        state = 'block-comment'
        out += '  '
        i++
        continue
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c === "'" ? 'string-single' : c === '"' ? 'string-double' : 'template'
        out += c
        continue
      }
      out += c
      continue
    }
    if (state === 'line-comment') {
      if (c === '\n') {
        state = 'code'
        out += c
      } else {
        out += ' '
      }
      continue
    }
    if (state === 'block-comment') {
      if (c === '*' && c2 === '/') {
        state = 'code'
        out += '  '
        i++
      } else {
        out += c === '\n' ? '\n' : ' '
      }
      continue
    }
    // string-single / string-double / template
    const quote = state === 'string-single' ? "'" : state === 'string-double' ? '"' : '`'
    if (c === '\\' && i + 1 < source.length) {
      out += c + c2
      i++
      continue
    }
    out += c
    if (c === quote) state = 'code'
  }
  return out
}

function readEntries(files) {
  return files.map((file) => ({ file: toRelPath(file), content: stripComments(fs.readFileSync(file, 'utf8')) }))
}

// `(admin)` is not on any Wave 4 task's ownership row (plan section 4) and
// is not this wave's "five palettes, one structure" learner-facing surface
// -- nobody sweeps it this wave, so (unlike every owned screen) an
// allowlist entry against it could never name a task that clears it. Ruling
// (T4.1, no plan citation -- flagged in the T4.1 report for the owner):
// excluded from every rule's scope the same way preview is, by name.
//
// `src/app/layout.tsx` and `src/app/error.tsx` carry the same problem in
// miniature: `layout.tsx` is T4.0's file and T4.0 (tokens only) already
// landed without a footer sweep in its step list, and `error.tsx` is not on
// any row at all. Two lines of pre-existing debt (the footer credit's
// `text-sm`/`rounded-sm`, the error boundary's `text-3xl`) with no task
// positioned to clear them this wave -- same ruling, same reason, flagged
// the same way in the T4.1 report rather than silently allowlisted forever.
const OUT_OF_WAVE_REL_PREFIXES = ['src/app/preview', 'src/app/(admin)', 'src/components/admin']
const OUT_OF_WAVE_EXACT_FILES = new Set(['src/app/layout.tsx', 'src/app/error.tsx'])

// Rules 2-6 plus the ratio/count gates: every `src/app/**` and
// `src/components/**` file, out-of-wave surfaces always excluded.
// `excludeUi: true` additionally drops `src/components/ui/**` -- the type
// rule's own exclusion (plan T4.1 Step 1).
export function scopeAppComponents({ excludeUi = false } = {}) {
  const excludeRelPrefixes = [...OUT_OF_WAVE_REL_PREFIXES]
  if (excludeUi) excludeRelPrefixes.push('src/components/ui')
  return [
    ...walkSourceFiles(path.join(ROOT, 'src/app'), excludeRelPrefixes),
    ...walkSourceFiles(path.join(ROOT, 'src/components'), excludeRelPrefixes),
  ]
}

// Rule 6 (motion CSS): "anywhere in src/", out-of-wave surfaces still minus.
export function scopeAllSrc() {
  return walkSourceFiles(path.join(ROOT, 'src'), OUT_OF_WAVE_REL_PREFIXES)
}

// Binary-searchable line lookup built once per file instead of rescanning
// from index 0 for every match.
function buildLineIndex(content) {
  const offsets = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') offsets.push(i + 1)
  }
  return (index) => {
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function withGlobalFlag(re) {
  return re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`)
}

// Generic "every match of this regex is a violation" matcher, shared by the
// rules that need nothing beyond a hit (1, 2, 6 sub-patterns). `detail`, if
// given, is attached to every violation (used by rule 6 to say which of its
// three sub-patterns fired).
function matchEveryHit(entries, regex, detail) {
  const re = withGlobalFlag(regex)
  const violations = []
  for (const { file, content } of entries) {
    const lineOf = buildLineIndex(content)
    re.lastIndex = 0
    let m
    while ((m = re.exec(content))) {
      violations.push({ file, line: lineOf(m.index), match: m[0].trim(), ...(detail ? { detail } : {}) })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return violations
}

// --- Rule 1: raw type-scale classes -----------------------------------
// "506 today" per spec section 1.2 -- zero raw text-xs..4xl outside
// src/components/ui, src/app/preview excluded entirely.
const RAW_TEXT_SCALE_RE = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b/g

export function matchRawTextScale(entries) {
  return matchEveryHit(entries, RAW_TEXT_SCALE_RE)
}

export function ruleRawTextScale() {
  return matchRawTextScale(readEntries(scopeAppComponents({ excludeUi: true })))
}

// --- Rule 2: hard-coded Tailwind palette classes ------------------------
// "81 today" -- every hue Tailwind ships except the neutrals this app's
// tokens are built from (black/white are not Tailwind hue classes).
const PALETTE_CLASS_RE =
  /\b(text|bg|border|ring|from|to|via)-(emerald|slate|zinc|neutral|gray|red|amber|green|blue|cyan|violet|rose|orange|yellow|sky|indigo|teal|lime|fuchsia|pink|purple|stone)-\d{2,3}\b/g

export function matchPaletteClasses(entries) {
  return matchEveryHit(entries, PALETTE_CLASS_RE)
}

export function rulePaletteClasses() {
  return matchPaletteClasses(readEntries(scopeAppComponents()))
}

// --- Rule 3: spacing utilities outside the eight-step rhythm ------------
// `{1,2,3,4,6,8,12,16}` per the plan; `0` is a reset, not a step on the
// rhythm, and is allowed alongside it. Box-model utilities only (margin,
// padding, gap, space-between) -- width/height/size use a different scale
// (fractions, full, screen) and are out of this rule's scope by design.
const ALLOWED_SPACING_STEPS = new Set([0, 1, 2, 3, 4, 6, 8, 12, 16])
const SPACING_PREFIXES = ['gap-x', 'gap-y', 'gap', 'space-x', 'space-y', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'm', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'p']
const SPACING_RE = new RegExp(
  `(?<![\\w-])(-)?(${SPACING_PREFIXES.join('|')})-(\\[[^\\]]*\\]|\\d+(?:\\.\\d+)?)(?![\\w-])`,
  'g',
)

export function matchSpacingScale(entries) {
  const violations = []
  for (const { file, content } of entries) {
    const lineOf = buildLineIndex(content)
    SPACING_RE.lastIndex = 0
    let m
    while ((m = SPACING_RE.exec(content))) {
      const value = m[3]
      const isArbitrary = value.startsWith('[')
      const numeric = isArbitrary ? null : Number.parseFloat(value)
      const outsideRhythm = isArbitrary || !ALLOWED_SPACING_STEPS.has(numeric)
      if (outsideRhythm) violations.push({ file, line: lineOf(m.index), match: m[0] })
    }
  }
  return violations
}

export function ruleSpacingScale() {
  return matchSpacingScale(readEntries(scopeAppComponents()))
}

// --- Rule 4: radii outside rounded-(lg|xl|2xl|full) ---------------------
// A bare `rounded` (the Tailwind DEFAULT radius) and every named size
// outside the four licensed ones -- none, sm, md, 3xl -- are violations,
// on any side/corner variant (`rounded-t-*`, `rounded-tl-*`, ...).
const RADIUS_SIDES = ['tl', 'tr', 'br', 'bl', 'ss', 'se', 'es', 'ee', 't', 'r', 'b', 'l', 's', 'e']
const RADIUS_SIZES = ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']
const ALLOWED_RADIUS_SIZES = new Set(['lg', 'xl', '2xl', 'full'])
const RADIUS_RE = new RegExp(
  `(?<![\\w-])rounded(?:-(${RADIUS_SIDES.join('|')}))?(?:-(${RADIUS_SIZES.join('|')}))?(?![\\w-])`,
  'g',
)

export function matchRadii(entries) {
  const violations = []
  for (const { file, content } of entries) {
    const lineOf = buildLineIndex(content)
    RADIUS_RE.lastIndex = 0
    let m
    while ((m = RADIUS_RE.exec(content))) {
      const size = m[2]
      if (!size || !ALLOWED_RADIUS_SIZES.has(size)) {
        violations.push({ file, line: lineOf(m.index), match: m[0] })
      }
    }
  }
  return violations
}

export function ruleRadii() {
  return matchRadii(readEntries(scopeAppComponents()))
}

// --- Rule 5: size-3, size-3.5 or smaller on a lucide element ------------
// Reads each file's own `from 'lucide-react'` named imports (so a local
// component also called `Check` is never mistaken for the icon), then
// checks every JSX open tag for that name for a `size` prop below 16 (the
// numeric px prop) or a `size-*` Tailwind utility below `size-4`.
const LUCIDE_NAMED_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g
const ICON_SIZE_PROP_RE = /\bsize\s*=\s*\{?\s*["'`]?(\d+(?:\.\d+)?)["'`]?\s*\}?/
const ICON_SIZE_CLASS_RE = /\bsize-(0|0\.5|1|1\.5|2|2\.5|3|3\.5)\b/
const MIN_ICON_PX = 16

function getLucideIconNames(content) {
  const names = new Set()
  LUCIDE_NAMED_IMPORT_RE.lastIndex = 0
  let m
  while ((m = LUCIDE_NAMED_IMPORT_RE.exec(content))) {
    for (const raw of m[1].split(',')) {
      const piece = raw.trim()
      if (!piece) continue
      const asMatch = piece.match(/^(\w+)\s+as\s+(\w+)$/)
      names.add(asMatch ? asMatch[2] : piece)
    }
  }
  return names
}

export function matchIconSize(entries) {
  const violations = []
  for (const { file, content } of entries) {
    const icons = getLucideIconNames(content)
    if (icons.size === 0) continue
    const lineOf = buildLineIndex(content)
    const tagRe = new RegExp(`<(${[...icons].join('|')})\\b([\\s\\S]*?)(/>|>)`, 'g')
    let m
    while ((m = tagRe.exec(content))) {
      const attrs = m[2]
      const sizeProp = attrs.match(ICON_SIZE_PROP_RE)
      const sizeClass = attrs.match(ICON_SIZE_CLASS_RE)
      let detail = null
      if (sizeProp && Number.parseFloat(sizeProp[1]) < MIN_ICON_PX) detail = `size={${sizeProp[1]}}`
      else if (sizeClass) detail = sizeClass[0]
      if (detail) violations.push({ file, line: lineOf(m.index), match: `<${m[1]}>`, detail })
    }
  }
  return violations
}

export function ruleIconSize() {
  return matchIconSize(readEntries(scopeAppComponents()))
}

// --- Rule 6: transition: all, ease-in, animated width|height|top|left --
// Three sub-patterns sharing one rule id, "anywhere in src/" per the plan
// (a wider scope than rules 1-5: motion has no ui/preview carve-out).
// `ease-in-out` is deliberately not flagged -- it is a different, symmetric
// curve from the front-loaded `ease-in` v2 section 7.8 bans.
const MOTION_SUB_PATTERNS = [
  { detail: 'transition: all', re: /\btransition-all\b|transition\s*:\s*all\b/g },
  { detail: 'ease-in', re: /\bease-in\b(?!-out)/g },
  {
    // The CSS/Tailwind alternatives are bounded to a single line (`[^\n]`)
    // deliberately -- an unbounded `[^;]*` reads straight through a JS
    // object literal with no `;` terminator (e.g. a `motion/react`
    // `transition={{ delay, duration }}` prop) until it happens to meet one
    // of these words dozens of lines later, which is a false positive, not
    // a caught violation. The GSAP alternative allows up to 300 characters
    // (comfortably past any real tween config, from measurement) so a
    // multi-line `gsap.to(el, {\n  width: ...\n})` is still caught without
    // that same runaway risk.
    detail: 'animated width|height|top|left',
    re: /transition-\[[^\]\n]*\b(?:width|height|top|left)\b[^\]\n]*\]|transition(?:-property)?\s*:\s*[^;\n]*\b(?:width|height|top|left)\b|gsap\.(?:to|fromTo)\([\s\S]{0,300}?\b(?:width|height|top|left)\s*:/g,
  },
]

export function matchMotionCss(entries) {
  const violations = []
  for (const pattern of MOTION_SUB_PATTERNS) {
    violations.push(...matchEveryHit(entries, pattern.re, pattern.detail))
  }
  return violations
}

export function ruleMotionCss() {
  return matchMotionCss(readEntries(scopeAllSrc()))
}

// --- Step 2, ratio rule: font-normal : font-medium at least 1 : 3 -------
// "5 : 198 today". Emphasis only works if most text is not already bold.
const FONT_NORMAL_RE = /\bfont-normal\b/g
const FONT_MEDIUM_RE = /\bfont-medium\b/g

export function matchFontWeightCounts(entries) {
  let normal = 0
  let medium = 0
  for (const { content } of entries) {
    normal += (content.match(FONT_NORMAL_RE) || []).length
    medium += (content.match(FONT_MEDIUM_RE) || []).length
  }
  return { normal, medium }
}

export function ruleFontWeightRatio() {
  const { normal, medium } = matchFontWeightCounts(readEntries(scopeAppComponents()))
  const ratio = medium === 0 ? null : normal / medium
  const ok = medium === 0 ? normal === 0 : ratio >= 1 / 3
  return { normal, medium, ratio, ok }
}

// --- Step 2, count rule: at most one filled-variant Button per route ----
// "6 on /derot today". A "route file" is a Next.js App Router `page.tsx`.
// A <Button> with no `variant` prop is filled (shadcn's default variant is
// `"default"`), as is one with an explicit `variant="default"`, as is a
// `buttonVariants({ variant: 'default' })` call (the `<Link>` pattern).
// Caveat: this is a static source count. A single filled-variant call site
// that renders once per item inside a `.map()` (BroGram's actual /derot
// shape) counts once here, not once per rendered card -- see the T4.1
// report for why a source scanner cannot see the runtime multiplication,
// and why that does not excuse the rule (T4.8 still owns fixing the markup
// itself, not the count).
const BUTTON_TAG_RE = /<Button\b([\s\S]*?)(\/>|>)/g
const VARIANT_ANY_PROP_RE = /\bvariant\s*=/
const VARIANT_DEFAULT_PROP_RE = /variant\s*=\s*\{?\s*["'`]default["'`]\s*\}?/
const BUTTON_VARIANTS_DEFAULT_RE = /buttonVariants\(\s*\{[^}]*variant\s*:\s*['"]default['"][^}]*\}\s*\)/g

export function matchFilledButtonsPerRoute(entries) {
  const violations = []
  for (const { file, content } of entries) {
    const lineOf = buildLineIndex(content)
    let count = 0
    const lines = []
    BUTTON_TAG_RE.lastIndex = 0
    let m
    while ((m = BUTTON_TAG_RE.exec(content))) {
      const attrs = m[1]
      const isFilled = !VARIANT_ANY_PROP_RE.test(attrs) || VARIANT_DEFAULT_PROP_RE.test(attrs)
      if (isFilled) {
        count++
        lines.push(lineOf(m.index))
      }
    }
    BUTTON_VARIANTS_DEFAULT_RE.lastIndex = 0
    while ((m = BUTTON_VARIANTS_DEFAULT_RE.exec(content))) {
      count++
      lines.push(lineOf(m.index))
    }
    if (count > 1) violations.push({ file, line: lines[0], match: `${count} filled-variant buttons`, detail: `lines ${lines.join(', ')}` })
  }
  return violations
}

export function ruleFilledButtonsPerRoute() {
  const routeFiles = scopeAppComponents().filter((f) => path.basename(f) === 'page.tsx')
  return matchFilledButtonsPerRoute(readEntries(routeFiles))
}

// --- Step 2, count rule: will-change: transform in at most 3 selectors -
const WILL_CHANGE_TRANSFORM_RE = /will-change\s*:\s*transform\b|willChange\s*:\s*['"]transform['"]/g

export function matchWillChangeTransform(entries) {
  return matchEveryHit(entries, WILL_CHANGE_TRANSFORM_RE)
}

export function ruleWillChangeBudget() {
  const occurrences = matchWillChangeTransform(readEntries(scopeAllSrc()))
  return { count: occurrences.length, occurrences, ok: occurrences.length <= 3 }
}

// --- The registry ---------------------------------------------------------
// Every entry here is a "gate to zero (outside the allowlist)" rule; the
// ratio and will-change budgets are single-number gates and are reported
// separately (see printReport) because "zero violations" is not their shape.
export const RULES = [
  { id: 'raw-text-scale', label: 'Raw type-scale classes (text-xs..4xl) outside src/components/ui', run: ruleRawTextScale },
  { id: 'palette-classes', label: 'Hard-coded Tailwind palette classes', run: rulePaletteClasses },
  { id: 'spacing-scale', label: 'Spacing utilities outside the {0,1,2,3,4,6,8,12,16} rhythm', run: ruleSpacingScale },
  { id: 'radii', label: 'Radii outside rounded-(lg|xl|2xl|full)', run: ruleRadii },
  { id: 'icon-size', label: 'Lucide icons at size-3/size-3.5 or smaller', run: ruleIconSize },
  { id: 'motion-css', label: 'transition: all, ease-in, or animated width|height|top|left', run: ruleMotionCss },
  { id: 'filled-buttons-per-route', label: 'More than one filled-variant Button per route file', run: ruleFilledButtonsPerRoute },
]

function printReport() {
  let anyViolation = false
  console.log('BroGram design-discipline scan (wave 4 spec section 10 family B)\n')
  for (const rule of RULES) {
    const violations = rule.run()
    if (violations.length > 0) anyViolation = true
    console.log(`${rule.id}: ${violations.length} violation(s) -- ${rule.label}`)
    for (const v of violations) {
      const detail = v.detail ? ` (${v.detail})` : ''
      console.log(`  ${v.file}:${v.line}  ${v.match}${detail}`)
    }
  }

  const ratio = ruleFontWeightRatio()
  console.log(
    `\nfont-weight-ratio: font-normal=${ratio.normal} font-medium=${ratio.medium} ` +
      `ratio=${ratio.ratio === null ? 'n/a' : ratio.ratio.toFixed(3)} (need >= 0.333) -- ${ratio.ok ? 'OK' : 'VIOLATION'}`,
  )
  if (!ratio.ok) anyViolation = true

  const willChange = ruleWillChangeBudget()
  console.log(`will-change-transform-budget: ${willChange.count} occurrence(s) (max 3) -- ${willChange.ok ? 'OK' : 'VIOLATION'}`)
  for (const o of willChange.occurrences) console.log(`  ${o.file}:${o.line}`)
  if (!willChange.ok) anyViolation = true

  return anyViolation
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMainModule) {
  const failed = printReport()
  process.exit(failed ? 1 : 0)
}
