'use client'

import { useEffect, useRef, useState } from 'react'
import { FRAGMENT_SHADER, VERTEX_SHADER } from './field.glsl'
import { releaseShaderContext, tryAcquireShaderContext } from './context'

/** Wave 4 spec §6.2 -- every number here is load-bearing and cited there. */
const SETTLE_MS = 4500 // motion stops inside SC 2.2.2's five seconds; no pause control is owed
const RENDER_SCALE = 0.5 // 0.5x CSS pixels, upscaled by CSS: 16x fewer fragments than DPR 2
const FPS_CAP = 30 // half the frames, half the fragments again
const FRAME_BUDGET_MS = 1000 / FPS_CAP

/** Exported so the test can assert this exact object against a fake `getContext`. */
export const SHADER_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: true, // the frozen last frame must survive rAF stopping
  powerPreference: 'low-power',
  failIfMajorPerformanceCaveat: true, // fail over to the CSS floor rather than software-rasterise
}

export interface ShaderFieldProps {
  preset: 'aurora'
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

/**
 * Reads a CSS custom property's *rendered* colour, not its source text.
 * `getComputedStyle` serialises colour functions inconsistently across
 * engines (some report the `oklch()` right back, some convert), so instead
 * this paints the token onto a 1x1 canvas -- Canvas 2D's `fillStyle` parser
 * understands `oklch()` per CSS Color 4 and always normalises through the
 * canvas's own colour space (sRGB by default) -- then reads the pixel back
 * with `getImageData`, which is 8-bit sRGB everywhere. Read once at init
 * only (spec rule 3), never on a timer, never per frame.
 */
function readTokenColor(varName: string): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return [0, 0, 0]
  const probe = document.createElement('canvas')
  probe.width = 1
  probe.height = 1
  const ctx2d = probe.getContext('2d')
  if (!ctx2d) return [0, 0, 0]
  ctx2d.fillStyle = raw
  ctx2d.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx2d.getImageData(0, 0, 1, 1).data
  return [r / 255, g / 255, b / 255]
}

/** Fix round 1, dashboard/page.tsx's I6: a missing `navigator.connection`
 *  reads as "no signal either way", never as a reason to bail. */
function prefersLessData(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return conn?.saveData === true
}

/**
 * The lazy chunk: `~4 KB of hand-rolled WebGL2 plus ~1 KB of GLSL`, mounted
 * only by `ShaderSurface` when motion is not reduced and the resolved theme
 * is `eclipse` (spec §6.1, plan T4.3 step 1) -- this component itself does
 * not re-check either condition, by design, so it stays a pure rendering
 * concern and `ShaderSurface` stays the single place that decision is made.
 *
 * Contract (spec §6.2, in the order it happens):
 * 1. Acquire the one-context-ever singleton (`context.ts`). A denied mount
 *    renders nothing -- never a second live WebGL2 context, and never a
 *    second `<canvas>` element either (there is exactly one on screen for
 *    this component at any moment, live or frozen, see below).
 * 2. Bail before creating anything on a save-data connection.
 * 3. `getContext('webgl2', SHADER_CONTEXT_ATTRIBUTES)`; a `null` context
 *    (old Safari, a software-only GPU that refuses per
 *    `failIfMajorPerformanceCaveat`) is not a layout branch -- the CSS
 *    floor `ShaderSurface` already painted underneath is the final look.
 * 4. Render at `RENDER_SCALE` CSS pixels via a `ResizeObserver`,
 *    `devicePixelRatio` ignored, capped at `FPS_CAP`, gated on
 *    `IntersectionObserver` and `document.visibilityState`.
 * 5. At `SETTLE_MS`: stop the loop, snapshot the live canvas's pixels into
 *    an in-memory (never DOM-attached) 2D canvas, unmount the GL canvas,
 *    lose its context, and mount a plain 2D `<canvas>` in its place whose
 *    ref callback paints that snapshot in synchronously -- during React's
 *    commit, before the browser's next paint -- so the swap is pixel-for-
 *    pixel seamless with no flash and, unlike a WebGL canvas that stays
 *    mounted (a canvas element cannot change context type once one has
 *    been requested, so the frozen surface cannot just be the same
 *    element), never two `<canvas>` nodes on screen at once.
 */
