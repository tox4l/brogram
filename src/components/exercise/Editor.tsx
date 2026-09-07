'use client'

import type { IntegrityEventType, Language } from '@/lib/contracts'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { loadLanguageExtension } from './grammars'
import type { Focusable } from './LockdownOverlay'

export interface EditorProps {
  value: string
  onChange: (value: string) => void
  language: Language
  logIntegrity: (type: IntegrityEventType) => void
  disabled?: boolean
  label?: string
  /**
   * Fix round 3: a shared ref this component populates with an imperative `focus()` once its
   * CodeMirror view exists, so a caller elsewhere -- `page.tsx`, into `LockdownOverlay`'s own
   * `returnFocusRef` (T2.8) -- can return keyboard focus here once the lockdown overlay lifts
   * or the paste "why" panel closes. A plain prop rather than React's `ref`: this component is
   * wrapped in `next/dynamic` at the call site, whose loadable wrapper is not itself
   * `forwardRef`-aware, so an actual `ref` prop would never reach the CodeMirror view.
   */
  focusRef?: RefObject<Focusable | null>
}

// T4.7 / spec 2.6 & 3.4: the editor's own surface is `--lesson-code-surface` (the ground
// `contrast.test.ts` actually checks the nine `--code-*` tokens against), not the app's
// `--background` -- the token names predate this wave wiring the exercise editor to them, but
// the surface is the same "wherever code renders" bundle Lesson blocks already sit on. Ruling
// W4.12: `liga 0, calt 0` on `.cm-scroller` so `!=`/`=>` never render as a ligature glyph that
// is not on the learner's own keyboard.
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--lesson-code-surface)', color: 'var(--code-variable)', fontSize: '14px' },
  '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', minHeight: '360px', maxHeight: 'calc(100dvh - 18rem)', overflow: 'auto', fontFeatureSettings: "'liga' 0, 'calt' 0" },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--code-variable)' },
  '.cm-line': { padding: '0 16px' },
  '.cm-gutters': { backgroundColor: 'var(--lesson-code-surface)', color: 'var(--code-comment)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--muted)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-variable)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--accent)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', borderColor: 'var(--border)' },
}, { dark: true })

/**
 * T4.7 / spec 2.6: the nine `--code-*` tokens ship as one `HighlightStyle.define()` mapping
 * `@lezer/highlight` tags -- one style, five palettes (every value is a CSS custom property
 * that resolves per `[data-theme]`), no per-theme JavaScript and no component branching on
 * which theme is active. Exported (not just used inline) so a unit test can pin the tag -> token
 * mapping without rendering a real CodeMirror view. `tags.invalid` maps to `--destructive`,
 * the one entry that is not a `--code-*` token, per the spec's own table.
 */
export const CODE_HIGHLIGHT_SPECS = [
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword], color: 'var(--code-keyword)' },
  { tag: [tags.string, tags.character], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--code-comment)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: [tags.typeName, tags.className], color: 'var(--code-type)' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--code-variable)' },
  { tag: tags.operator, color: 'var(--code-operator)' },
  { tag: [tags.punctuation, tags.bracket], color: 'var(--code-punct)' },
  { tag: tags.invalid, color: 'var(--destructive)' },
]

const codeHighlightStyle = HighlightStyle.define(CODE_HIGHLIGHT_SPECS)

export function Editor({ value, onChange, language, logIntegrity, disabled = false, label = 'Code editor', focusRef }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, logIntegrity })
  const replacing = useRef(false)
  const compartments = useMemo(() => ({ language: new Compartment(), editable: new Compartment(), label: new Compartment() }), [])

  useEffect(() => { callbacks.current = { onChange, logIntegrity } }, [onChange, logIntegrity])

  useEffect(() => {
    if (!host.current) return
    const block = (event: Event, type: IntegrityEventType) => {
      event.preventDefault()
      callbacks.current.logIntegrity(type)
      return true
    }
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({ extensions: [
        basicSetup,
        theme,
        syntaxHighlighting(codeHighlightStyle),
        compartments.language.of([]),
        compartments.editable.of([]),
        compartments.label.of([]),
        Prec.highest(EditorView.domEventHandlers({
          paste: event => block(event, 'paste-blocked'),
          copy: event => block(event, 'copy-blocked'),
          cut: event => block(event, 'copy-blocked'),
          contextmenu: event => block(event, 'contextmenu-blocked'),
          drop: event => block(event, 'paste-blocked'),
          dragover: event => { event.preventDefault(); return true },
        })),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !replacing.current) callbacks.current.onChange(update.state.doc.toString())
        }),
      ] }),
    })
    // Firefox may bypass contextmenu handlers; intercept its right-button
    // mousedown directly on the editable DOM before selection logic runs.
    const rightMouseDown = (event: MouseEvent) => {
      if (event.button === 2) block(event, 'contextmenu-blocked')
    }
    editor.contentDOM.addEventListener('mousedown', rightMouseDown, true)
    view.current = editor
    return () => {
      editor.contentDOM.removeEventListener('mousedown', rightMouseDown, true)
      editor.destroy()
      view.current = null
    }
  }, [compartments])

  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    replacing.current = true
    try {
      // `addToHistory.of(false)` (T2.2 fix round, I6): a programmatic whole-doc replacement
      // (an external `value` change -- most notably one exercise's starter code landing in
      // place of another's, now that the workspace survives `next()` instead of remounting)
      // must never become an undo step. Without this, Ctrl+Z on the new exercise would restore
      // the previous exercise's full solution into `codeRef`/`onChange` -- a paste-block bypass
      // in everything but name.
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) })
    }
    finally { replacing.current = false }
  }, [value])

  useEffect(() => {
    // Loaded on demand, one grammar per `language` (`./grammars.ts`) -- the
    // compartment holds no language extension (plain text) until this
    // resolves. `active` guards against a stale dispatch landing after the
    // language changed again or the view unmounted while the import was in flight.
    let active = true
    void loadLanguageExtension(language).then((extension) => {
      if (active) view.current?.dispatch({ effects: compartments.language.reconfigure(extension) })
    })
    return () => { active = false }
  }, [compartments, language])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.editable.reconfigure([
      EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled),
    ]) })
  }, [compartments, disabled])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.label.reconfigure(EditorView.contentAttributes.of({
      role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'aria-readonly': String(disabled), spellcheck: 'false',
    })) })
  }, [compartments, disabled, label])

  // Fix round 3: populated once, for the lifetime of this mounted instance -- `.focus()` reads
  // `view.current` fresh at call time, so it stays correct even though this effect itself only
  // runs on mount/unmount (the CodeMirror view survives a `next()` exercise swap, T2.2's C1).
  useEffect(() => {
    if (!focusRef) return
    focusRef.current = { focus: () => view.current?.focus() }
    return () => { focusRef.current = null }
  }, [focusRef])

  return <div ref={host} className="min-w-0 overflow-hidden rounded-b-xl bg-lesson-code-surface font-mono" />
}
