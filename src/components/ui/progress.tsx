"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "cn"
import { useReducedMotion } from "@/lib/motion/useReducedMotion"

/** Fix round (W4FIX-D, motion-css rule): base-ui's own `Progress.Indicator`
 *  sets an inline `width: N%` (see its source -- there is no exported hook
 *  for the resolved percentage, so re-deriving it here from the same
 *  `value`/`min`/`max` props `Progress.Root` already receives is the only
 *  way to animate the fill without also depending on that inline width).
 *  The design gate bans an animated `width` outright (and `transition-all`
 *  with it), so the indicator below pins its own `style.width` to `100%`
 *  (which wins the merge over base-ui's inline width -- `mergeProps`
 *  documents rightmost-style-wins) and does the actual fill with
 *  `transform: scaleX()` from a left origin instead -- the same value,
 *  animated on a compositor-only property.
 *
 *  Fix round (review D-4): `max <= min` now returns 100, matching base-ui's
 *  own `Progress.Indicator` math exactly (it clamps to the max end, not to
 *  zero) -- no consumer hits this branch today, but a re-derivation that
 *  disagreed with the primitive it re-derives from is the kind of gap that
 *  only shows up the day someone does. */
function resolvedPercentage(value: number | null | undefined, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return 0
  if (max <= min) return 100
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

function Progress({
  className,
  children,
  value,
  min = 0,
  max = 100,
  ...props
}: ProgressPrimitive.Root.Props) {
  const percentage = resolvedPercentage(value ?? null, min, max)
  return (
    <ProgressPrimitive.Root
      value={value}
      min={min}
      max={max}
      data-slot="progress"
      className={cn("flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator percentage={percentage} />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  )
}

/** Fix round (review D-4): `percentage` is required, no default -- a caller
 *  composing `ProgressIndicator` directly without a real value used to
 *  silently default to 0 and render a permanently empty bar (the inline
 *  `width: 100%` this component sets always won base-ui's own percentage-
 *  width style, per the merge note above). Making it required moves that
 *  failure to a compile error instead. `style` is destructured out and
 *  spread last so a caller's own `style` prop still wins over ours, the
 *  same "rightmost wins" rule this component itself relies on to beat
 *  base-ui's inline width.
 *
 *  Fix round (review D-3): reads `useReducedMotion()` with no preference
 *  argument -- this is a presentation-only primitive with no access to the
 *  learner's stored `wellness.prefs.motion`, so (per that hook's own doc
 *  comment, and the precedent at `MotionAttributeStatic.tsx`) a bare call
 *  resolves to "system": defer to the OS `prefers-reduced-motion` signal,
 *  the only resolution available at this layer. Standing constraint 12 /
 *  R7.9 requires the resolved boolean, not a raw media query, and this is
 *  it. The transition class itself is omitted (not just neutralised) when
 *  reduced, so the fill jumps straight to its resting scale. */
function ProgressIndicator({
  className,
  percentage,
  style,
  ...props
}: ProgressPrimitive.Indicator.Props & { percentage: number }) {
  const reducedMotion = useReducedMotion()
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full w-full origin-left bg-primary", !reducedMotion && "transition-transform", className)}
      style={{ width: "100%", transform: `scaleX(${percentage / 100})`, ...style }}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        "ml-auto text-sm text-muted-foreground tabular-nums",
        className
      )}
      data-slot="progress-value"
      {...props}
    />
  )
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
}
