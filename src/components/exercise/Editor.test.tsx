import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue exercise' }))
    expect(onResume).toHaveBeenCalledTimes(1)
    rerender(<LockdownOverlay reason="blur" onResume={onResume} />)
    expect(screen.getByText('Come back to continue')).toBeTruthy()
    expect(screen.getByRole('status').className).not.toContain('bg-background/85')
    rerender(<LockdownOverlay reason={null} onResume={onResume} />)
    expect(container.textContent).toBe('')
  })
})
