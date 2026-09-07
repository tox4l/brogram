"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "cn"

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
 *  animated on a compositor-only property. */
function resolvedPercentage(value: number | null | undefined, min: number, max: number): number {
  if (value == null || !Number.isFinite(value) || max <= min) return 0
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

function ProgressIndicator({
  className,
  percentage = 0,
  ...props
}: ProgressPrimitive.Indicator.Props & { percentage?: number }) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full w-full origin-left bg-primary transition-transform duration-300 ease-out", className)}
      style={{ width: "100%", transform: `scaleX(${percentage / 100})` }}
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
