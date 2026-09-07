'use client'

import dynamic from 'next/dynamic'

/**
 * Step 2: the editor is lazy and single-grammar. `next/dynamic({ ssr: false
 * })` keeps the Editor chunk (CodeMirror core plus its React glue) off the
 * walkthrough's initial bundle -- it downloads only once a block actually
 * needs it (a runnable snippet or a `micro-code` check), never on a lesson
 * that has neither.
 *
 * "Single-grammar" is a bundling property, not a runtime one, and it lives in
 * `Editor.tsx` itself (fix round 1): `src/components/exercise/grammars.ts`
 * loads exactly one `@codemirror/lang-*` package per `language`, on demand,
 * cached per language for the session -- Editor no longer statically imports
 * all five grammars (the ~662 KB set the brief names), so a Python lesson
 * downloads only the Python grammar. Each `Editor` instance (one per block
 * that needs one) loads the grammar for *its own* `language` prop, which is
 * why a `mongo` `micro-code` check inside a `sql` course (`INFS2201-5`)
 * correctly loads the mongo grammar rather than the lesson's sql one.
 */
export const DynamicEditor = dynamic(
  () => import('@/components/exercise/Editor').then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => <div aria-hidden="true" className="h-40 w-full animate-pulse rounded-b-xl bg-muted/40" />,
  },
)
