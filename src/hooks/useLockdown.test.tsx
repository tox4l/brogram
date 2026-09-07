import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrityEventType } from '@/lib/contracts'
import * as soundManager from '@/lib/sound/manager'
import { LINE_BANK, line } from '@/lib/voice/lines'
import { clearAllLocalIntegrityLogsForTests } from '@/lib/integrity/localLog'
import { useLockdown } from './useLockdown'

const { insert } = vi.hoisted(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: (table: string) => {
  if (table !== 'integrity_events') throw new Error(`Unexpected table: ${table}`)
  return { insert }
} }) }))
vi.mock('@/store/session', () => ({ useSession: (selector: (value: unknown) => unknown) => selector({ user: { id: 'learner-1' } }) }))

function rows() {
  return insert.mock.calls.flatMap(([batch]) => batch as { type: IntegrityEventType; during_attempt: boolean; exercise_id: string | null; user_id: string }[])
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
  insert.mockReset().mockResolvedValue({ error: null })
  sessionStorage.clear()
  clearAllLocalIntegrityLogsForTests()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('useLockdown', () => {
  it('covers idle work after 15 seconds, resumes on a key, and writes only one idle row at 60 seconds', async () => {
    const { result } = renderHook(() => useLockdown('exercise-1', { duringAttempt: true }))
    await act(async () => { vi.advanceTimersByTime(14_000) })
    expect(result.current.overlay).toBeNull()
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(result.current.overlay).toBe('idle')
    fireEvent.keyDown(window, { key: 'a' })
    expect(result.current.overlay).toBeNull()
    await act(async () => { vi.advanceTimersByTime(59_000) })
    expect(rows().filter(row => row.type === 'idle')).toHaveLength(0)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(rows().filter(row => row.type === 'idle')).toEqual([
      expect.objectContaining({ type: 'idle', during_attempt: true, exercise_id: 'exercise-1', user_id: 'learner-1' }),
    ])
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(rows().filter(row => row.type === 'idle')).toHaveLength(1)
  })

  it('keeps a hidden or blurred workspace covered until visible focus returns', () => {
    const { result } = renderHook(() => useLockdown('exercise-1'))
    fireEvent.blur(window)
    expect(result.current.overlay).toBe('blur')
    fireEvent.keyDown(window, { key: 'a' })
    expect(result.current.overlay).toBe('blur')
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.focus(window)
    expect(result.current.overlay).toBe('blur')
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    fireEvent(document, new Event('visibilitychange'))
    fireEvent.focus(window)
    expect(result.current.overlay).toBeNull()
  })

  it('ignores a blur caused by the grading sandbox taking focus, and hands it back', () => {
    // The web runtime's sandbox iframe (src/lib/runtimes/web.ts) now has a real
    // layout box instead of display:none, which makes it capable of stealing
    // top-level focus via a script inside the graded document calling
    // element.focus() -- confirmed live, and confirmed that this fires a real
    // `window` blur even though the tab itself never lost OS focus. That must
    // never read as the learner leaving the workspace.
    const { result } = renderHook(() => useLockdown('exercise-1'))
    const sandbox = document.createElement('iframe')
    sandbox.setAttribute('data-brogram-sandbox', 'true')
    document.body.appendChild(sandbox)
    const blurSpy = vi.spyOn(sandbox, 'blur')
    Object.defineProperty(document, 'activeElement', { configurable: true, value: sandbox })
    fireEvent.blur(window)
    expect(result.current.overlay).toBeNull()
    expect(rows().filter(row => row.type === 'blur')).toHaveLength(0)
    // Belt and braces alongside web.ts's own restoreFocus: this guard hands
    // focus back itself rather than trusting the runtime side alone.
    expect(blurSpy).toHaveBeenCalledTimes(1)
    sandbox.remove()
    delete (document as { activeElement?: unknown }).activeElement
  })

  it('still overlays and logs a genuine blur when the new focus target is not a grading sandbox', () => {
    const { result } = renderHook(() => useLockdown('exercise-1'))
    const somewhereElse = document.createElement('button')
    document.body.appendChild(somewhereElse)
    Object.defineProperty(document, 'activeElement', { configurable: true, value: somewhereElse })
    fireEvent.blur(window)
    expect(result.current.overlay).toBe('blur')
    somewhereElse.remove()
    delete (document as { activeElement?: unknown }).activeElement
  })

  it('never overlays anything for PrintScreen (R9.1) but still inserts the event, including keyCode 44, and never touches the clipboard', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { result } = renderHook(() => useLockdown('exercise-1'))
    fireEvent.keyDown(window, { key: 'PrintScreen' })
    expect(result.current.overlay).toBeNull()
    fireEvent.keyUp(window, { keyCode: 44 })
    expect(result.current.overlay).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(rows().filter(row => row.type === 'printscreen')).toEqual([
      expect.objectContaining({ type: 'printscreen', exercise_id: 'exercise-1', user_id: 'learner-1' }),
    ])
  })

  it('does not let a PrintScreen press block a later blur overlay from showing', () => {
    const { result } = renderHook(() => useLockdown('exercise-1'))
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    expect(result.current.overlay).toBeNull()
    fireEvent.blur(window)
    expect(result.current.overlay).toBe('blur')
  })

  it('shows the printscreen note exactly once, on the third press in an exercise, and not again on a fourth', async () => {
    const { result } = renderHook(() => useLockdown('exercise-1'))
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    expect(result.current.printscreenNote).toBeNull()
    await act(async () => { vi.advanceTimersByTime(1_000) })
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    expect(result.current.printscreenNote).toBeNull()
    await act(async () => { vi.advanceTimersByTime(1_000) })
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    expect(result.current.printscreenNote).toBe(line('guard.printscreen'))
    await act(async () => { vi.advanceTimersByTime(1_000) })
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    expect(result.current.printscreenNote).toBe(line('guard.printscreen'))
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(rows().filter(row => row.type === 'printscreen')).toHaveLength(4)
  })

  it('rotates the paste toast so two consecutive blocks never say the same thing, and exposes a fixed "why" sentence', () => {
    const { result } = renderHook(() => useLockdown('exercise-1'))
    act(() => { result.current.logIntegrity('paste-blocked') })
    const first = result.current.pasteMessage
    act(() => { result.current.logIntegrity('paste-blocked') })
    const second = result.current.pasteMessage
    expect(first.length).toBeGreaterThan(0)
    expect(second).not.toBe(first)
    expect(result.current.pasteWhy).toBe(line('guard.paste.why'))
  })

  it('mirrors an accepted event into this signed-in user\'s own local log, keyed by user id (C1)', async () => {
    const { result } = renderHook(() => useLockdown('exercise-1'))
    act(() => { result.current.logIntegrity('paste-blocked') })
    const stored = JSON.parse(localStorage.getItem('brogram:integrity-log:learner-1') ?? '[]')
    expect(stored).toEqual([expect.objectContaining({ type: 'paste-blocked' })])
    expect(localStorage.getItem('brogram:integrity-log:some-other-learner')).toBeNull()
  })

  it('never plays a sound or fires any animation hook on a guard event (R9.6 — enforcement surfaces get no personality)', async () => {
    const play = vi.spyOn(soundManager, 'play')
    const { result } = renderHook(() => useLockdown('exercise-1', { duringAttempt: true }))
    fireEvent.blur(window)
    fireEvent.focus(window)
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    act(() => { result.current.logIntegrity('paste-blocked') })
    await act(async () => { vi.advanceTimersByTime(90_000) })
    expect(play).not.toHaveBeenCalled()
  })

  it('blocks container clipboard and context actions and coalesces repeated types per second', async () => {
    function Workspace() {
      const { containerProps, pasteMessage, logIntegrity } = useLockdown('exercise-1', { duringAttempt: true })
      return <div {...containerProps}><textarea aria-label="Answer" onPaste={() => logIntegrity('paste-blocked')} /><p role="status">{pasteMessage}</p></div>
    }
    render(<Workspace />)
    const answer = screen.getByRole('textbox')
    expect(fireEvent.paste(answer)).toBe(false)
    expect(fireEvent.paste(answer)).toBe(false)
    expect(fireEvent.copy(answer)).toBe(false)
    expect(fireEvent.cut(answer)).toBe(false)
    expect(fireEvent.contextMenu(answer)).toBe(false)
    expect(fireEvent.mouseDown(answer, { button: 2 })).toBe(false)
    // R9.3: the message now rotates through the bank's four honest variants
    // rather than always being the single static string this used to be.
    expect(LINE_BANK['guard.paste'].variants).toContain(screen.getByRole('status').textContent)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(rows().map(row => row.type).sort()).toEqual(['contextmenu-blocked', 'copy-blocked', 'paste-blocked'])
    fireEvent.paste(answer)
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(rows().filter(row => row.type === 'paste-blocked')).toHaveLength(2)
  })

  it('flushes pending events on unmount with the event-time attempt flag', async () => {
    const { result, rerender, unmount } = renderHook(({ active }) => useLockdown('exercise-1', { duringAttempt: active }), { initialProps: { active: true } })
    act(() => result.current.logIntegrity('paste-blocked'))
    rerender({ active: false })
    await act(async () => unmount())
    expect(rows()).toEqual([expect.objectContaining({ type: 'paste-blocked', during_attempt: true })])
  })

  it('does not guard or write when disabled', async () => {
    const { result } = renderHook(() => useLockdown('exercise-1', { enabled: false }))
    fireEvent.blur(window)
    act(() => result.current.logIntegrity('paste-blocked'))
    await act(async () => { vi.advanceTimersByTime(90_000) })
    expect(result.current.overlay).toBeNull()
    expect(rows()).toEqual([])
  })

  it('resets the printscreen count when a new exercise opens, so the note needs a fresh three presses', async () => {
    const { result, rerender } = renderHook(({ id }) => useLockdown(id), { initialProps: { id: 'exercise-1' } })
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    rerender({ id: 'exercise-2' })
    await act(async () => { vi.advanceTimersByTime(1_000) })
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    await act(async () => { vi.advanceTimersByTime(1_000) })
    fireEvent.keyUp(window, { key: 'PrintScreen' })
    expect(result.current.printscreenNote).toBeNull()
  })

  it('spaces same-type writes by a full second even when unmount flushes a partial batch', async () => {
    const { result, unmount } = renderHook(() => useLockdown('exercise-1'))
    act(() => result.current.logIntegrity('copy-blocked'))
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(rows()).toHaveLength(1)
    await act(async () => { vi.advanceTimersByTime(100) })
    act(() => result.current.logIntegrity('copy-blocked'))
    unmount()
    expect(rows()).toHaveLength(1)
    await act(async () => { vi.advanceTimersByTime(900) })
    expect(rows()).toHaveLength(2)
  })

  it('surfaces rejected integrity writes without an unhandled rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    insert.mockResolvedValueOnce({ error: { message: 'Write unavailable' } })
    const { result } = renderHook(() => useLockdown('exercise-1'))
    act(() => result.current.logIntegrity('copy-blocked'))
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(result.current.loggingError).toContain('could not be saved')
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('inserts a null exercise_id on screens with no exercise row, such as the de-rot runner', async () => {
    const { result } = renderHook(() => useLockdown(null, { duringAttempt: false }))
    act(() => result.current.logIntegrity('paste-blocked'))
    await act(async () => { vi.advanceTimersByTime(1_000) })
    expect(rows()).toEqual([expect.objectContaining({ type: 'paste-blocked', exercise_id: null, user_id: 'learner-1' })])
  })

  it('skips the idle overlay when idleGuard is false but keeps the blur guard on', async () => {
    const { result } = renderHook(() => useLockdown('exercise-1', { idleGuard: false }))
    await act(async () => { vi.advanceTimersByTime(15_000) })
    expect(result.current.overlay).toBeNull()
    fireEvent.blur(window)
    expect(result.current.overlay).toBe('blur')
  })

  it('still logs an idle event at 60 seconds when idleGuard is false', async () => {
    const { result } = renderHook(() => useLockdown('exercise-1', { duringAttempt: true, idleGuard: false }))
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(result.current.overlay).toBeNull()
    expect(rows().filter(row => row.type === 'idle')).toHaveLength(1)
  })
})
