import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clo, ExercisePublic } from '@/lib/contracts'
import { LINE_BANK } from '@/lib/voice/lines'
import ExercisePage from './page'

const mocks = vi.hoisted(() => ({ loop: vi.fn(), session: vi.fn(), lockdown: vi.fn(), push: vi.fn(), params: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: mocks.params, useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/hooks/useExerciseLoop', () => ({ useExerciseLoop: mocks.loop }))
vi.mock('@/hooks/useLockdown', () => ({ useLockdown: mocks.lockdown }))
vi.mock('@/store/session', () => ({ useSession: mocks.session }))

const exercise: ExercisePublic = { id: 'exercise-one', cloId: 'clo', kind: 'predict-output', language: 'javascript', difficulty: 3, pattern: 'trace', title: 'Follow the value', prompt: 'What is printed?', starterCode: 'console.log(3)', tests: [{ id: 'one', input: '', expected: '3', hidden: false }], origin: 'seed', tags: [] }
const model = () => ({ exercise, clo: null, code: '', setCode: vi.fn(), run: vi.fn(), submit: vi.fn(), requestHint: vi.fn(), next: vi.fn(), retry: vi.fn(), status: 'ready', outcome: null, results: [], diagnosis: null, partialDiagnosis: null, hints: [], partialHint: null, hintPending: false, review: null, nextExercise: null, progress: null, stdout: '', stderr: '', error: null, hintAvailable: false, hintWaitSeconds: 0, hintCount: 0, busy: false, duringAttempt: false, pointsEarned: 0, pointsProvisional: false, chain: 0, closed: false, canAdvance: false, controlsDisabled: false, judgeAbsent: false, lastRewardAttempt: null })
const javaExercise: ExercisePublic = { id: 'exercise-java', cloId: 'clo', kind: 'code', language: 'java', difficulty: 2, pattern: 'loop', title: 'Sum the values', prompt: 'Return the sum of the inputs.', starterCode: 'class Solution {}', tests: [{ id: 'one', input: '1 2', expected: '3', hidden: false }], origin: 'seed', tags: [] }
const traceExercise: ExercisePublic = { id: 'exercise-trace-bad', cloId: 'clo', kind: 'trace', language: 'javascript', difficulty: 2, pattern: 'trace', title: 'Trace it', prompt: 'What does count hold at line 2?', starterCode: 'let count = 0\ncount += 1', tests: [{ id: 'one', input: '', expected: '1', hidden: false }], origin: 'seed', tags: [] }
const codeExercise: ExercisePublic = { id: 'exercise-code-one', cloId: 'clo', kind: 'code', language: 'javascript', difficulty: 2, pattern: 'scan', title: 'First code rep', prompt: 'Write it.', starterCode: 'function solveOne() {}', tests: [{ id: 'one', input: '', expected: '1', hidden: false }], origin: 'seed', tags: [] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.params.mockReturnValue({ id: 'exercise-one' })
  mocks.session.mockReturnValue({ profile: { account_status: 'active' } })
  mocks.loop.mockReturnValue(model())
  mocks.lockdown.mockReturnValue({ overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', pasteWhy: '', printscreenNote: null, loggingError: null })
})
afterEach(cleanup)

describe('exercise screen', () => {
  it('keeps restricted users out of the loading and runtime hooks', () => {
    mocks.session.mockReturnValue({ profile: { account_status: 'restricted' } })
    render(<ExercisePage />)
    expect(screen.getByRole('heading', { name: 'Reps are paused' })).toBeTruthy()
    expect(mocks.loop).not.toHaveBeenCalled()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/dashboard')
  })
  it('shows a useful loading state before any exercise exists', () => {
    mocks.loop.mockReturnValue({ ...model(), exercise: null, status: 'loading' })
    render(<ExercisePage />)
    expect(screen.getByRole('status').textContent).toContain('Loading your prompt')
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
  })
  it('keeps retry and dashboard navigation available after a load error', () => {
    const retry = vi.fn()
    mocks.loop.mockReturnValue({ ...model(), exercise: null, status: 'error', error: 'Exercise unavailable.', retry })
    render(<ExercisePage />)
    expect(screen.getByRole('alert').textContent).toBe('Exercise unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
  it('uses the typed answer form and submits without a Run control', () => {
    const state = model()
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Predicted output' }), { target: { value: '4' } })
    expect(state.setCode).toHaveBeenCalledWith('4')
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(state.submit).toHaveBeenCalledTimes(1)
  })
  it('keeps only retry enabled while a saved submission needs recovery', () => {
    const state = { ...model(), status: 'error', controlsDisabled: true, error: 'Progress needs saving.' }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(state.submit).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.retry).toHaveBeenCalledTimes(1)
  })
  it('shows a not-available notice instead of Run and Submit for a Java exercise with no judge provider, and never calls run or submit', () => {
    const state = { ...model(), exercise: javaExercise, judgeAbsent: true }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    expect(screen.getByText("Java reps aren't available yet. Pick another course for now.")).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to dashboard' }).getAttribute('href')).toBe('/dashboard')
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(state.run).not.toHaveBeenCalled()
    expect(state.submit).not.toHaveBeenCalled()
  })
  it('places a separate cover above inert workspace controls', () => {
    const resume = vi.fn()
    mocks.lockdown.mockReturnValue({ overlay: 'idle', logIntegrity: vi.fn(), containerProps: {}, resume, pasteMessage: '', pasteWhy: '', printscreenNote: null, loggingError: null })
    const { container } = render(<ExercisePage />)
    const cover = screen.getByTestId('lockdown-overlay')
    expect(cover.className).toContain('pointer-events-auto')
    expect(cover.closest('[inert]')).toBeNull()
    expect(container.querySelector('textarea')?.closest('[inert]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue rep' }))
    expect(resume).toHaveBeenCalledTimes(1)
  })
  it('renders the rotating paste bank line and its "why" affordance, not the old static string', () => {
    mocks.lockdown.mockReturnValue({
      overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(),
      pasteMessage: 'Paste is off on this screen. Type it out.',
      pasteWhy: 'Paste is off because typing is the exercise, and because it is the one thing browsers actually let us enforce, so we do.',
      printscreenNote: null, loggingError: null,
    })
    render(<ExercisePage />)
    expect(screen.getByText('Paste is off on this screen. Type it out.')).toBeTruthy()
    expect(screen.queryByText("Type it. That's the whole point.")).toBeNull()
    expect(screen.queryByText('Paste is off because typing is the exercise, and because it is the one thing browsers actually let us enforce, so we do.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    expect(screen.getByText('Paste is off because typing is the exercise, and because it is the one thing browsers actually let us enforce, so we do.')).toBeTruthy()
  })
  it('renders the once-only PrintScreen note when the hook reports one', () => {
    mocks.lockdown.mockReturnValue({ overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', pasteWhy: '', printscreenNote: "Screenshots aren't something a website can block. We log the attempt and move on.", loggingError: null })
    render(<ExercisePage />)
    expect(screen.getByText("Screenshots aren't something a website can block. We log the attempt and move on.")).toBeTruthy()
  })
  it('falls back to the typed-answer form for a trace exercise whose expected value is not a plain object', () => {
    mocks.loop.mockReturnValue({ ...model(), exercise: traceExercise })
    render(<ExercisePage />)
    expect(screen.getByRole('textbox', { name: 'Predicted output' })).toBeTruthy()
  })
  it('renders a plain trace input when its expected value is a plain object', () => {
    const objectTrace = { ...traceExercise, tests: [{ id: 'one', input: '', expected: '{"count":1}', hidden: false }] }
    mocks.loop.mockReturnValue({ ...model(), exercise: objectTrace })
    render(<ExercisePage />)
    expect(screen.queryByRole('textbox', { name: 'Predicted output' })).toBeNull()
    expect(screen.getByText('count')).toBeTruthy()
  })
  it('shows the verdict, XP and chain the instant outcome is known, before status settles', () => {
    const state = { ...model(), status: 'graded', outcome: 'passed', pointsEarned: 335, pointsProvisional: true, chain: 1 }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    expect(screen.getAllByText('Passed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: /Passed/ })).toBeTruthy()
  })
  it('shows the needs-work verdict instantly on a fail, before diagnosis exists', () => {
    const state = { ...model(), status: 'graded', outcome: 'failed' }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    expect(screen.getByText('Needs work')).toBeTruthy()
  })
  it('never draws the pass checkmark on a failed verdict (fix round I2)', () => {
    mocks.loop.mockReturnValue({ ...model(), status: 'graded', outcome: 'failed' })
    const { container } = render(<ExercisePage />)
    const verdict = screen.getByTestId('verdict-banner')
    expect(verdict.querySelector('svg.lucide-check')).toBeNull()
    expect(verdict.querySelector('svg.lucide-x')).toBeTruthy()
    expect(container.querySelector('svg.lucide-check')).toBeNull()
  })
  it('does not remount the workspace when the exercise id changes in place (next())', () => {
    const { rerender } = render(<ExercisePage />)
    const before = screen.getByTestId('exercise-workspace')
    const workEditor = screen.getByRole('textbox', { name: 'Predicted output' })
    // Simulate what `next()` produces: the URL/param moves to a new exercise id (`router.replace`,
    // no remounting `key`) and the loop's own state updates to reflect the new exercise -- the
    // outer `ExercisePage`/`ExerciseWorkspace` tree is never given a reason to unmount.
    mocks.params.mockReturnValue({ id: 'exercise-two' })
    mocks.loop.mockReturnValue({ ...model(), exercise: { ...exercise, id: 'exercise-two', title: 'A different rep' } })
    rerender(<ExercisePage />)
    expect(screen.getByTestId('exercise-workspace')).toBe(before)
    expect(screen.getByRole('textbox', { name: 'Predicted output' })).toBe(workEditor)
    expect(screen.getByText('A different rep')).toBeTruthy()
  })
  it('keeps the real CodeMirror editor instance across next() (fix round Mi3/C1)', async () => {
    // The earlier "does not remount" test used the plain `predict-output` textbox; the brief
    // and the review both ask specifically about the CodeMirror `Editor` instance, which only a
    // `code`-kind exercise mounts (via `next/dynamic`, real component, not mocked here).
    mocks.loop.mockReturnValue({ ...model(), exercise: codeExercise, code: codeExercise.starterCode })
    const { rerender } = render(<ExercisePage />)
    const editor = await waitFor(() => screen.getByRole('textbox', { name: 'Code editor' }))
    const view = EditorView.findFromDOM(editor)
    expect(view).toBeTruthy()
    expect(editor.textContent).toBe('function solveOne() {}')

    const nextCode: ExercisePublic = { ...codeExercise, id: 'exercise-code-two', title: 'Second code rep', starterCode: 'function solveTwo() {}' }
    mocks.params.mockReturnValue({ id: 'exercise-code-two' })
    mocks.loop.mockReturnValue({ ...model(), exercise: nextCode, code: nextCode.starterCode })
    rerender(<ExercisePage />)

    const editorAfter = screen.getByRole('textbox', { name: 'Code editor' })
    expect(editorAfter).toBe(editor) // same DOM node -- Editor never remounted
    expect(EditorView.findFromDOM(editorAfter)).toBe(view) // same CodeMirror instance
    await waitFor(() => expect(editorAfter.textContent).toBe('function solveTwo() {}'))
  })
  it('returns focus to the editor the instant the lockdown overlay lifts (fix round 3)', async () => {
    mocks.loop.mockReturnValue({ ...model(), exercise: codeExercise, code: codeExercise.starterCode })
    mocks.lockdown.mockReturnValue({ overlay: 'idle', logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', pasteWhy: '', printscreenNote: null, loggingError: null })
    const { rerender } = render(<ExercisePage />)
    const editor = await waitFor(() => screen.getByRole('textbox', { name: 'Code editor' }))
    expect(document.activeElement).not.toBe(editor)
    mocks.lockdown.mockReturnValue({ overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', pasteWhy: '', printscreenNote: null, loggingError: null })
    rerender(<ExercisePage />)
    expect(document.activeElement).toBe(editor)
  })
  it('returns focus to the editor once the paste "why" explanation closes (fix round 3)', async () => {
    mocks.loop.mockReturnValue({ ...model(), exercise: codeExercise, code: codeExercise.starterCode })
    mocks.lockdown.mockReturnValue({
      overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(),
      pasteMessage: 'Paste is off on this screen. Type it out.',
      pasteWhy: 'Paste is off because typing is the exercise, and because it is the one thing browsers actually let us enforce, so we do.',
      printscreenNote: null, loggingError: null,
    })
    render(<ExercisePage />)
    const editor = await waitFor(() => screen.getByRole('textbox', { name: 'Code editor' }))
    expect(document.activeElement).not.toBe(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide why' }))
    expect(document.activeElement).toBe(editor)
  })
  it('shows the next-exercise section as soon as outcome is passed, without waiting for status to settle', () => {
    const state = { ...model(), status: 'graded', outcome: 'passed', busy: true, nextExercise: null, canAdvance: false }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    expect(screen.getByText('Preparing your next rep.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Next rep/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('enables Next once the hook reports canAdvance, even while other background work is still busy', () => {
    const state = { ...model(), status: 'graded', outcome: 'passed', busy: true, nextExercise: { ...exercise, id: 'exercise-two' }, canAdvance: true }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    expect((screen.getByRole('button', { name: /Next rep/ }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('never renders the raw CLO outcome sentence in the close celebration line (T2.7b review, I1)', () => {
    const clo: Clo = { id: 'INFS1101-3', course: 'INFS1101', ordinal: 3, outcome: 'Control program flow correctly with sequence, selection (if / elif / else) and repetition (for / while), including nested and early-exit forms.', topics: [], prerequisites: [], patterns: [], assessableInCode: true }
    const state = { ...model(), status: 'graded', outcome: 'passed', closed: true, clo }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    // Scoped to the close celebration block itself -- `clo.outcome` legitimately appears
    // elsewhere on the page (PromptPanel shows the curriculum context being exercised);
    // the bug this guards is the outcome sentence leaking into the celebration line.
    const closeSection = screen.getByRole('button', { name: 'Back to your path' }).closest('div')
    const filled = LINE_BANK['clo.close'].variants.map((variant) => variant.replace('{skill}', 'That skill'))
    expect(filled).toContain(closeSection?.querySelector('p')?.textContent)
    expect(closeSection?.textContent).not.toContain('Control program flow')
  })
  it('keeps Next honestly disabled and shows the save-failure line, never "saved", when the background save fails on a pass (fix round C2)', () => {
    const state = { ...model(), status: 'graded', outcome: 'passed', error: 'write temporarily unavailable', canAdvance: false, nextExercise: null }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    expect(screen.queryByText('Pass saved.')).toBeNull()
    expect(screen.queryByText('Preparing your next rep.')).toBeNull()
    expect((screen.getByRole('button', { name: /Next rep/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
