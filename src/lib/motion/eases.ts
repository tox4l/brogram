import { bezierTuple } from '@/components/rewards/motionTokens'
import { EASE } from './tokens'

/**
 * W4FIX-B: gsap (plus `@gsap/react`, `gsap/CustomEase`, `gsap/SplitText`,
 * `gsap/Flip`) used to be imported at this module's top level, which made
 * this file's only consumer at the time -- `providers.tsx`, the root client
 * boundary every route mounts -- ride gsap and every plugin into the entry
 * chunk of every single route (confirmed: the gate's build put
 * `gsap.registerPlugin` in `0cn5acooblm1q.js`, listed in the root layout's
 * own `entryJSFiles`, present in literally every route's
 * `page_client-reference-manifest.js`, `/` and `/login` included). None of
 * gsap's ~137 KB (three chunks) belongs on a route that has not asked for
 * an animation yet.
 *
 * This module now imports nothing from the `gsap` package at the top
 * level -- `loadGsap()` is the only way in, and it dynamic-imports gsap and
 * every plugin exactly once (the promise is cached, so a burst of mounts in
 * the same paint -- a `<Reveal>` and the Flip-indicated dock both appearing
 * at once -- share one network fetch instead of firing several). Every
 * caller is expected to skip calling this entirely under reduced motion
 * (ruling W4FIX-B.1) -- a reduced-motion learner should never pay for the
 * gsap chunk at all, since nothing it does is going to animate for them.
 */
export type LoadedGsap = {
  gsap: typeof import('gsap').gsap
  SplitText: typeof import('gsap/SplitText').SplitText
  Flip: typeof import('gsap/Flip').Flip
}

let cached: Promise<LoadedGsap> | null = null

/**
 * Loads gsap + `@gsap/react` + the three plugins the app uses, registers
 * them with `gsap.registerPlugin`, and creates one `CustomEase` per `EASE`
 * token (so a gsap tween and a CSS `transition` on the same named motion
 * read the identical curve -- see the module doc this replaced). Cached:
 * every call after the first returns the same in-flight/resolved promise,
 * so registration and `CustomEase.create` only ever run once per page
 * session no matter how many components call this.
 */
export function loadGsap(): Promise<LoadedGsap> {
  if (!cached) {
    cached = Promise.all([
      import('gsap'),
      import('@gsap/react'),
      import('gsap/CustomEase'),
      import('gsap/SplitText'),
      import('gsap/Flip'),
    ]).then(([gsapMod, reactMod, customEaseMod, splitTextMod, flipMod]) => {
      const { gsap } = gsapMod
      const { CustomEase } = customEaseMod
      const { SplitText } = splitTextMod
      const { Flip } = flipMod
      gsap.registerPlugin(reactMod.useGSAP, CustomEase, SplitText, Flip)
      for (const [name, value] of Object.entries(EASE)) {
        const [x1, y1, x2, y2] = bezierTuple(value)
        CustomEase.create(name, `${x1}, ${y1}, ${x2}, ${y2}`)
      }
      return { gsap, SplitText, Flip }
    })
  }
  return cached
}

/**
 * Thin wrapper kept for the one call site (`Providers`, pre-W4FIX-B) that
 * used to call this eagerly at module scope to force-register on every
 * route. Nothing in the tree should still do that (registering everywhere
 * is exactly the bug this fix removes) -- this exists only so a stray
 * "register eases up front" caller from before the split still compiles
 * and still works, by kicking off the same lazy load. New call sites should
 * call `loadGsap()` directly and use its resolved `gsap` instance instead of
 * assuming some other module already registered one.
 */
export function registerEases(): Promise<LoadedGsap> {
  return loadGsap()
}
