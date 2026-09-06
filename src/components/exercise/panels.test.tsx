import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExercisePublic } from '@/lib/contracts'
import { PromptPanel } from './PromptPanel'
import { ResultsPanel } from './ResultsPanel'
import { SpotTheBug } from './SpotTheBug'
import { Trace } from './Trace'
import { HintButton } from './HintButton'
import { FixPlanPanel } from './FixPlanPanel'

afterEach(cleanup)
const exercise: ExercisePublic = {
  id: 'one', cloId: 'clo', language: 'javascript', kind: 'code', difficulty: 3, pattern: 'guard',
  title: 'Check a name', prompt: 'Return `true` for a valid name.\n\n<script>bad()</script>',
  starterCode: 'const x = 1\nreturn x', origin: 'seed', tags: [],
  tests: [{ id: 'visible', input: '[1]', expected: 'true', hidden: false, name: 'Example' }, { id: 'secret', input: 'secret-input', expected: 'secret-answer', hidden: true, name: 'secret-name' }],
}
describe('exercise panels', () => {
  it('tolerates malformed partial fields until the terminal diagnosis arrives', () => {
    const { rerender } = render(<FixPlanPanel diagnosis={null} partialDiagnosis={{ intent: {} as string, rootCause: [] as unknown as string, fixPlan: 'unfinished' as unknown as string[] }} hints={[]} partialHint={{ hint: {} as string }} />)
    expect(screen.getByRole('region', { name: 'Fix plan' })).toBeTruthy()
    rerender(<FixPlanPanel diagnosis={{ intent: 'Find a value.', rootCause: 'A return is missing.', mistakeLabel: 'missing-return', fixPlan: ['Read the path.', 'Return a value.', 'Run again.'] }} partialDiagnosis={null} hints={[]} partialHint={null} />)
    expect(screen.getByText('A return is missing.')).toBeTruthy()
  })
  it('shows visible examples but never hidden tests or active prompt HTML', () => {
    const { container } = render(<PromptPanel exercise={exercise} />)
    expect(screen.getByText('[1]')).toBeTruthy()
    expect(container.textContent).not.toContain('secret-')
    expect(container.querySelector('script')).toBeNull()
  })
  it('does not disclose the graded answer as a visible non-code example', () => {
    const { container } = render(<PromptPanel exercise={{ ...exercise, kind: 'predict-output', tests: [{ id: 'answer', input: '', expected: 'the-answer', hidden: false }] }} />)
    expect(container.textContent).not.toContain('the-answer')
  })
  it('hides hidden-result names, actual, expected, stdout and stderr', () => {
    const { container } = render(<ResultsPanel exercise={exercise} results={[{ testId: 'secret', passed: false, actual: 'secret-actual', expected: 'secret-answer', stdout: 'secret-stdout', stderr: 'secret-stderr', durationMs: 3, failureKind: 'wrong-answer' }]} stdout="" stderr="" status="failed" />)
    expect(container.textContent).toContain('Hidden test')
    expect(container.textContent).not.toContain('secret-')
  })
  it('toggles bug lines as a set with accessible keyboard buttons', () => {
    const changed = vi.fn()
    const { rerender } = render(<SpotTheBug snippet={exercise.starterCode} value="[]" onChange={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Line 2' }))
    expect(changed).toHaveBeenLastCalledWith('[2]')
    rerender(<SpotTheBug snippet={exercise.starterCode} value="[2]" onChange={changed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Line 2' }))
    expect(changed).toHaveBeenLastCalledWith('[]')
  })
  it('renders empty trace cells and serializes the typed values', () => {
    const changed = vi.fn()
    render(<Trace snippet="x += 1" variables={['x', 'total']} value="{}" onChange={changed} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'x' }), { target: { value: '3' } })
    expect(changed).toHaveBeenLastCalledWith('{"x":"3"}')
    expect((screen.getByRole('textbox', { name: 'total' }) as HTMLInputElement).value).toBe('')
  })
  it('only requests a hint when enabled and clicked, and caps the control at five', () => {
    const request = vi.fn()
    const { rerender } = render(<HintButton available={false} waitSeconds={42} count={0} busy={false} onRequest={request} />)
    fireEvent.click(screen.getByRole('button'))
    expect(request).not.toHaveBeenCalled()
    rerender(<HintButton available waitSeconds={0} count={0} busy={false} onRequest={request} />)
    fireEvent.click(screen.getByRole('button'))
    expect(request).toHaveBeenCalledTimes(1)
    rerender(<HintButton available waitSeconds={0} count={5} busy={false} onRequest={request} />)
    fireEvent.click(screen.getByRole('button'))
    expect(request).toHaveBeenCalledTimes(1)
  })
})
