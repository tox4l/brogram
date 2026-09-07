import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeGuide, GUIDE_LINE_HEIGHT_PX, type GuideSpan } from './CodeGuide'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CODE = 'line one\nline two\nline three\nline four'

afterEach(() => {
  cleanup()
})

/** Everything CodeGuide renders that is not the `<pre>` itself is
 *  `aria-hidden`, tagged with `data-guide` for these tests to select by. */
function guideEl(container: HTMLElement, kind: 'band' | 'rail' | 'underline' | 'passive'): HTMLElement | null {
  return container.querySelector(`[data-guide="${kind}"]`)
}

describe('CodeGuide', () => {
  it('active: null renders no band, rail or underline element at all', () => {
    const { container } = render(
      <CodeGuide code={CODE} language="python" active={null} reduced={false} label="Code" idPrefix="g1" />,
    )
    expect(guideEl(container, 'band')).toBeNull()
    expect(guideEl(container, 'rail')).toBeNull()
    expect(guideEl(container, 'underline')).toBeNull()
    // The code itself is still rendered and accessible.
    expect(container.textContent).toContain('line one')
  })

  it('the code text stays out of aria-hidden; the band, rail and passive tints are aria-hidden', () => {
    const { container } = render(
      <CodeGuide
        code={CODE}
        language="python"
        active={{ line: 1 }}
        passive={[{ line: 2 }]}
        reduced={false}
        label="Code"
        idPrefix="g2"
      />,
    )
    const pre = container.querySelector('pre')
    expect(pre?.closest('[aria-hidden="true"]')).toBeNull()
    expect(guideEl(container, 'band')?.getAttribute('aria-hidden')).toBe('true')
    expect(guideEl(container, 'rail')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('the band and rail carry no border, ring or radius classes -- a scaled edge stays a straight edge', () => {
    const { container } = render(
      <CodeGuide code={CODE} language="python" active={{ line: [2, 4] }} reduced={false} label="Code" idPrefix="g3" />,
    )
    const band = guideEl(container, 'band')!
    const rail = guideEl(container, 'rail')!
    for (const el of [band, rail]) {
      expect(el.className).not.toMatch(/ring|rounded|shadow|border/)
      expect(el.style.borderWidth).toBe('')
      expect(el.style.boxShadow).toBe('')
    }
    // A 3-line span (lines 2-4) scales the band/rail by 3, transform-only.
    expect(band.style.transform).toBe(`translateY(${GUIDE_LINE_HEIGHT_PX}px) scaleY(3)`)
    expect(rail.style.transform).toBe(band.style.transform)
  })

  it('the band transition is exactly "transform 200ms var(--ease-move)", never all/top/height/ease-in', () => {
    const { container } = render(
      <CodeGuide code={CODE} language="python" active={{ line: 1 }} reduced={false} label="Code" idPrefix="g4" />,
    )
    const band = guideEl(container, 'band')!
    expect(band.style.transition).toBe('transform 200ms var(--ease-move)')
    expect(band.style.transition).not.toMatch(/all|top|height|ease-in/)
  })

  it('reduced motion: transition becomes "none", but the transform is byte-identical to motion-on -- the band still lands on the right lines', () => {
    const active: GuideSpan = { line: [2, 3] }
    const full = render(<CodeGuide code={CODE} language="python" active={active} reduced={false} label="Code" idPrefix="g5a" />)
    const reduced = render(<CodeGuide code={CODE} language="python" active={active} reduced label="Code" idPrefix="g5b" />)

    const fullBand = guideEl(full.container, 'band')!
    const reducedBand = guideEl(reduced.container, 'band')!
    expect(reducedBand.style.transform).toBe(fullBand.style.transform)
    expect(fullBand.style.transition).toBe('transform 200ms var(--ease-move)')
    expect(reducedBand.style.transition).toBe('none')

    full.unmount()
    reduced.unmount()
  })

  it('a step whose say holds one uniquely-resolving token renders an underline at the matching column', () => {
    // "two" appears exactly once across the span's own line range (line 2).
    const { container } = render(
      <CodeGuide code={CODE} language="python" active={{ line: 2, token: 'two' }} reduced={false} label="Code" idPrefix="g6" />,
    )
    const underline = guideEl(container, 'underline')!
    expect(underline).not.toBeNull()
    const column = 'line two'.indexOf('two')
    expect(underline.style.transform).toBe(`translateX(${column}ch) scaleX(3)`)
    expect(underline.style.left).toBe('16px')
  })

  it('a token absent from the line range renders no underline, and does not throw', () => {
    expect(() =>
      render(<CodeGuide code={CODE} language="python" active={{ line: 1, token: 'nowhere' }} reduced={false} label="Code" idPrefix="g7" />),
    ).not.toThrow()
    const { container } = render(
      <CodeGuide code={CODE} language="python" active={{ line: 1, token: 'nowhere' }} reduced={false} label="Code" idPrefix="g7b" />,
    )
    expect(guideEl(container, 'underline')).toBeNull()
  })

  it('a token matching more than once in the range falls back to line level, and does not throw', () => {
    // "line" occurs on every line -- ambiguous across a 2-line span.
    const { container } = render(
      <CodeGuide code={CODE} language="python" active={{ line: [1, 2], token: 'line' }} reduced={false} label="Code" idPrefix="g8" />,
    )
    expect(guideEl(container, 'underline')).toBeNull()
    expect(guideEl(container, 'band')).not.toBeNull()
  })

  it('passive spans render a static tint at a lighter alpha than the active band, with no rail', () => {
    const { container } = render(
      <CodeGuide code={CODE} language="python" active={null} passive={[{ line: 1 }, { line: [3, 4] }]} reduced={false} label="Code" idPrefix="g9" />,
    )
    const tints = container.querySelectorAll('[data-guide="passive"]')
    expect(tints.length).toBe(2)
    expect(guideEl(container, 'rail')).toBeNull()
  })

  it('never imports GSAP', () => {
    const source = fs.readFileSync(path.join(HERE, 'CodeGuide.tsx'), 'utf8')
    expect(source).not.toMatch(/from ['"]gsap|require\(['"]gsap/i)
  })

  it('no setInterval or setTimeout anywhere in the guide or the worked-example advance path', () => {
    for (const file of ['CodeGuide.tsx', 'WorkedBlock.tsx']) {
      const source = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(source).not.toMatch(/setInterval\(|setTimeout\(/)
    }
  })
})
