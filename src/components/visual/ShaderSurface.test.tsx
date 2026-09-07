import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FRAGMENT_SHADER, VERTEX_SHADER } from './field.glsl'
import { resetShaderContextForTests } from './context'
import ShaderField, { SHADER_CONTEXT_ATTRIBUTES } from './ShaderField'
import { ShaderSurface } from './ShaderSurface'

// --- shared test doubles, hoisted so `vi.mock` factories below can close
// over them (mock factories run while the import graph resolves, before
// this file's own top-level `const`s would otherwise exist) ------------

const theme = vi.hoisted(() => ({ resolvedTheme: 'midnight' as string | undefined }))
const dynamicSpy = vi.hoisted(() => ({ loaderCalls: 0 }))

vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: theme.resolvedTheme }) }))

// `next/dynamic` is mocked to a synchronous stand-in so `ShaderSurface`'s
// own gating logic (the thing this test actually verifies) is exercised
// without also depending on `React.lazy`/`Suspense` timing. The real
// `next/dynamic` -- confirmed by reading
// `node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js` -- wraps
// `React.lazy(() => opts.loader().then(...))`, and `React.lazy`'s executor
// is not invoked until the lazy component is actually rendered; this stub
// preserves exactly that property (the loader is recorded only when the
// returned component is rendered) so "no import is attempted" is a
// meaningful assertion rather than one true by construction.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) =>
    function MockedShaderField(props: { preset?: string }) {
      dynamicSpy.loaderCalls += 1
      void loader
      return <canvas data-shader-field-mock={props.preset} />
    },
}))

class FakeMediaQueryList {
  matches: boolean
  private listeners = new Set<() => void>()
  constructor(initial: boolean) {
    this.matches = initial
  }
  addEventListener(_type: string, cb: () => void) {
    this.listeners.add(cb)
  }
  removeEventListener(_type: string, cb: () => void) {
    this.listeners.delete(cb)
  }
}

function installMatchMedia(osReduce: boolean) {
  window.matchMedia = ((query: string) => {
    if (query !== '(prefers-reduced-motion: reduce)') throw new Error(`unexpected query: ${query}`)
    return new FakeMediaQueryList(osReduce) as unknown as MediaQueryList
  }) as typeof window.matchMedia
}

