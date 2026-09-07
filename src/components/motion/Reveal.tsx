'use client'

import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { DUR, STAGGER } from '@/lib/motion/tokens'

export type RevealMode = 'lines' | 'words' | 'chars' | 'fade'
export type RevealSurface = 'onboarding-hook' | 'level-up'

export interface RevealProps {
  mode: RevealMode
  /** The resolved boolean from `useReducedMotion()` -- never a media query
   *  read directly by this component (R7.9). */
  reduced: boolean
  /** Text only, on purpose: `aria: 'auto'` (below) puts the original string
   *  in an `aria-label` on the wrapper and `aria-hidden` on every generated
   *  span, so a link or `<code>` element inside the split subtree would be
   *  silenced from assistive tech. */
  children: string
  /** Required, and checked, when `mode="chars"` (W4.14). */
  surface?: RevealSurface
  className?: string
}

const CHARS_LICENSED_SURFACES: readonly RevealSurface[] = ['onboarding-hook', 'level-up']

type SplitParts = { lines: Element[]; words: Element[]; chars: Element[] }

/**
 * The one rationed text reveal (W4 §5.2, ruling W4.14). Over
 * `SplitText.create({ mask: 'lines', aria: 'auto', autoSplit: true, onSplit })`:
 *
 * - `mode="lines"` is the house reveal -- masked, `yPercent: 110 -> 0`,
 *   `DUR.slow`, `EASE.enter` -- for the lesson hook/recap and any section
 *   heading that opens a screen. This is the one that reads as expensive.
 * - `mode="words"` for course and screen headings.
 * - `mode="chars"` -- the loudest "generated" tell in the vocabulary on
 *   body copy -- is licensed for exactly two surfaces in the entire
 *   product (`surface="onboarding-hook" | "level-up"`) and throws in
 *   development anywhere else.
 * - `mode="fade"` is everything not covered above: a plain opacity tween,
 *   no `SplitText` at all.
 *
 * Ruling W4.15: under reduced motion this never calls `SplitText.create`
 * (a split DOM with no animation is pure risk -- line boxes, selection,
 * copy/paste -- for zero gain) and `mode="fade"` never tweens either.
 * Children render at final opacity, unsplit, on first paint either way.
 *
 * `autoSplit: true` with `onSplit` re-splits on font load and resize --
 * mandatory, because a serif line measured before its webfont lands is the
 * wrong line. `revertOnUpdate: true` on the underlying `useGSAP` call
 * matters here specifically: without it, a `mode`/`children` change would
 * call `SplitText.create` again on an element GSAP never reverted the
 * previous split from.
 */
export function Reveal({ mode, reduced, children, surface, className }: RevealProps) {
  if (mode === 'chars' && process.env.NODE_ENV !== 'production' && !(surface && CHARS_LICENSED_SURFACES.includes(surface))) {
    throw new Error(`<Reveal mode="chars"> is licensed for onboarding-hook and level-up only (W4.14); got surface=${String(surface)}`)
  }

  const ref = useRef<HTMLSpanElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el || reduced) return

      if (mode === 'fade') {
        gsap.killTweensOf(el)
        gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: DUR.base / 1000, ease: 'enter' })
        return
      }

      const split = SplitText.create(el, {
        type: mode,
        mask: 'lines',
        aria: 'auto',
        autoSplit: true,
        onSplit(self: SplitParts) {
          const targets = mode === 'lines' ? self.lines : mode === 'words' ? self.words : self.chars
          const n = Math.max(targets.length, 1)
          const stagger = Math.min(STAGGER.step / 1000, STAGGER.max / 1000 / n)
          return mode === 'lines'
            ? gsap.from(targets, { yPercent: 110, duration: DUR.slow / 1000, ease: 'enter', stagger })
            : gsap.from(targets, { yPercent: 40, opacity: 0, duration: DUR.base / 1000, ease: 'enter', stagger })
        },
      })

      return () => split.revert()
    },
    { scope: ref, dependencies: [mode, reduced, children], revertOnUpdate: true },
  )

  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  )
}
