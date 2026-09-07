import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExercisePublic } from '@/lib/contracts'
import { PredictOutput } from './PredictOutput'
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
  // Fix round I2: hover/focus-visible were `bg-muted`, byte-identical to this list's own
  // `bg-lesson-code-surface` ground in Folio -- a Folio learner got no hover response at all.
  it('puts the line hover/focus-visible state on --rule, not --muted (fix round I2)', () => {
    render(<SpotTheBug snippet={exercise.starterCode} value="[]" onChange={vi.fn()} />)
    const line = screen.getByRole('button', { name: 'Line 1' })
    expect(line.className).toContain('hover:bg-rule')
    expect(line.className).toContain('focus-visible:bg-rule')
    expect(line.className).not.toContain('hover:bg-muted')
    expect(line.className).not.toContain('focus-visible:bg-muted')
  })
  // Fix round M2 (Ruling W4.12): the editor kills ligatures on `.cm-scroller`; every other place
  // this screen renders Geist Mono on the code surface needs the same fix, or `!=` renders as a
  // glyph in the brief that is not on the learner's keyboard while the editor beside it shows the
  // real two characters.
  describe('ligatures stay off everywhere code renders (fix round M2)', () => {
    const noLigatures = "[font-feature-settings:'liga'_0,_'calt'_0]"
    it('on the brief\'s fenced code blocks and inline code chips', () => {
      const { container } = render(<PromptPanel exercise={{ ...exercise, prompt: 'Check `a != b`.\n\n```\na != b\n```' }} />)
      expect(container.querySelector('pre')?.className).toContain(noLigatures)
      expect(container.querySelector('code')?.className).toContain(noLigatures)
    })
    it('on the predict-output snippet', () => {
      const { container } = render(<PredictOutput snippet="a != b" value="" onChange={vi.fn()} />)
      expect(container.querySelector('pre')?.className).toContain(noLigatures)
    })
    it('on the trace snippet', () => {
      const { container } = render(<Trace snippet="a != b" variables={[]} value="{}" onChange={vi.fn()} />)
      expect(container.querySelector('pre')?.className).toContain(noLigatures)
    })
    it('on both run-output blocks', () => {
      const { container } = render(<ResultsPanel exercise={exercise} results={[]} stdout="a != b" stderr="c != d" status="ready" />)
      const blocks = container.querySelectorAll('pre')
      expect(blocks.length).toBe(2)
      blocks.forEach((block) => expect(block.className).toContain(noLigatures))
    })
    it('on the spot-the-bug line list', () => {
      render(<SpotTheBug snippet="a != b" value="[]" onChange={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Line 1' }).className).toContain(noLigatures)
    })
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
