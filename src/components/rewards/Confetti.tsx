'use client'

/**
 * The only place `canvas-confetti` is imported anywhere in this tree (brief
 * step 6): a plain dynamic `import()`, never a static `import` at the top
 * of a module, so the ~6KB library never rides any route's initial chunk
 * regardless of which page happens to mount `<Celebration />`.
 *
 * Fix round 2, C1: this used to be a React component (`<ConfettiBurst>`)
 * whose "same trigger never fires twice" guard was a per-mount `useRef`.
 * `<Celebration />` remounts on every route change, and an item queued but
 * never shown deliberately survives a route change (see
 * `useCelebration.ts`'s `clearShownCelebrations`), so a fresh mount got a
 * fresh ref and burst a second time for the same item. There is now no
 * component and no ref at all: `fireConfetti` is a plain function, called
 * at most once per item because the caller checks
 * `markConfettiFired(item.id)` (the store, not a component) before calling
 * it -- see `Celebration.tsx`'s queue-watching effect.
 */
export interface ConfettiOrigin {
  x: number
  y: number
}

/**
 * `reducedMotion` is the one resolved boolean from `useReducedMotion()`
 * (OS signal plus the in-app override) -- checked BEFORE the dynamic
 * import even starts, never left to the library's own `disableForReducedMotion`
 * alone, because that flag only ever sees the OS-level media query, not a
 * learner who set `wellness.prefs.motion = 'reduced'` on an OS with no
 * preference (R7.9's load-bearing case). `disableForReducedMotion: true` is
 * still passed through as defense in depth.
 */
export function fireConfetti(reducedMotion: boolean, origin?: ConfettiOrigin): void {
  if (reducedMotion) return
  void import('canvas-confetti').then(({ default: confetti }) => {
    confetti({
      particleCount: 60,
      spread: 55,
      origin: origin ?? { x: 0.5, y: 0.35 },
      disableForReducedMotion: true,
    })
  })
}

/** Converts an element's bounding rect into the `{x, y}` fraction-of-viewport
 *  origin `fireConfetti` wants, so a burst can appear to come from the
 *  result panel or the trophy shelf rather than always the same fixed point. */
export function originFromRect(rect: DOMRect | null | undefined): ConfettiOrigin | undefined {
  if (!rect || typeof window === 'undefined') return undefined
  return { x: (rect.left + rect.width / 2) / window.innerWidth, y: rect.top / window.innerHeight }
}
