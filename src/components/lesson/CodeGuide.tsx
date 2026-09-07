import type { Language } from '@/lib/contracts'

export type GuideSpan = {
  /** 1-based, inclusive. A number is a single line. */
  line: number | [number, number]
  /** Optional literal to underline, resolved inside the span's line range. */
  token?: string
}

export interface CodeGuideProps {
  /** The block's source, exactly as authored. */
  code: string
  /** For the mono theme only -- no tokenizer runs. */
  language: Language
  /** The stepped band. `null` renders no band element at all -- the seam a
   *  later guidance-fading or execution-trace feature would use. */
  active: GuideSpan | null
  /** Static tints at 60% of the active alpha (`LessonSnippet.highlight`). */
  passive?: GuideSpan[]
  /** The resolved boolean, never a media query. */
  reduced: boolean
  /** Accessible label for the surrounding region. */
  label: string
  /** For aria-controls / aria-describedby wiring. */
  idPrefix: string
}

/** Matches `WorkedBlock`'s fixed row height (spec 7.1: "a fixed 24 px
 *  LINE_HEIGHT_PX"). Exported so a caller building a `GuideSpan.line` from a
 *  pixel measurement, or a test asserting on the geometry, shares the same
 *  number rather than re-guessing it. */
export const GUIDE_LINE_HEIGHT_PX = 24
/** Matches the `<pre>`'s own `p-4` (16px) padding, so the band's `top` and
 *  the underline's `left` both start flush with the first character. */
const CODE_PAD_PX = 16

function lineRange(line: number | [number, number]): [number, number] {
  return Array.isArray(line) ? line : [line, line]
}

/** Ruling W4.20: the transition is CSS, exactly `transform 200ms
 *  var(--ease-move)`, never GSAP or Flip -- a transition retargets mid-flight
 *  when a learner clicks fast, a tween restarts from zero. Under `reduced`,
 *  `transition: none` and nothing else: the transform below is computed
 *  identically either way, so the band and underline still land on the
 *  correct lines, just without the animated move. */
function guideTransition(reduced: boolean): string {
  return reduced ? 'none' : 'transform 200ms var(--ease-move)'
}

/** `top: CODE_PAD_PX` never moves -- only `transform: translateY() scaleY()`
 *  does, so the browser only ever composites (spec 7.8's timing law bans
 *  animating `top`/`height`). */
function bandTransform(span: GuideSpan): string {
  const [start, end] = lineRange(span.line)
  return `translateY(${(start - 1) * GUIDE_LINE_HEIGHT_PX}px) scaleY(${end - start + 1})`
}

/**
 * Resolves a `GuideSpan.token` to the exact line and column it occurs at --
 * but only when it occurs **exactly once** across every line in the span's
 * own range. Any other case (absent, or matching zero or several times)
 * returns `null`, and the caller falls back to line-level guidance and never
 * throws (spec 7.2).
 */
function resolveToken(lines: string[], span: GuideSpan): { line: number; column: number; length: number } | null {
  if (!span.token) return null
  const [start, end] = lineRange(span.line)
  const hits: { line: number; column: number }[] = []
  for (let lineNumber = start; lineNumber <= end; lineNumber++) {
    const text = lines[lineNumber - 1] ?? ''
    let from = 0
    for (;;) {
      const at = text.indexOf(span.token, from)
      if (at === -1) break
      hits.push({ line: lineNumber, column: at })
      from = at + 1
    }
  }
  return hits.length === 1 ? { ...hits[0], length: span.token.length } : null
}

/**
 * The shared reading surface for a lesson code block (spec 7.2, ruling
 * W4.19): a plain `<pre>` (no CodeMirror, no tokenizer) plus, layered over
 * it, a stepped `active` band, any static `passive` tints, and -- when a
 * step's `say` names exactly one literal that resolves uniquely in its own
 * line range -- a token-level underline.
 *
 * The band is two absolutely-positioned children, both `transform`-only: a
 * `bg-guide/12` tint and a 2px `--guide` rail at `left: 8px`. No
 * `ring-1 ring-inset`, no `rounded-md` -- the old ring's 1px edge and corner
 * radius were both scaled by `scaleY(n)` along with everything else, so a
 * three-line step rendered 3px edges and a smeared radius (the most
 * generated-looking detail in the build, per the spec). A borderless tint
 * plus a rail is undistorted at any scale.
 *
 * Deliberately headless on outer chrome: the returned wrapper is `relative`
 * only, with no border, radius or fill of its own -- `WorkedBlock` and
 * `SnippetBlock` each already own a differently-shaped bordered container
 * (one wraps just the code; the other shares one border with a caption/run
 * footer below it), and a second nested border here would double up against
 * either one.
 */
export function CodeGuide({ code, language, active, passive, reduced, label, idPrefix }: CodeGuideProps) {
  const lines = code.split('\n')
  const transition = guideTransition(reduced)
  const activeToken = active ? resolveToken(lines, active) : null

  return (
    <div id={idPrefix} role="group" aria-label={label} data-language={language} className="relative">
      <pre className="relative z-10 overflow-x-auto bg-muted/30 p-4 font-mono text-sm leading-6">
        <code>
          {lines.map((line, index) => <div key={index}>{line || ' '}</div>)}
        </code>
      </pre>

      {passive?.map((span, index) => (
        <div
          key={index}
          aria-hidden="true"
          data-guide="passive"
          className="pointer-events-none absolute inset-x-2 bg-guide/[7.2%]"
          style={{
            top: CODE_PAD_PX,
            height: GUIDE_LINE_HEIGHT_PX,
            transformOrigin: 'top',
            transform: bandTransform(span),
          }}
        />
      ))}

      {active && (
        <>
          <div
            aria-hidden="true"
            data-guide="band"
            className="pointer-events-none absolute inset-x-2 bg-guide/12"
            style={{
              top: CODE_PAD_PX,
              height: GUIDE_LINE_HEIGHT_PX,
              transformOrigin: 'top',
              transform: bandTransform(active),
              transition,
            }}
          />
          <div
            aria-hidden="true"
            data-guide="rail"
            className="pointer-events-none absolute left-2 w-0.5 bg-guide"
            style={{
              top: CODE_PAD_PX,
              height: GUIDE_LINE_HEIGHT_PX,
              transformOrigin: 'top',
              transform: bandTransform(active),
              transition,
            }}
          />
        </>
      )}

      {activeToken && (
        <div
          aria-hidden="true"
          data-guide="underline"
          className="pointer-events-none absolute h-0.5 bg-guide"
          style={{
            left: CODE_PAD_PX,
            top: CODE_PAD_PX + (activeToken.line - 1) * GUIDE_LINE_HEIGHT_PX + (GUIDE_LINE_HEIGHT_PX - 6),
            width: '1ch',
            transformOrigin: 'left',
            transform: `translateX(${activeToken.column}ch) scaleX(${activeToken.length})`,
            transition,
          }}
        />
      )}
    </div>
  )
}
