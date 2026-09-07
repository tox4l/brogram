import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExercisePublic } from '@/lib/contracts'
import ExercisePage from './page'

const mocks = vi.hoisted(() => ({ loop: vi.fn(), session: vi.fn(), lockdown: vi.fn(), push: vi.fn(), params: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: mocks.params, useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/hooks/useExerciseLoop', () => ({ useExerciseLoop: mocks.loop }))
vi.mock('@/hooks/useLockdown', () => ({ useLockdown: mocks.lockdown }))
vi.mock('@/store/session', () => ({ useSession: mocks.session }))

const exercise: ExercisePublic = { id: 'exercise-one', cloId: 'clo', kind: 'predict-output', language: 'javascript', difficulty: 3, pattern: 'trace', title: 'Follow the value', prompt: 'What is printed?', starterCode: 'console.log(3)', tests: [{ id: 'one', input: '', expected: '3', hidden: false }], origin: 'seed', tags: [] }
const model = () => ({ exercise, clo: null, code: '', setCode: vi.fn(), run: vi.fn(), submit: vi.fn(), requestHint: vi.fn(), next: vi.fn(), retry: vi.fn(), status: 'ready', outcome: null, results: [], diagnosis: null, partialDiagnosis: null, hints: [], partialHint: null, hintPending: false, review: null, nextExercise: null, progress: null, stdout: '', stderr: '', error: null, hintAvailable: false, hintWaitSeconds: 0, hintCount: 0, busy: false, duringAttempt: false, pointsEarned: 0, pointsProvisional: false, chain: 0, closed: false, controlsDisabled: false, judgeAbsent: false, lastRewardAttempt: null })
const javaExercise: ExercisePublic = { id: 'exercise-java', cloId: 'clo', kind: 'code', language: 'java', difficulty: 2, pattern: 'loop', title: 'Sum the values', prompt: 'Return the sum of the inputs.', starterCode: 'class Solution {}', tests: [{ id: 'one', input: '1 2', expected: '3', hidden: false }], origin: 'seed', tags: [] }
const traceExercise: ExercisePublic = { id: 'exercise-trace-bad', cloId: 'clo', kind: 'trace', language: 'javascript', difficulty: 2, pattern: 'trace', title: 'Trace it', prompt: 'What does count hold at line 2?', starterCode: 'let count = 0\ncount += 1', tests: [{ id: 'one', input: '', expected: '1', hidden: false }], origin: 'seed', tags: [] }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.params.mockReturnValue({ id: 'exercise-one' })
  mocks.session.mockReturnValue({ profile: { account_status: 'active' } })
  mocks.loop.mockReturnValue(model())
  mocks.lockdown.mockReturnValue({ overlay: null, logIntegrity: vi.fn(), containerProps: {}, resume: vi.fn(), pasteMessage: '', loggingError: null })
})
afterEach(cleanup)

describe('exercise screen', () => {
  it('keeps restricted users out of the loading and runtime hooks', () => {
    mocks.session.mockReturnValue({ profile: { account_status: 'restricted' } })
    render(<ExercisePage />)
    expect(screen.getByRole('heading', { name: 'Exercises are paused' })).toBeTruthy()
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
    expect(screen.getByText('Java exercises are not available yet. Pick another course for now.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to dashboard' }).getAttribute('href')).toBe('/dashboard')
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(state.run).not.toHaveBeenCalled()
    expect(state.submit).not.toHaveBeenCalled()
  })
  it('places a separate cover above inert workspace controls', () => {
    const resume = vi.fn()
    mocks.lockdown.mockReturnValue({ overlay: 'idle', logIntegrity: vi.fn(), containerProps: {}, resume, pasteMessage: '', loggingError: null })
    const { container } = render(<ExercisePage />)
    const cover = screen.getByTestId('lockdown-overlay')
    expect(cover.className).toContain('pointer-events-auto')
    expect(cover.closest('[inert]')).toBeNull()
    expect(container.querySelector('textarea')?.closest('[inert]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue exercise' }))
    expect(resume).toHaveBeenCalledTimes(1)
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
  it('shows the next-exercise section as soon as outcome is passed, without waiting for status to settle', () => {
    const state = { ...model(), status: 'graded', outcome: 'passed', busy: true, nextExercise: null }
    mocks.loop.mockReturnValue(state)
    render(<ExercisePage />)
    expect(screen.getByText('Preparing your next exercise.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Next exercise/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
