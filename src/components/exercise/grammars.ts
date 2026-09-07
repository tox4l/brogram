import type { Extension } from '@codemirror/state'
import type { Language } from '@/lib/contracts'

/**
 * One CodeMirror grammar per language, loaded on demand. `Editor.tsx`
 * previously imported every `@codemirror/lang-*` package statically, which
 * put all five grammar tables (Python, JS/TS, HTML, SQL, Java -- ~662 KB) in
 * one chunk regardless of which single language a given screen actually
 * uses. A walkthrough showing one Python snippet has no reason to also
 * download Java and SQL parser tables, and neither does an exercise.
 *
 * Loaders are keyed by `Language`, not by the document a particular `Editor`
 * happens to be mounted for, so two `Editor` instances on the same lesson
 * with different `language` values (e.g. a `mongo` `micro-code` check inside
 * a `sql` course, `INFS2201-5`) each load exactly the grammar they need --
 * never the lesson's language for every block. The promise cache means a
 * language already loaded once in this session (e.g. two Python blocks) is
 * never re-fetched.
 */
const loaders: Record<Language, () => Promise<Extension>> = {
  python: async () => (await import('@codemirror/lang-python')).python(),
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  mongo: async () => (await import('@codemirror/lang-javascript')).javascript(),
  web: async () => (await import('@codemirror/lang-html')).html(),
  sql: async () => {
    const mod = await import('@codemirror/lang-sql')
    return mod.sql({ dialect: mod.SQLite })
  },
  java: async () => (await import('@codemirror/lang-java')).java(),
}

const cache = new Map<Language, Promise<Extension>>()

/** Plain-text (no extension) until this resolves -- there is no separate
 *  "fallback" object to configure, an empty language compartment already
 *  renders as plain text. */
export function loadLanguageExtension(language: Language): Promise<Extension> {
  let promise = cache.get(language)
  if (!promise) {
    promise = loaders[language]()
    cache.set(language, promise)
  }
  return promise
}