export default function ShaderField({ preset }: ShaderFieldProps) {
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const snapshotRef = useRef<HTMLCanvasElement | null>(null)
  const acquiredRef = useRef(false)
  const [acquired, setAcquired] = useState(false)
  const [ready, setReady] = useState(false)
  const [frozen, setFrozen] = useState(false)

  // Acquired in an effect, never a `useState` lazy initializer -- Strict
  // Mode double-invokes lazy initializers with no matching cleanup, which
  // would silently leak the module counter. An effect + its own cleanup
  // stays correct even under Strict Mode's mount/unmount/mount replay,
  // because acquire and release are always paired within one effect run.
  //
  // `setAcquired(acquiredRef.current)` reads the just-written ref rather
  // than the plain local `ok`: the React Compiler lint
  // (`react-hooks/set-state-in-effect`) allows a setState call whose
  // argument is ref-derived (the documented "force update / external sync"
  // escape hatch -- `node_modules/eslint-plugin-react-hooks`'s own
  // `enableAllowSetStateFromRefsInEffects` analysis), which is exactly what
  // this is: `context.ts`'s module counter is state outside React, and this
  // ref is that external result flowing into React state.
  useEffect(() => {
    acquiredRef.current = tryAcquireShaderContext()
    setAcquired(acquiredRef.current)
    return () => {
      if (acquiredRef.current) releaseShaderContext()
    }
  }, [])

  useEffect(() => {
    if (!acquired || frozen) return
    if (prefersLessData()) return // bail before creating anything (spec rule 8)

    const canvas = glCanvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl2', SHADER_CONTEXT_ATTRIBUTES)
    if (!gl) return // -> the CSS floor is the final look; no layout branch

    const program = createProgram(gl)
    if (!program) return
    gl.useProgram(program)

    const uResolution = gl.getUniformLocation(program, 'uResolution')
    const uTime = gl.getUniformLocation(program, 'uTime')
    const uColorA = gl.getUniformLocation(program, 'uColorA')
    const uColorB = gl.getUniformLocation(program, 'uColorB')
    gl.uniform3fv(uColorA, readTokenColor('--shader-a'))
    gl.uniform3fv(uColorB, readTokenColor('--shader-b'))

    let width = 0
    let height = 0
    function resize(cssWidth: number, cssHeight: number) {
      const w = Math.max(1, Math.round(cssWidth * RENDER_SCALE))
      const h = Math.max(1, Math.round(cssHeight * RENDER_SCALE))
      if (w === width && h === height) return
      width = w
      height = h
      // Non-null: `canvas`/`gl` are checked above in this same effect run;
      // TypeScript's narrowing does not persist into a nested function
      // declaration even for a `const` (it cannot prove the closure runs
      // before any hypothetical reassignment), so these are asserted, not
      // re-checked -- the values genuinely cannot become null here.
      canvas!.width = w
      canvas!.height = h
      gl!.viewport(0, 0, w, h)
    }
    resize(canvas.clientWidth || 1, canvas.clientHeight || 1)

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        resize(entry.contentRect.width, entry.contentRect.height)
      })
      resizeObserver.observe(canvas)
    }

    let intersecting = true
    let intersectionObserver: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver((entries) => {
        intersecting = entries[0]?.isIntersecting ?? true
      })
      intersectionObserver.observe(canvas)
    }

    let raf = 0
    let running = true
    let contextLost = false
    let start = 0
    let lastFrame = 0
    let firstFrameDrawn = false

    function loseContext() {
      if (contextLost) return
      contextLost = true
      gl!.getExtension('WEBGL_lose_context')?.loseContext()
    }

    function freeze() {
      running = false
      cancelAnimationFrame(raf)
      const snapshot = document.createElement('canvas')
      snapshot.width = width
      snapshot.height = height
      snapshot.getContext('2d')?.drawImage(canvas!, 0, 0)
      snapshotRef.current = snapshot
      setFrozen(true) // -> unmounts the GL canvas; the ref callback below paints `snapshot` in
      loseContext()
    }

    function frame(now: number) {
      if (!running) return
      raf = requestAnimationFrame(frame)
      if (!intersecting || document.visibilityState !== 'visible') return
      if (now - lastFrame < FRAME_BUDGET_MS) return
      lastFrame = now
      if (!start) start = now
      const elapsed = now - start
      gl!.uniform2f(uResolution, width, height)
      gl!.uniform1f(uTime, elapsed / 1000)
      gl!.drawArrays(gl!.TRIANGLES, 0, 3)
      if (!firstFrameDrawn) {
        firstFrameDrawn = true
        setReady(true)
      }
      if (elapsed >= SETTLE_MS) freeze()
    }
    raf = requestAnimationFrame(frame)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      loseContext()
    }
  }, [acquired, frozen])

  if (!acquired) return null

  if (frozen) {
    return (
      <canvas
        aria-hidden="true"
        data-shader-field-frozen={preset}
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 1 }}
        ref={(node) => {
          const snapshot = snapshotRef.current
          if (!node || !snapshot) return
          if (node.width === snapshot.width && node.height === snapshot.height && node.dataset.painted) return
          node.width = snapshot.width
          node.height = snapshot.height
          node.getContext('2d')?.drawImage(snapshot, 0, 0)
          node.dataset.painted = 'true'
        }}
      />
    )
  }

  return (
    <canvas
      ref={glCanvasRef}
      aria-hidden="true"
      data-shader-field={preset}
      className="absolute inset-0 h-full w-full"
      style={{ opacity: ready ? 1 : 0, transition: 'opacity var(--duration-slow) var(--ease-enter)' }}
    />
  )
}
