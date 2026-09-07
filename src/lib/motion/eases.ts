'use client'

import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { CustomEase } from 'gsap/CustomEase'
import { SplitText } from 'gsap/SplitText'
import { Flip } from 'gsap/Flip'
import { bezierTuple } from '@/components/rewards/motionTokens'
import { EASE } from './tokens'

/**
 * Every GSAP plugin the app uses, registered once (W4 §5.6: "gsap.registerPlugin(...)
 * once, in a client module imported by the shell"). This module carries a
 * `'use client'` directive, but that marks a *boundary*, not an exemption
 * from evaluation -- Next still imports and runs this module's top level
 * during prerender/SSR, so `gsap.registerPlugin(...)` below and every
 * `CustomEase.create` call inside `registerEases()` do execute in the Node
 * runtime, once per build/SSR pass, not only in the browser. That is safe
 * only because registration and `CustomEase.create` are pure, DOM-free
 * bookkeeping -- no `window`, no `document`, no layout read -- so running
 * them on the server is inert rather than incorrect. `Providers` (the root
 * client boundary, T4.2) calls `registerEases()` once at module scope,
 * which is exactly why module scope is an acceptable place for the call.
 */
gsap.registerPlugin(useGSAP, CustomEase, SplitText, Flip)

let didRegister = false

/**
 * Creates one `CustomEase` per `EASE` token (W4 §5.1) so a GSAP tween and a
 * CSS `transition` on the same named motion read the *identical* curve.
 * Without this, `Celebration.tsx`/`XpCounter.tsx` running `power1/2.out`
 * while CSS runs `cubic-bezier(0.22, 1, 0.36, 1)` is two curves for one
 * named motion (`power2.out` at t=0.25 is 0.578; the `enter` curve, 0.765).
 *
 * `CustomEase.create` accepts the four CSS control points directly as a
 * comma-separated string, parsed via the `bezierTuple` helper that already
 * exists (`src/components/rewards/motionTokens.ts`) rather than re-parsing
 * the same `cubic-bezier(...)` literal a second way.
 *
 * Idempotent: safe to call more than once (StrictMode, HMR) -- re-creating
 * an already-registered id is a cheap no-op re-registration, and the guard
 * skips the repeat parse work entirely.
 */
export function registerEases(): void {
  if (didRegister) return
  didRegister = true
  for (const [name, value] of Object.entries(EASE)) {
    const [x1, y1, x2, y2] = bezierTuple(value)
    CustomEase.create(name, `${x1}, ${y1}, ${x2}, ${y2}`)
  }
}