beforeEach(() => {
  dynamicSpy.loaderCalls = 0
  theme.resolvedTheme = 'midnight'
  installMatchMedia(false) // OS reports no preference either way, by default
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('field.glsl (spec §6.2 rule 3: zero vec3( colour literals)', () => {
  it('the vertex shader never constructs a vec3(...) colour literal', () => {
    expect(VERTEX_SHADER).not.toContain('vec3(')
  })

  it('the fragment shader never constructs a vec3(...) colour literal -- colour comes only from uColorA/uColorB', () => {
    expect(FRAGMENT_SHADER).not.toContain('vec3(')
    expect(FRAGMENT_SHADER).toContain('uniform vec3 uColorA')
    expect(FRAGMENT_SHADER).toContain('uniform vec3 uColorB')
  })
})

describe('ShaderSurface (spec §6.1, plan T4.3 step 1: the always-safe wrapper)', () => {
  it('paints the static CSS floor and the outer marker regardless of theme or motion', () => {
    const { container } = render(<ShaderSurface motionPref="reduced" />)
    const surface = container.querySelector('[data-shader-surface]')
    expect(surface).not.toBeNull()
    expect(surface?.getAttribute('data-shader-surface')).toBe('aurora') // default preset
    expect(surface?.getAttribute('aria-hidden')).toBe('true')
    expect(surface?.className).toContain('pointer-events-none')
  })

  it('under reduced motion, no shader import is attempted and no canvas exists -- even in Eclipse', () => {
    theme.resolvedTheme = 'eclipse'
    const { container } = render(<ShaderSurface motionPref="reduced" />)
    expect(dynamicSpy.loaderCalls).toBe(0)
    expect(container.querySelector('canvas')).toBeNull()
    expect(container.querySelector('[data-shader-field-mock]')).toBeNull()
  })

  it('outside Eclipse, even with motion resolved full, no shader import is attempted', () => {
    theme.resolvedTheme = 'midnight'
    const { container } = render(<ShaderSurface motionPref="full" />)
    expect(dynamicSpy.loaderCalls).toBe(0)
    expect(container.querySelector('[data-shader-field-mock]')).toBeNull()
  })

  it('a resolved-reduce OS signal keeps the field off in Eclipse even with prefs at "system"', () => {
    theme.resolvedTheme = 'eclipse'
    installMatchMedia(true)
    const { container } = render(<ShaderSurface motionPref="system" />)
    expect(dynamicSpy.loaderCalls).toBe(0)
    expect(container.querySelector('[data-shader-field-mock]')).toBeNull()
  })

  it('mounts the shader field only when motion resolves full AND the resolved theme is eclipse', () => {
    theme.resolvedTheme = 'eclipse'
    const { container } = render(<ShaderSurface motionPref="full" />)
    expect(dynamicSpy.loaderCalls).toBe(1)
    expect(container.querySelector('[data-shader-field-mock="aurora"]')).not.toBeNull()
  })

  it('an in-app "full" override still lights the field even when the OS asks to reduce (R7.9\'s load-bearing case)', () => {
    theme.resolvedTheme = 'eclipse'
    installMatchMedia(true)
    const { container } = render(<ShaderSurface motionPref="full" />)
    expect(dynamicSpy.loaderCalls).toBe(1)
    expect(container.querySelector('[data-shader-field-mock]')).not.toBeNull()
  })

  it('forwards a caller className alongside its own layout classes', () => {
    theme.resolvedTheme = 'midnight'
    const { container } = render(<ShaderSurface motionPref="full" className="rounded-xl" />)
    expect(container.querySelector('[data-shader-surface]')?.className).toContain('rounded-xl')
  })

  it('the CSS floor\'s two gradient stops name two distinct custom properties (T43-I2)', () => {
    // Before this fix, the second stop was `var(--shader-a)` fading to
    // `transparent` -- the same token as the element's own background
    // colour, a no-op in every palette. `--glow` carries a real low-alpha
    // value in all five palette blocks, so the floor now shows a genuine
    // second stop everywhere, not only where `--shader-a` happens to
    // differ from what it sits on.
    const { container } = render(<ShaderSurface motionPref="reduced" />)
    const floor = container.querySelector('[data-shader-surface] > div') as HTMLElement
    expect(floor).not.toBeNull()
    const backgroundImage = floor.style.backgroundImage
    const names = [...backgroundImage.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(2)
    expect(backgroundImage).toContain('var(--shader-b)')
    expect(backgroundImage).toContain('var(--glow)')
  })
})

// --- ShaderField, mounted directly (not through the mocked `next/dynamic`),
// against a fake WebGL2 so the real component's own contract is exercised. -

interface FakeGl {
  createShader: () => object
  shaderSource: () => void
  compileShader: () => void
  getShaderParameter: () => boolean
  deleteShader: () => void
  createProgram: () => object
  attachShader: () => void
  linkProgram: () => void
  getProgramParameter: () => boolean
  deleteProgram: () => void
  useProgram: () => void
  getUniformLocation: () => object
  uniform3fv: () => void
  uniform2f: () => void
  uniform1f: () => void
  viewport: () => void
  drawArrays: () => void
  getExtension: (name: string) => { loseContext: () => void } | null
  VERTEX_SHADER: number
  FRAGMENT_SHADER: number
  COMPILE_STATUS: number
  LINK_STATUS: number
  TRIANGLES: number
}

function makeFakeGl(): FakeGl {
  return {
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    deleteProgram: () => {},
    useProgram: () => {},
    getUniformLocation: () => ({}),
    uniform3fv: () => {},
    uniform2f: () => {},
    uniform1f: () => {},
    viewport: () => {},
    drawArrays: () => {},
    getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => {} } : null),
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    TRIANGLES: 5,
  }
}

function installFakeCanvasContexts() {
  const getContextSpy = vi.fn<(type: string, attrs?: unknown) => unknown>()
  const original = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
    getContextSpy(type, attrs)
    if (type === 'webgl2') return makeFakeGl()
    if (type === '2d') {
      // Only readTokenColor's 1x1 probe and the frozen-canvas paint use
      // '2d' in this component; a permissive stub keeps this fake honest
      // about what real browsers support (assigning `fillStyle` always
      // "succeeds" here, same as a real 2D context given a valid colour
      // string) rather than returning null and forcing a silent bail.
      return {
        fillStyle: '',
        fillRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      }
    }
    return null
  } as typeof HTMLCanvasElement.prototype.getContext
  return {
    getContextSpy,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = original
    },
  }
}

