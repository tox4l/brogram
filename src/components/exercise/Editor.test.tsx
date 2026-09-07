import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { HighlightStyle, highlightingFor, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINE_BANK } from '@/lib/voice/lines'
import { CODE_HIGHLIGHT_SPECS, EDITOR_THEME_SPEC, Editor } from './Editor'
import { LockdownOverlay, type Focusable } from './LockdownOverlay'
import { SchemaEditor } from './SchemaEditor'

afterEach(cleanup)

describe('exercise editor', () => {
  it('blocks clipboard, context menu, and the Firefox right-button fallback inside CodeMirror', () => {
    const logIntegrity = vi.fn()
    const onChange = vi.fn()
    render(<Editor value="const x = 1" onChange={onChange} language="javascript" logIntegrity={logIntegrity} />)
    const editor = screen.getByRole('textbox', { name: 'Code editor' })
    expect(fireEvent.paste(editor)).toBe(false)
    expect(fireEvent.copy(editor)).toBe(false)
    expect(fireEvent.cut(editor)).toBe(false)
    expect(fireEvent.contextMenu(editor)).toBe(false)
    expect(fireEvent.mouseDown(editor, { button: 2 })).toBe(false)
    expect(fireEvent.dragOver(editor)).toBe(false)
    expect(fireEvent.drop(editor)).toBe(false)
    expect(logIntegrity.mock.calls.map(([type]) => type)).toEqual([
      'paste-blocked', 'copy-blocked', 'copy-blocked', 'contextmenu-blocked', 'contextmenu-blocked', 'paste-blocked',
    ])
    expect(editor.textContent).toBe('const x = 1')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports document edits once, accepts external values silently, and disables editing without recreating the view', () => {
    const onChange = vi.fn()
    const props = { value: 'a', onChange, language: 'python' as const, logIntegrity: vi.fn() }
    const { rerender } = render(<Editor {...props} />)
    const content = screen.getByRole('textbox', { name: 'Code editor' })
    const view = EditorView.findFromDOM(content)!
    act(() => view.dispatch({ changes: { from: 1, insert: 'b' } }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('ab')
    rerender(<Editor {...props} value="updated" disabled />)
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toBe(content)
    expect(content.textContent).toBe('updated')
    expect(content.getAttribute('contenteditable')).toBe('false')
    expect(view.state.readOnly).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not let undo after an external value swap restore the previous exercise code (T2.2 fix round I6)', () => {
    const onChange = vi.fn()
    const props = { value: 'def solve_one(): pass', onChange, language: 'python' as const, logIntegrity: vi.fn() }
    const { rerender } = render(<Editor {...props} />)
    const content = screen.getByRole('textbox', { name: 'Code editor' })
    const view = EditorView.findFromDOM(content)!
    // A learner edit on the FIRST exercise -- this one legitimately belongs in undo history.
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n# tweak' } }))
    expect(content.textContent).toContain('tweak')
    // The workspace survives to a second exercise in place (the same `Editor` instance, a new
    // `value` prop) -- the whole-doc replacement this produces must never enter undo history.
    rerender(<Editor {...props} value="def solve_two(): pass" />)
    expect(EditorView.findFromDOM(content)).toBe(view) // same instance -- no remount
    expect(content.textContent).toBe('def solve_two(): pass')
    onChange.mockClear()
    const undid = undo(view)
    expect(undid).toBe(false) // nothing to undo -- the swap left no history entry
    expect(content.textContent).toBe('def solve_two(): pass') // never reverted to exercise one's code
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps SQL schema editing on the guarded editor', () => {
    const logIntegrity = vi.fn()
    render(<SchemaEditor value="CREATE TABLE students (id INTEGER);" onChange={() => {}} logIntegrity={logIntegrity} />)
    const editor = screen.getByRole('textbox', { name: 'Schema editor' })
    expect(fireEvent.paste(editor)).toBe(false)
    expect(logIntegrity).toHaveBeenCalledWith('paste-blocked')
  })

  // Fix round I2: `--muted` and `--lesson-code-surface` are byte-identical in Folio
  // (`oklch(0.955 0.008 85)` both), so an active-line band on `--muted` disappeared entirely on
  // that palette. `--rule` steps against the code surface in all five.
  it('puts the active-line band on --rule, not --muted (fix round I2)', () => {
    expect(EDITOR_THEME_SPEC['.cm-activeLine, .cm-activeLineGutter'].backgroundColor).toBe('var(--rule)')
  })

  it('populates focusRef with an imperative focus() that lands on the CodeMirror content (fix round 3)', () => {
    function Harness() {
      const focusRef = useRef<Focusable | null>(null)
      return (
        <>
          <button type="button" onClick={() => focusRef.current?.focus()}>focus editor</button>
          <Editor value="a" onChange={() => {}} language="javascript" logIntegrity={vi.fn()} focusRef={focusRef} />
        </>
      )
    }
    render(<Harness />)
    const content = screen.getByRole('textbox', { name: 'Code editor' })
    expect(document.activeElement).not.toBe(content)
    fireEvent.click(screen.getByRole('button', { name: 'focus editor' }))
    expect(document.activeElement).toBe(content)
  })
})

describe('LockdownOverlay', () => {
  it('covers the workspace with a separate pointer-enabled element and lets idle users resume', () => {
    const onResume = vi.fn()
    const { container, rerender } = render(<div><p>Editor content</p><LockdownOverlay reason="idle" onResume={onResume} /></div>)
    const overlay = screen.getByRole('status')
    expect(overlay.className).toContain('pointer-events-auto')
    expect(overlay.className).toContain('fixed')
    expect(overlay.className).toContain('backdrop-blur')
    expect(overlay.contains(screen.getByText('Editor content'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Continue rep' }))
    expect(onResume).toHaveBeenCalledTimes(1)
    rerender(<LockdownOverlay reason="blur" onResume={onResume} />)
    // T2.8 fix round 1, I1: the body copy is now one of the bank's own
    // guard.blur variants (what the app actually saw), not the hardcoded
    // "Come back to continue" heading this used to render.
    expect(LINE_BANK['guard.blur'].variants).toContain(screen.getByRole('status').textContent)
    expect(screen.getByRole('status').className).not.toContain('bg-background/85')
    rerender(<LockdownOverlay reason={null} onResume={onResume} />)
    expect(container.textContent).toBe('')
  })
})

// T4.7 / spec 2.6: "the nine `--code-*` tokens ship as one `HighlightStyle.define()` mapping
// `@lezer/highlight` tags... one style, five palettes, no per-theme JavaScript." This exercises
// the exported spec array through CodeMirror's own `highlightingFor` resolver -- the same call
// the real editor's tree highlighter makes -- rather than only asserting on the plain JS array,
// so a tag wired to the wrong token (or dropped entirely) fails here without needing a live
// CodeMirror view or a real grammar.
describe('code highlight style (spec 2.6 tag map)', () => {
  const style = HighlightStyle.define(CODE_HIGHLIGHT_SPECS)
  const state = EditorState.create({ extensions: [syntaxHighlighting(style)] })
  const colorFor = (tag: import('@lezer/highlight').Tag) => {
    const cls = highlightingFor(state, [tag])
    const rules = style.module?.getRules() ?? ''
    const rule = cls ? rules.split('\n').find((line) => line.startsWith(`.${cls} `) || line.startsWith(`.${cls}{`)) : undefined
    return rule?.match(/color:\s*([^;]+);/)?.[1]
  }

  it.each([
    [tags.keyword, '--code-keyword'],
    [tags.controlKeyword, '--code-keyword'],
    [tags.definitionKeyword, '--code-keyword'],
    [tags.string, '--code-string'],
    [tags.character, '--code-string'],
    [tags.number, '--code-number'],
    [tags.bool, '--code-number'],
    [tags.atom, '--code-number'],
    [tags.comment, '--code-comment'],
    [tags.lineComment, '--code-comment'],
    [tags.blockComment, '--code-comment'],
    [tags.function(tags.variableName), '--code-function'],
    [tags.function(tags.propertyName), '--code-function'],
    [tags.typeName, '--code-type'],
    [tags.className, '--code-type'],
    [tags.variableName, '--code-variable'],
    [tags.propertyName, '--code-variable'],
    [tags.operator, '--code-operator'],
    [tags.punctuation, '--code-punct'],
    [tags.bracket, '--code-punct'],
  ] as const)('%s resolves to var(%s)', (tag, token) => {
    expect(colorFor(tag)).toBe(`var(${token})`)
  })

  it('maps invalid syntax to --destructive, not a --code-* token', () => {
    expect(colorFor(tags.invalid)).toBe('var(--destructive)')
  })

  it('never flattens two distinct roles onto the same colour', () => {
    const resolved = new Set(CODE_HIGHLIGHT_SPECS.map((spec) => spec.color))
    expect(resolved.size).toBe(CODE_HIGHLIGHT_SPECS.length)
  })
})
