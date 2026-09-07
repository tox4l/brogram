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
 *
 * `mask: 'lines'` only ever masks `mode="lines"` -- `SplitText` builds mask
 * wrappers from `this.lines`, which stays empty for `mode="words"` and
 * `mode="chars"`, so those two rely on the `opacity: 0 -> 1` half of their
 * tween (not a clip) to hide the pre-reveal state. Passing the literal
 * `{ type, mask: 'lines', ... }` for every mode is spec-faithful (W4 §5.2);
 * it is a documented no-op for the two unmasked modes, not a bug.
 *
 * Flash-then-animate guard: a re-split fires later, from `SplitText`'s own
 * resize/`fonts.ready` handlers, outside the window `useGSAP` holds its
 * ambient context open -- `onSplit` is wrapped in `contextSafe` so those
 * tweens are still registered on the context and get killed by
 * `context.revert()` on unmount instead of continuing to run.
 *
 * This is also a `'use client'` component that Next server-renders, so the
 * final text paints once before hydration runs the split/tween at all. The
 * span renders `data-reveal="pending"` plus `visibility: hidden` inline
 * (never `mode="chars"`/`"words"`/`"lines"` at final position on first
 * paint) and the `useGSAP` callback clears both, unconditionally, as its
 * first act -- *above* the `reduced` early return, so a reduced-motion
 * learner whose `reduced` prop resolves differently between the server
 * snapshot and the client is unhidden too and never left blank. (Ruling
 * W4.15 -- "text is at final opacity on first paint" -- is met for every
 * learner whose `reduced` prop is already correct at first render; the one
 * remaining gap, a server render that guesses "full motion" for a learner
 * who actually has `reduced` set, needs a blocking inline script in
 * `layout.tsx`, T4.0's file and a cross-task decision, to close entirely.)
 */
export function Reveal({ mode, reduced, children, surface, className }: RevealProps) {
  if (mode === 'chars' && process.env.NODE_ENV !== 'production' && !(surface && CHARS_LICENSED_SURFACES.includes(surface))) {
    throw new Error(`<Reveal mode="chars"> is licensed for onboarding-hook and level-up only (W4.14); got surface=${String(surface)}`)
  }

  const ref = useRef<HTMLSpanElement>(null)

  useGSAP(
    (_context, contextSafe) => {
      const el = ref.current
      // Unhide unconditionally, before the `reduced` check: a reduced-motion
      // learner must never be left showing the SSR `visibility: hidden`
      // state just because this branch returns early.
      if (el) {
        el.removeAttribute('data-reveal')
        el.style.visibility = ''
      }
      if (!el || reduced) return

      // `contextSafe` is typed optional (it is also exposed on the hook's
      // return value); `useGSAP` always supplies it to the callback in
      // practice, but the fallback keeps this branch honest under the type.
      const safe = contextSafe ?? (<T extends (...args: never[]) => unknown>(fn: T) => fn)

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
        onSplit: safe((self: SplitParts) => {
          const targets = mode === 'lines' ? self.lines : mode === 'words' ? self.words : self.chars
          const n = Math.max(targets.length, 1)
          const stagger = Math.min(STAGGER.step / 1000, STAGGER.max / 1000 / n)
          return mode === 'lines'
            ? gsap.from(targets, { yPercent: 110, duration: DUR.slow / 1000, ease: 'enter', stagger })
            : gsap.from(targets, { yPercent: 40, opacity: 0, duration: DUR.base / 1000, ease: 'enter', stagger })
        }),
      })

      return () => split.revert()
    },
    { scope: ref, dependencies: [mode, reduced, children], revertOnUpdate: true },
  )

  return (
    <span ref={ref} className={className} data-reveal={reduced ? undefined : 'pending'} style={reduced ? undefined : { visibility: 'hidden' }}>
      {children}
    </span>
  )
}
