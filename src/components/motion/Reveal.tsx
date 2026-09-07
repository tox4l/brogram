'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { DUR, STAGGER } from '@/lib/motion/tokens'
import { loadGsap, type LoadedGsap } from '@/lib/motion/eases'

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

// `useLayoutEffect` warns when it runs during SSR; Next still evaluates
// this "use client" module's top level on the server. Same guard
// `@gsap/react`'s own `useIsomorphicLayoutEffect` uses.
const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect

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
 * W4FIX-B: gsap (and `SplitText`) are no longer imported at module scope --
 * `loadGsap()` (`src/lib/motion/eases.ts`) is called from inside the effect
 * below, on first mount of a non-reduced-motion `<Reveal>`, and never at
 * all under reduced motion (ruling W4FIX-B.1c: a reduced-motion learner
 * never requests the gsap chunk). This replaces the old `useGSAP` call --
 * `@gsap/react`'s own source imports `gsap` at ITS module top level (there
 * is no way to `useGSAP()` without gsap already being resolved), so keeping
 * that hook would have kept gsap in this component's synchronous import
 * graph regardless of what `eases.ts` did. The effect below hand-rolls the
 * same guarantees `useGSAP` gave for this one narrow case (mount-scoped
 * split + tween, reverted on unmount or when `mode`/`children` changes) via
 * a `cancelled` flag plus `split.revert()`.
 *
 * `autoSplit: true` with `onSplit` re-splits on font load and resize --
 * mandatory, because a serif line measured before its webfont lands is the
 * wrong line.
 *
 * `mask: 'lines'` only ever masks `mode="lines"` -- `SplitText` builds mask
 * wrappers from `this.lines`, which stays empty for `mode="words"` and
 * `mode="chars"`, so those two rely on the `opacity: 0 -> 1` half of their
 * tween (not a clip) to hide the pre-reveal state. Passing the literal
 * `{ type, mask: 'lines', ... }` for every mode is spec-faithful (W4 §5.2);
 * it is a documented no-op for the two unmasked modes, not a bug.
 *
 * W4FIX-B fix round (F2): the `loadGsap()` call is scheduled inside a
 * `requestAnimationFrame`, not fired in the same commit that runs this
 * effect. Reason: `useReducedMotion()`'s `getServerSnapshot()` returns
 * `false` (there is no way to know the OS preference on the server), so
 * React's hydration commit always has `reduced === false` even for a
 * reduced-motion learner -- the real value lands one tick later, this
 * effect re-runs, and `cancelled` stops the split, but by then a
 * synchronous `loadGsap()` call already had every `import()` in flight. The
 * one-frame defer gives that correcting re-render a chance to cancel the
 * scheduled frame (via `cancelAnimationFrame`, in the cleanup below) before
 * any network request starts, so a reduced-motion learner never requests
 * the gsap chunk at all -- only a learner whose resolved preference is
 * still "motion on" one frame after mount actually pays for it.
 *
 * This is also a `'use client'` component that Next server-renders, so the
 * final text paints once before hydration runs the split/tween at all. The
 * span renders `data-reveal="pending"` plus `visibility: hidden` inline
 * (never `mode="chars"`/`"words"`/`"lines"` at final position on first
 * paint) and the effect below clears both, unconditionally, as its first
 * synchronous act -- *above* the `reduced` early return and *before* the
 * (now async) gsap load, so a reduced-motion learner whose `reduced` prop
 * resolves differently between the server snapshot and the client is
 * unhidden too and never left blank, and nobody sits behind a network
 * fetch waiting to become visible (Ruling W4.15).
 */
export function Reveal({ mode, reduced, children, surface, className }: RevealProps) {
  if (mode === 'chars' && process.env.NODE_ENV !== 'production' && !(surface && CHARS_LICENSED_SURFACES.includes(surface))) {
    throw new Error(`<Reveal mode="chars"> is licensed for onboarding-hook and level-up only (W4.14); got surface=${String(surface)}`)
  }

  const ref = useRef<HTMLSpanElement>(null)

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    // Unhide unconditionally, before the `reduced` check and before gsap
    // has even started loading: a reduced-motion learner (or one still
    // waiting on the gsap chunk) must never be left showing the SSR
    // `visibility: hidden` state.
    if (el) {
      el.removeAttribute('data-reveal')
      el.style.visibility = ''
    }
    if (!el || reduced) return

    let cancelled = false
    let split: { revert: () => void } | undefined
    let loadedGsap: LoadedGsap['gsap'] | undefined
    // M4: tweens `onSplit` creates used to be owned (and killed on
    // unmount/re-run) by `useGSAP`'s context. The hand-rolled effect only
    // ever called `split.revert()`, which restores the markup but left the
    // tween itself ticking on detached nodes for up to `DUR.slow`. Collect
    // what `onSplit` returns and kill it explicitly before reverting.
    const tweens: Array<{ kill: () => void } | undefined> = []

    // F2: two frames of deferral -- see the module doc above for why this
    // has to happen after the commit, not inside it. One frame is not
    // enough: `requestAnimationFrame` runs before the browser paints, while
    // the `useSyncExternalStore` correction that flips `reduced` to its
    // real value fires from a passive effect, which React runs only after
    // that paint -- one rAF still lands before it. A second rAF waits for
    // a full additional paint cycle, which is after the passive-effect
    // flush in every engine this was verified against (measured live: a
    // single rAF still let a reduced-motion learner's build request all
    // three gsap chunks on /login; two does not).
    function startLoad() {
      loadGsap()
        .then(({ gsap, SplitText }: LoadedGsap) => {
          if (cancelled || !el) return
          loadedGsap = gsap

          if (mode === 'fade') {
            gsap.killTweensOf(el)
            gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: DUR.base / 1000, ease: 'enter' })
            return
          }

          split = SplitText.create(el, {
            type: mode,
            mask: 'lines',
            aria: 'auto',
            autoSplit: true,
            onSplit: (self: SplitParts) => {
              if (cancelled) return
              const targets = mode === 'lines' ? self.lines : mode === 'words' ? self.words : self.chars
              const n = Math.max(targets.length, 1)
              const stagger = Math.min(STAGGER.step / 1000, STAGGER.max / 1000 / n)
              const tween =
                mode === 'lines'
                  ? gsap.from(targets, { yPercent: 110, duration: DUR.slow / 1000, ease: 'enter', stagger })
                  : gsap.from(targets, { yPercent: 40, opacity: 0, duration: DUR.base / 1000, ease: 'enter', stagger })
              tweens.push(tween)
              return tween
            },
          })
        })
        // M1: a stale chunk hash across a deploy makes this reject. These
        // components already render correct, visible, unanimated content
        // when the load never resolves, so a chunk failure is silent, not
        // an unhandled rejection in every viewer's console.
        .catch(() => {})
    }

    let raf2 = 0
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return
        startLoad()
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      cancelAnimationFrame(raf2)
      tweens.forEach((tween) => tween?.kill())
      split?.revert()
      if (mode === 'fade' && el) {
        loadedGsap?.killTweensOf(el)
        // M3: `killTweensOf` stops the tween but leaves the inline opacity
        // it last wrote (e.g. mid-fade at `reduced`'s flip) -- `useGSAP`'s
        // `context.revert()` used to clear that. Without this, the element
        // freezes at whatever opacity it was mid-fade, permanently, until
        // the next remount.
        el.style.opacity = ''
      }
    }
  }, [mode, reduced, children])

  return (
    <span ref={ref} className={className} data-reveal={reduced ? undefined : 'pending'} style={reduced ? undefined : { visibility: 'hidden' }}>
      {children}
    </span>
  )
}