/**
 * Fix round (T43-M3 test coverage): `readTokenColor` reads `--shader-a`/
 * `--shader-b` via `getComputedStyle(document.documentElement)
 *   .getPropertyValue(varName)`. jsdom resolves no real CSS cascade for
 * custom properties, so without this stub every token reads as `''` --
 * exactly the "empty token" path T43-M3 is about, which is why it must be
 * installed with *real* values by default (matching the tests' intent
 * before this fix round) and overridable to empty for the one test that
 * exercises the bail itself.
 */
function stubShaderTokens(overrides: Partial<Record<'--shader-a' | '--shader-b', string>> = {}) {
  const values: Record<string, string> = {
    '--shader-a': 'oklch(0.09 0.008 285)',
    '--shader-b': 'oklch(0.16 0.045 305)',
    ...overrides,
  }
  const original = CSSStyleDeclaration.prototype.getPropertyValue
  CSSStyleDeclaration.prototype.getPropertyValue = function (name: string) {
    if (name in values) return values[name] ?? ''
    return original.call(this, name)
  }
  return () => {
    CSSStyleDeclaration.prototype.getPropertyValue = original
  }
}

describe('ShaderField (spec §6.2: the context contract, direct mount against a fake WebGL2)', () => {
  let fakeCanvas: ReturnType<typeof installFakeCanvasContexts>
  let restoreTokens: () => void

  beforeEach(() => {
    resetShaderContextForTests()
    fakeCanvas = installFakeCanvasContexts()
    restoreTokens = stubShaderTokens() // real values by default
  })

  afterEach(() => {
    fakeCanvas.restore()
    restoreTokens()
  })

  it('requests webgl2 with exactly the context-attribute object spec §6.2 specifies', () => {
    render(<ShaderField preset="aurora" />)
    const webglCalls = fakeCanvas.getContextSpy.mock.calls.filter(([type]) => type === 'webgl2')
    expect(webglCalls).toHaveLength(1)
    // Fix round (T43-M1): assert the literal spec §6.2 shape, not
    // `SHADER_CONTEXT_ATTRIBUTES` itself -- comparing against the very
    // object the component passed is `x === x` and cannot catch a real
    // regression (e.g. `preserveDrawingBuffer` flipped to `false`, which
    // would make the frozen snapshot blank while this assertion still
    // passed).
    expect(webglCalls[0]?.[1]).toEqual({
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    })
    // The component's own exported constant must also match that literal
    // shape -- keeps the two assertions from drifting apart silently.
    expect(SHADER_CONTEXT_ATTRIBUTES).toEqual(webglCalls[0]?.[1])
  })

  it('mounting two concurrently renders exactly one <canvas> -- the module counter denies the second', () => {
    const { container: first } = render(<ShaderField preset="aurora" />)
    const { container: second } = render(<ShaderField preset="aurora" />)
    const total = first.querySelectorAll('canvas').length + second.querySelectorAll('canvas').length
    expect(total).toBe(1)
    // and only the acquiring instance ever called getContext('webgl2')
    const webglCalls = fakeCanvas.getContextSpy.mock.calls.filter(([type]) => type === 'webgl2')
    expect(webglCalls).toHaveLength(1)
  })

  it('after the first instance releases the singleton, a fresh mount can acquire it again', () => {
    const { unmount } = render(<ShaderField preset="aurora" />)
    unmount()
    const { container } = render(<ShaderField preset="aurora" />)
    expect(container.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('sizes the canvas backing store to RENDER_SCALE (0.5x) of the CSS box reported by ResizeObserver', () => {
    let resizeCallback: ResizeObserverCallback | null = null
    class FakeResizeObserver implements ResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = cb
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver

    try {
      const { container } = render(<ShaderField preset="aurora" />)
      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      expect(resizeCallback).not.toBeNull()
      const cssWidth = 801
      const cssHeight = 599
      resizeCallback!(
        [{ contentRect: { width: cssWidth, height: cssHeight } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )
      expect(canvas.width).toBe(Math.round(cssWidth * 0.5))
      expect(canvas.height).toBe(Math.round(cssHeight * 0.5))
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })

  it('bails before requesting a webgl2 context when a colour token is empty or unparseable (T43-M3)', () => {
    restoreTokens()
    restoreTokens = stubShaderTokens({ '--shader-a': '', '--shader-b': 'oklch(0.16 0.045 305)' })
    render(<ShaderField preset="aurora" />)
    const webglCalls = fakeCanvas.getContextSpy.mock.calls.filter(([type]) => type === 'webgl2')
    // An empty token must fail to the CSS floor `ShaderSurface` already
    // painted -- never to an opaque black rectangle drawn by a live GL
    // context with a black uniform.
    expect(webglCalls).toHaveLength(0)
  })

  it('accumulates only drawn time toward the 4500ms settle -- scrolling the field off-screen and back does not skip the gesture (T43-I3)', () => {
    let rafCallback: ((now: number) => void) | null = null
    const originalRaf = globalThis.requestAnimationFrame
    const originalCancelRaf = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallback = cb as (now: number) => void
      return 1
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame

    let intersectionCallback: IntersectionObserverCallback | null = null
    class FakeIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        intersectionCallback = cb
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
    const originalIO = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver

    function tick(now: number) {
      act(() => {
        rafCallback?.(now)
      })
    }
    function setIntersecting(value: boolean) {
      act(() => {
        intersectionCallback?.([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver)
      })
    }

    try {
      const { container } = render(<ShaderField preset="aurora" />)
      expect(rafCallback).not.toBeNull()

      tick(50) // the first drawn frame
      expect(container.querySelector('[data-shader-frozen]')).toBeNull()

      setIntersecting(false) // scrolled off-screen
      tick(10050) // 10s of real time pass while hidden -- must not count
      expect(container.querySelector('[data-shader-frozen]')).toBeNull()

      setIntersecting(true) // scrolled back into view
      tick(10100)
      // Wall-clock time since the first frame is now >10s -- comfortably
      // past SETTLE_MS. If the settle clock were wall-clock (the T43-I3
      // bug), this frame would already freeze. It must not: almost none of
      // that time was spent actually drawing.
      expect(container.querySelector('[data-shader-frozen]')).toBeNull()
      expect(container.querySelector('[data-shader-field]')).not.toBeNull()

      // Drive real, visible frames until the accumulated *drawn* time
      // actually reaches SETTLE_MS, proving the settle still happens on
      // its own budget rather than never firing at all.
      let now = 10100
      for (let i = 0; i < 200 && !container.querySelector('[data-shader-frozen]'); i++) {
        now += 40
        tick(now)
      }
      expect(container.querySelector('[data-shader-frozen]')).not.toBeNull()
      // The frozen canvas keeps the same `data-shader-field` marker the
      // live one carried -- T43-M4 -- so one selector spans the whole
      // lifecycle instead of going dark the moment the field settles.
      expect(container.querySelector('[data-shader-field]')).not.toBeNull()
    } finally {
      globalThis.requestAnimationFrame = originalRaf
      globalThis.cancelAnimationFrame = originalCancelRaf
      globalThis.IntersectionObserver = originalIO
    }
  })
})
