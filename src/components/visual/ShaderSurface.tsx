'use client'

import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { cn } from 'cn'
import type { MotionPreference } from '@/lib/contracts'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'

/**
 * `dynamic(..., { ssr: false, loading: () => null })`: the GLSL and the GL
 * code ride this one chunk alone and never appear in a route's client-
 * reference manifest (spec §6.1). `next/dynamic` wraps `React.lazy`, whose
 * loader is genuinely lazy -- it is not called until `<ShaderField>` is
 * actually rendered -- so a learner who never sees `live` turn true (a non-
 * Eclipse palette, reduced motion) triggers zero shader-chunk network
 * activity, not merely a hidden one.
 */
const ShaderField = dynamic(() => import('./ShaderField'), { ssr: false, loading: () => null })

export interface ShaderSurfaceProps {
  preset?: 'aurora'
  motionPref: MotionPreference
  className?: string
}

/**
 * Cheap, always-safe wrapper (spec §6, plan T4.3 step 1). Paints the static
 * CSS floor -- two `radial-gradient`s in `--shader-a`/`--shader-b` token
 * space -- unconditionally, so a failed WebGL2 context, a save-data
 * connection, a non-Eclipse palette and reduced motion all land on the
 * exact same finished background (spec §6.1: "a finished look, not a
 * degraded one", true in the four palettes where these tokens are
 * `transparent`, T4.0). `--shader-a`/`--shader-b` are Eclipse-only tokens;
 * every other palette resolves both to `transparent`, so the floor there is
 * simply whatever surface this component is placed on.
 *
 * Both hooks resolve, and `live` is computed, **before** any branch (rules
 * of hooks; also spec step 1's "resolves `useReducedMotion(motionPref)` and
 * `resolvedTheme` before the dynamic import") -- `<ShaderField>` only ever
 * appears in JSX, and is therefore only ever imported, when motion is not
 * reduced and the resolved theme is `eclipse` (spec §6.1's placement table:
 * every other screen and palette gets the CSS floor only).
 */
export function ShaderSurface({ preset = 'aurora', motionPref, className }: ShaderSurfaceProps) {
  const reduced = useReducedMotion(motionPref)
  const { resolvedTheme } = useTheme()
  const live = !reduced && resolvedTheme === 'eclipse'

  return (
    <div
      aria-hidden="true"
      data-shader-surface={preset}
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: 'var(--shader-a)',
          backgroundImage:
            'radial-gradient(circle at 24% 18%, var(--shader-b), transparent 60%), ' +
            'radial-gradient(circle at 76% 82%, var(--shader-a), transparent 65%)',
        }}
      />
      {live ? <ShaderField preset={preset} /> : null}
    </div>
  )
}
