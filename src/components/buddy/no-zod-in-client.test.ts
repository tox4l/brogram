import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// W4FIX-B2: the bundle lane's review found `state.ts` importing `REFUSAL`
// from `@/lib/agents/buddy` -- a plain, non-type-only import that dragged
// zod 4 plus every agent schema into the Buddy drawer's own module graph,
// and since the drawer mounts on every authenticated route this put that
// ~366 KB on every route's entry chunk whether or not the drawer was ever
// opened. Nothing in the existing suite fails if that import comes back:
// `state.test.ts`/`Drawer.test.tsx` mock React Query and Supabase, never
// the import graph itself. This is the regression guard, in the same
// source-scan shape as `eases.test.ts`'s gsap guard (W4FIX-B).
//
// The client talks to the agent route through `src/lib/agents/client.ts`
// (a thin, schema-free fetch wrapper) -- the only door from a client module
// into `/api/agent` this lane's ruling allows. Everything else under
// `src/lib/agents/` (`shared.ts`, `buddy.ts`, `coach.ts`, `prompts`, the
// zod schemas, ...) is server-only and must never be imported, at runtime,
// from a client module.
describe('the Buddy drawer imports no zod, directly or through an agent schema module (W4FIX-B2)', () => {
  const ROOT = path.resolve(__dirname, '..', '..', '..')
  const SRC = path.join(ROOT, 'src')
  const BUDDY_DIR = path.join(SRC, 'components', 'buddy')

  // A leading-anchored `import ... from '<module>'`, tolerant of a
  // multi-line named-import list (a plain `[^\n]*` cannot cross a newline --
  // the same gap the W4FIX-B re-check's N1 found in the gsap guard) but
  // never crossing a quote, backtick or semicolon: `[\s\S]*?` alone (N1's
  // own suggested fix) is too permissive on THIS file specifically -- its
  // own doc comment quotes the very import string this guard exists to
  // forbid, as a code sample, and a lazy `[\s\S]*?` happily reads straight
  // through the real imports' own closing quotes to land on that comment's
  // quoted example instead. Excluding those three characters still lets the
  // class span newlines (a real multi-line import list has none of them
  // before its own `from`) while making it structurally impossible to
  // wander into -- or across -- any string literal, quoted or templated.
  const STATIC_IMPORT_FROM = (specifier: RegExp) =>
    new RegExp(`^\\s*import\\s(?:type\\s)?(?:[^'"\`;]*?from\\s*)?['"](${specifier.source})['"]`, 'm')

  const ZOD_IMPORT = STATIC_IMPORT_FROM(/zod(\/.*)?/)
  // Every `src/lib/agents/*` module except the client-safe ones: `client.ts`
  // (the allowed door) and `index.ts`'s own re-export of every agent module
  // (schema-bearing by construction) is deliberately included as an
  // offender, not exempted.
  const AGENT_SCHEMA_MODULE = STATIC_IMPORT_FROM(/@\/lib\/agents\/(?!client)[^'"]*/)

  function tsFilesRecursive(dir: string): string[] {
    const files: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...tsFilesRecursive(full))
        continue
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue
      files.push(full)
    }
    return files
  }

  it('no module under src/components/buddy/** imports zod or a zod-bearing agent module', () => {
    const offenders: string[] = []
    for (const file of tsFilesRecursive(BUDDY_DIR)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      const content = fs.readFileSync(file, 'utf8')
      if (ZOD_IMPORT.test(content) || AGENT_SCHEMA_MODULE.test(content)) offenders.push(rel)
    }
    expect(
      offenders,
      `${offenders.join(', ')} must reach the agent route only through src/lib/agents/client.ts -- importing from a schema module (or zod itself) puts zod on every authenticated route's entry chunk`,
    ).toEqual([])
  })

  it("src/lib/agents/client.ts itself, the drawer's one door to /api/agent, imports no zod", () => {
    const content = fs.readFileSync(path.join(SRC, 'lib', 'agents', 'client.ts'), 'utf8')
    expect(ZOD_IMPORT.test(content)).toBe(false)
  })
})
