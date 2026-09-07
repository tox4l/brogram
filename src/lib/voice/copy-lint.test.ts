// T2.7b Step 4: the repo-wide guard against exactly the regression the
// copy sweep just fixed by hand. This is deliberately a source-text regex
// scan, the same shape `src/lib/theme/dark-variant.test.ts` and
// `src/lib/curriculum/secrets.test.ts` already use for a repo-wide guard,
// rather than a full TSX/AST parse -- good enough to catch a real
// regression, cheap enough to run on every commit.
//
// Three checks, each named by the voice rules this bank already enforces on
// its own content (`lines.test.ts` rules 3 and 4): no shipped screen may
// open a sentence with "Your ", show an emoji, or use a literal double
// hyphen where the bank itself always uses a real em dash.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
// V5 (Wave 2 review §5): the original scope was `app`/`components` only,
// which is where a screen's own copy lives, but a fallback string built in
// `src/lib` (or `src/hooks`/`src/store`) can still reach a learner once a
// screen persists and re-renders it — exactly what happened with the
// Planner's `focus` fallback. Widened to catch that class of bug too.
const SCAN_ROOTS = [join(SRC_DIR, 'app'), join(SRC_DIR, 'components'), join(SRC_DIR, 'lib'), join(SRC_DIR, 'hooks'), join(SRC_DIR, 'store')]

// `src/app/api/**` is server route handlers (agent prompts, JSON responses)
// -- never a screen a learner opens, and `src/app/api/agent/route.ts` in
// particular carries a legitimate "Your previous reply failed validation…"
// retry prompt sent to the model, not to a learner. Test files are excluded
// too: fixture data and assertions like `not.toMatch(/^Your /)` are not
// shipped copy. `src/lib/voice/lines.ts` is the bank itself -- every
// `LineKey` variant, deliberately negative or not, lives there, so scanning
// it would just re-litigate content this file is not the place to police.
function shouldSkip(path: string): boolean {
  const normalized = path.split('\\').join('/')
  if (normalized.includes('/app/api/')) return true
  if (/\.test\.tsx?$/.test(normalized)) return true
  if (normalized.endsWith('/lib/voice/lines.ts')) return true
  return false
}

/**
 * Known, already-triaged violations under the widened scope (V5, Wave 2
 * review §5), each mapped to the *one* rule it trips rather than blanket-
 * skipping the file: a later edit that adds an unrelated violation (an
 * emoji, a literal " -- ") to an allowlisted file must still be caught by
 * this lint, not hidden behind the allowlist meant for a different string.
 *   - `src/lib/runtimes/java-structure.ts:304` (dated 2026-09-06, owner:
 *     W2FIX-F1 / the runtimes owner) -- not owned by any lane with the
 *     paths to fix it; also unreachable today per the review (`parser.parse`
 *     only returns null on a cancelled parse, and no caller passes a timeout
 *     or progress callback), so it is a live string with no live path to a
 *     learner right now, not an urgent fix.
 * Remove an entry only in the same commit that fixes its string (and its
 * paired test, where one exists).
 */
const KNOWN_VIOLATIONS = new Map<string, string>([
  [join(SRC_DIR, 'lib', 'runtimes', 'java-structure.ts'), 'opens with "Your "'],
])

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name) && !shouldSkip(full)) out.push(full)
  }
}

function sourceFiles(): string[] {
  const files: string[] = []
  for (const root of SCAN_ROOTS) walk(root, files)
  return files
}

/** Strips both comment forms (a JSX comment is a block comment like any
 *  other) so a violation quoted or explained in a comment -- exactly what
 *  several fix-round doc comments in this sweep do -- is never mistaken for
 *  a live one. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const EMOJI = /\p{Extended_Pictographic}/u
// A real em dash (—, one character) is how the bank and this sweep write a
// break in a sentence; a literal double hyphen is banned. Requiring a space
// on both sides is what tells a prose dash apart from a CSS custom property
// (`var(--foo)`, `[--card-spacing:…]`, never preceded by a space) and a
// `for`-loop decrement (`i--`, never followed by one).
const DOUBLE_DASH = / -- /
// A JSX text node opening with "Your " — the `>` that closes the previous
// tag, then only whitespace before the word. `\s*` only ever consumes literal
// whitespace, so this cannot run away across the rest of the file.
const JSX_TEXT_YOUR_OPENER = />\s*Your /
// A quoted string literal (single, double, or template) whose content opens
// with "Your " — covers a plain JSX attribute (`aria-label="Your work"`) and
// a bare literal (`'Your path'`) alike.
const STRING_YOUR_OPENER = /(['"`])Your (?:(?!\1)[\s\S])*?\1/

interface Hit {
  file: string
  rule: string
  sample: string
}

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const file of sourceFiles()) {
    const allowedRule = KNOWN_VIOLATIONS.get(file)
    const stripped = stripComments(readFileSync(file, 'utf8'))
    const fileHits: Hit[] = []
    const emojiMatch = EMOJI.exec(stripped)
    if (emojiMatch) fileHits.push({ file, rule: 'emoji', sample: emojiMatch[0] })
    const dashMatch = DOUBLE_DASH.exec(stripped)
    if (dashMatch) fileHits.push({ file, rule: 'double dash', sample: dashMatch[0] })
    const jsxYourMatch = JSX_TEXT_YOUR_OPENER.exec(stripped)
    if (jsxYourMatch) fileHits.push({ file, rule: 'opens with "Your "', sample: jsxYourMatch[0] })
    const stringYourMatch = STRING_YOUR_OPENER.exec(stripped)
    if (stringYourMatch) fileHits.push({ file, rule: 'opens with "Your "', sample: stringYourMatch[0] })
    // Only the one allowlisted rule for this file is suppressed -- every
    // other rule still reports normally, so a new, unrelated violation in an
    // allowlisted file is never silently missed (F3, review round 2).
    for (const hit of fileHits) if (hit.rule !== allowedRule) hits.push(hit)
  }
  return hits
}

describe('repo-wide copy lint (T2.7b step 4, widened per V5)', () => {
  it('finds source files to scan under src/app, src/components, src/lib, src/hooks and src/store (sanity: this guard is testing something real)', () => {
    expect(sourceFiles().length).toBeGreaterThan(100)
  })

  it('never lets a screen open a sentence with "Your ", show an emoji, or use a literal double hyphen', () => {
    const hits = scan()
    const report = hits.map((hit) => `${hit.file} [${hit.rule}]: ${JSON.stringify(hit.sample)}`).join('\n')
    expect(hits, `copy violations found:\n${report}`).toEqual([])
  })

  it('KNOWN_VIOLATIONS stays exactly as large as the set of real, currently-unfixable violations, and each entry still trips exactly the rule it is mapped to (trip-wire: fix the string and shrink this list together)', () => {
    for (const [file, rule] of KNOWN_VIOLATIONS) {
      const stripped = stripComments(readFileSync(file, 'utf8'))
      const tripped = new Set<string>()
      if (STRING_YOUR_OPENER.test(stripped) || JSX_TEXT_YOUR_OPENER.test(stripped)) tripped.add('opens with "Your "')
      if (EMOJI.test(stripped)) tripped.add('emoji')
      if (DOUBLE_DASH.test(stripped)) tripped.add('double dash')
      expect(tripped.has(rule), `${file} no longer trips "${rule}" -- remove it from KNOWN_VIOLATIONS`).toBe(true)
    }
  })
})
