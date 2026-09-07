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
// zod schemas, the barrel `index.ts`, ...) is server-only and must never be
// imported, at runtime, from a client module.
//
// Fix round (W4FIX-B2 re-check, F2): the first version of this guard only
// scanned `src/components/buddy/**`, only matched a leading `import`, and
// only matched the `@/`-aliased specifier -- four planted regressions all
// stayed green: a re-export (`export { X } from '@/lib/agents/buddy'`,
// which is literally the shape of the bug this guard exists to catch), the
// barrel import (`import { modules } from '@/lib/agents'` -- no slash after
// `agents`, so the old alias-only regex never matched it even though the
// guard's own comment claimed it was covered), a relative specifier
// (`'../../lib/agents/buddy'`), and a client module one directory outside
// `src/components/buddy/**` (`src/components/shell/BuddyButton.tsx`). Fixed
// by: (a) scanning every non-test `.ts(x)` file under `src/components/**`,
// `src/hooks/**` and `src/store/**`, plus any file anywhere under `src`
// that opens with a `'use client'` directive -- not only the buddy folder;
// (b) matching `import` OR `export` (a re-export needs no `import` at all);
// (c) a specifier pattern that covers the bare barrel (`@/lib/agents` with
// no trailing segment), every non-`client` subpath of it, and the relative
// equivalent of both.
describe('no client module imports zod or a zod-bearing agent module (W4FIX-B2)', () => {
  const ROOT = path.resolve(__dirname, '..', '..', '..')
  const SRC = path.join(ROOT, 'src')
  const BUDDY_DIR = path.join(SRC, 'components', 'buddy')

  // Directories where every file is a client module by construction
  // (components, hooks and client-side store slices never run on the
  // server in this codebase). Anything outside these still gets scanned if
  // its own first line opens with `'use client'`.
  const CLIENT_MODULE_DIRS = ['components', 'hooks', 'store'].map((d) => path.join(SRC, d))

  const USE_CLIENT_DIRECTIVE = /^\s*['"]use client['"]/

  // A leading-anchored `import ... from '<module>'` OR a re-export
  // (`export ... from '<module>'`), tolerant of a multi-line named-import
  // list (a plain `[^\n]*` cannot cross a newline -- the same gap the
  // W4FIX-B re-check's N1 found in the gsap guard) but never crossing a
  // quote, backtick or semicolon: `[\s\S]*?` alone (N1's own suggested fix)
  // is too permissive on THIS file specifically -- its own doc comment
  // quotes forbidden import strings as code samples, and a lazy `[\s\S]*?`
  // happily reads straight through the real imports' own closing quotes to
  // land on a comment's quoted example instead. Excluding those three
  // characters still lets the class span newlines (a real multi-line import
  // or export list has none of them before its own `from`) while making it
  // structurally impossible to wander into -- or across -- any string
  // literal, quoted or templated.
  const STATIC_IMPORT_OR_EXPORT_FROM = (specifier: RegExp, { allowTypeOnly }: { allowTypeOnly: boolean }) => {
    // `(?!type\s)` right after the mandatory space excludes `import type
    // {...} from '...'` / `export type {...} from '...'` -- the ONLY way to
    // exclude it, since the flexible "anything but a quote before from"
    // group below would otherwise happily swallow the word `type` too and
    // match it regardless of this guard's presence.
    const excludeTypeOnly = allowTypeOnly ? '' : '(?!type\\s)'
    return new RegExp(
      `^\\s*(?:import|export)\\s${excludeTypeOnly}(?:[^'"\`;]*?from\\s*)?['"](${specifier.source})['"]`,
      'm',
    )
  }

  // `zod` itself has no legitimate type-only reason to be imported from a
  // client module at all, so this pattern keeps flagging `import type`.
  const ZOD_IMPORT = STATIC_IMPORT_OR_EXPORT_FROM(/zod(\/.*)?/, { allowTypeOnly: true })
  // Every `@/lib/agents/*` specifier except the client-safe door
  // (`@/lib/agents/client`), including the bare barrel (`@/lib/agents`
  // itself, which re-exports every schema-bearing module) and the relative
  // equivalent of both forms. Type-only imports from an agent module are
  // deliberately exempt (M5, W4FIX-B2 re-check): `import type { AgentEnvelope }
  // from '@/lib/agents/shared'` erases to zero bytes at compile time --
  // TypeScript strips it entirely -- so it is not the leak this guard
  // exists to catch, and flagging it would read as a guard bug rather than
  // a deliberate rule.
  const AGENT_SCHEMA_MODULE = STATIC_IMPORT_OR_EXPORT_FROM(
    /(?:@\/lib\/agents(?:\/(?!client['"])[^'"]*)?|(?:\.\.?\/)+(?:[^'"]*\/)?lib\/agents(?:\/[^'"]*)?)/,
    { allowTypeOnly: false },
  )

  function isClientModule(file: string, content: string): boolean {
    if (CLIENT_MODULE_DIRS.some((dir) => file.startsWith(dir + path.sep))) return true
    return USE_CLIENT_DIRECTIVE.test(content)
  }

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

  it('no client module anywhere under src imports zod or a zod-bearing agent module', () => {
    const offenders: string[] = []
    for (const file of tsFilesRecursive(SRC)) {
      const content = fs.readFileSync(file, 'utf8')
      if (!isClientModule(file, content)) continue
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (ZOD_IMPORT.test(content) || AGENT_SCHEMA_MODULE.test(content)) offenders.push(rel)
    }
    expect(
      offenders,
      `${offenders.join(', ')} must reach the agent route only through src/lib/agents/client.ts -- importing from a schema module (or zod itself), whether by import, re-export, the bare barrel, or a relative path, puts zod on every route that renders it`,
    ).toEqual([])
  })

  it('src/lib/agents/client.ts itself, the one door to /api/agent, imports no zod', () => {
    const content = fs.readFileSync(path.join(SRC, 'lib', 'agents', 'client.ts'), 'utf8')
    expect(ZOD_IMPORT.test(content)).toBe(false)
  })

  it('every module under src/components/buddy/** is still covered by the broader scan above', () => {
    // Belt and suspenders: the buddy drawer is the module this whole guard
    // exists for. Confirms tsFilesRecursive(SRC) actually reaches it rather
    // than, say, a stale exclude pattern silently skipping the directory.
    const buddyFiles = tsFilesRecursive(BUDDY_DIR)
    expect(buddyFiles.length).toBeGreaterThan(0)
    expect(buddyFiles.every((f) => isClientModule(f, fs.readFileSync(f, 'utf8')))).toBe(true)
  })

  describe('regex fixtures (F2): the four planted regressions that evaded the pre-fix-round guard', () => {
    it('flags a re-export -- the exact shape of the original bug', () => {
      const planted = `export { REFUSAL as X } from '@/lib/agents/buddy'\n`
      expect(AGENT_SCHEMA_MODULE.test(planted)).toBe(true)
    })

    it('flags the bare barrel import (no slash after "agents")', () => {
      const planted = `import { modules } from '@/lib/agents'\n`
      expect(AGENT_SCHEMA_MODULE.test(planted)).toBe(true)
    })

    it('flags a relative-path specifier', () => {
      const planted = `import { REFUSAL } from '../../lib/agents/buddy'\n`
      expect(AGENT_SCHEMA_MODULE.test(planted)).toBe(true)
    })

    it('flags an offending import regardless of which directory the file lives in (scan coverage, not regex shape)', () => {
      // src/components/shell/BuddyButton.tsx is one directory outside
      // src/components/buddy/** but is still under src/components/**, so
      // isClientModule() must call it a client module.
      const file = path.join(SRC, 'components', 'shell', 'BuddyButton.tsx')
      expect(isClientModule(file, fs.readFileSync(file, 'utf8'))).toBe(true)
    })

    it('does not flag the allowed door, aliased or with a trailing slash-free specifier', () => {
      const allowed = `import { callAgent } from '@/lib/agents/client'\n`
      expect(AGENT_SCHEMA_MODULE.test(allowed)).toBe(false)
    })

    it('does not flag a type-only import from an agent module (erases to zero bytes)', () => {
      const typeOnly = `import type { AgentEnvelope } from '@/lib/agents/shared'\n`
      expect(AGENT_SCHEMA_MODULE.test(typeOnly)).toBe(false)
    })
  })
})
