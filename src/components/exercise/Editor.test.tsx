import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINE_BANK } from '@/lib/voice/lines'
import { Editor } from './Editor'
import { LockdownOverlay } from './LockdownOverlay'
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
