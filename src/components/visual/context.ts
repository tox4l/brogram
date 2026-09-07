/**
 * The module-level counter behind "one WebGL2 context ever" (wave 4 spec
 * §6.2 rule 1; plan T4.3 step 3). A renderer process caps live WebGL
 * contexts near 16 and kills the oldest on the 17th
 * (issues.chromium.org 40939743 / 40543269), and this app client-routes
 * dozens of times a session -- every `<ShaderSurface>` that ever decides to
 * go live shares this one counter, app-wide, for the lifetime of the tab.
 *
 * `ShaderField` calls `tryAcquireShaderContext()` once in a mount effect and
 * must call `releaseShaderContext()` in that same effect's cleanup. A second
 * concurrent mount -- route churn overlapping an unmounting instance, or a
 * stray extra `<ShaderSurface>` -- gets `false` back and renders nothing
 * (plan step 3: "the second concurrent mount returns null"), never a second
 * live `getContext('webgl2')` call.
 */
let activeContexts = 0

export function tryAcquireShaderContext(): boolean {
  if (activeContexts > 0) return false
  activeContexts += 1
  return true
}

export function releaseShaderContext(): void {
  activeContexts = Math.max(0, activeContexts - 1)
}

/**
 * Test-only escape hatch. This counter is deliberately real module state,
 * not React state, so it survives across every component in a test file --
 * a suite that exercises two independent mount/unmount cycles needs a way
 * to start clean rather than inheriting whatever the previous `it()` left
 * behind (or leaked, if that test's assertions threw before cleanup ran).
 */
export function resetShaderContextForTests(): void {
  activeContexts = 0
}
