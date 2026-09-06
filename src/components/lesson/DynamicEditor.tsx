'use client'

import dynamic from 'next/dynamic'

/**
 * Step 2: the editor is lazy and single-grammar. `next/dynamic({ ssr: false
 * })` keeps the whole Editor chunk (CodeMirror core plus every
 * `@codemirror/lang-*` package it imports) off the walkthrough's initial
 * bundle -- it downloads only once a block actually needs it (a runnable
 * snippet or a `micro-code` check), never on a lesson that has neither.
 * "Single-grammar" is a runtime property of `Editor` itself: a lesson has
 * exactly one `language` for the whole document, so every block that reaches
 * for this component configures the same one CodeMirror language
 * compartment (see `Editor`'s own `languageExtension` switch) -- never two
 * grammars active for one walkthrough.
 */
export const DynamicEditor = dynamic(
  () => import('@/components/exercise/Editor').then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => <div aria-hidden="true" className="h-40 w-full animate-pulse rounded-b-xl bg-muted/40" />,
  },
)
