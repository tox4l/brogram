'use client'

/**
 * Follow the Dot (spec 7.9 Playground table, accessibility rule 1). The
 * pointer -- mouse, touch, or arrow keys at a fixed speed -- has to stay
 * inside a dot that drifts and accelerates along a smooth path for
 * `timeLimitS` seconds. `raw` handed back through `onComplete` is the share
 * of frames the pointer spent inside the dot (0..1) -- the primitive value
 * `normalizeFollowTheDot` in src/components/derot/scoring.ts expects -- never
 * the display-scaled x1000 number from the spec table (that scaling happens
 * inside the normalize function itself, which is the route's job to call).
 *
 * Rule 1 (this cannot be made reduced-motion-safe by dimming it): under
 * resolved reduced motion this component never starts the dot loop at all --
 * no rAF, no countdown, no `onComplete` -- it shows a substitute card that
 * states plainly this is a movement game and links to Grid or Twitch
 * instead. A learner can still choose "Play anyway", which is a purely
 * local, one-shot override for this mounted instance; the card never
 * re-appears once that choice is made.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CountdownRing } from '@/components/derot/CountdownRing'
import { useCountdown } from '@/components/derot/useCountdown'
import { DRILL_META } from '@/app/(app)/derot/lib'
import type { PlayGameProps } from './types'

const DOT_RADIUS_PX = 22
/** How close the pointer must be to the dot's centre to count as "inside" -- the dot's own radius plus a little grace so the game rewards genuinely tracking it, not pixel-perfect overlap. */
const CATCH_RADIUS_PX = DOT_RADIUS_PX + 10
const KEY_SPEED_PX_S = 220

export interface DotPosition { x: number; y: number }

/**
 * Pure, deterministic path: two out-of-phase sine waves whose angular speed
 * rises slowly with elapsed time ("accelerates" per the brief) so the dot
 * never repeats a lap in exactly the same rhythm. Given the same
 * `elapsedS`/`width`/`height` this always returns the same point -- the seam
 * this file's tests pin directly, independent of any animation timing.
 */
export function dotPathPosition(elapsedS: number, width: number, height: number): DotPosition {
  const speed = 1 + Math.min(1.5, elapsedS * 0.02)
  const cx = width / 2
  const cy = height / 2
  const rx = Math.max(0, width / 2 - DOT_RADIUS_PX - 8)
  const ry = Math.max(0, height / 2 - DOT_RADIUS_PX - 8)
  const x = cx + rx * Math.sin(elapsedS * 0.55 * speed + 0.6)
  const y = cy + ry * Math.sin(elapsedS * 0.83 * speed)
  return { x, y }
}

function clampToBounds(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

/** The real game: only ever mounted once motion is actually intended (reduced motion is off, or the learner opted in from the substitute card). */
function FollowTheDotGame({ timeLimitS, onComplete, onAbort }: PlayGameProps) {
  const areaRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ width: 320, height: 320 })
  const pointerPosRef = useRef<DotPosition>({ x: 160, y: 160 })
  const keysRef = useRef({ up: false, down: false, left: false, right: false })
  const framesInsideRef = useRef(0)
  const framesTotalRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const finishedRef = useRef(false)

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const total = framesTotalRef.current
    const shareInside = total > 0 ? framesInsideRef.current / total : 0
    onComplete({ raw: shareInside, payload: { framesInside: framesInsideRef.current, framesTotal: total } })
  }, [onComplete])

  const { remainingMs, percentRemaining } = useCountdown({ timeLimitS, onExpire: finish })

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    // A container not yet laid out (display:none mid-transition, or no ResizeObserver at all --
    // jsdom has neither) reports 0x0; keep the sane fallback size rather than collapsing to a
    // degenerate play area.
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) sizeRef.current = { width: el.clientWidth, height: el.clientHeight }
    }
    measure()
    pointerPosRef.current = { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Keyboard fallback: arrow keys move the virtual pointer at a fixed speed. Held state only -- no per-keystroke jump.
  useEffect(() => {
    const setKey = (event: KeyboardEvent, held: boolean) => {
      const map: Record<string, keyof typeof keysRef.current> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const key = map[event.key]
      if (!key) return
      event.preventDefault()
      keysRef.current[key] = held
    }
    const onKeyDown = (event: KeyboardEvent) => setKey(event, true)
    const onKeyUp = (event: KeyboardEvent) => setKey(event, false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = areaRef.current?.getBoundingClientRect()
    if (!rect) return
    pointerPosRef.current = {
      x: clampToBounds(event.clientX - rect.left, sizeRef.current.width),
      y: clampToBounds(event.clientY - rect.top, sizeRef.current.height),
    }
  }, [])

  // The frame loop: paused while the tab is hidden (never counts hidden time either way or against the learner), cleaned up on unmount.
  useEffect(() => {
    let paused = document.visibilityState === 'hidden'

    const onVisibility = () => { paused = document.visibilityState === 'hidden' }
    document.addEventListener('visibilitychange', onVisibility)

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick)
      if (paused) { lastFrameAtRef.current = now; return }
      if (startedAtRef.current === null) startedAtRef.current = now
      const last = lastFrameAtRef.current
      lastFrameAtRef.current = now
      const dtS = last === null ? 0 : Math.min(0.1, (now - last) / 1000)

      const { width, height } = sizeRef.current
      const keys = keysRef.current
      if (keys.up || keys.down || keys.left || keys.right) {
        const pos = pointerPosRef.current
        const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0)
        const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
        pointerPosRef.current = {
          x: clampToBounds(pos.x + dx * KEY_SPEED_PX_S * dtS, width),
          y: clampToBounds(pos.y + dy * KEY_SPEED_PX_S * dtS, height),
        }
      }

      const elapsedS = (now - startedAtRef.current) / 1000
      const dot = dotPathPosition(elapsedS, width, height)
      if (dotRef.current) dotRef.current.style.transform = `translate3d(${dot.x - DOT_RADIUS_PX}px, ${dot.y - DOT_RADIUS_PX}px, 0)`
      if (pointerRef.current) {
        const p = pointerPosRef.current
        pointerRef.current.style.transform = `translate3d(${p.x - 8}px, ${p.y - 8}px, 0)`
      }

      const distance = Math.hypot(pointerPosRef.current.x - dot.x, pointerPosRef.current.y - dot.y)
      framesTotalRef.current += 1
      if (distance <= CATCH_RADIUS_PX) framesInsideRef.current += 1
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CountdownRing remainingMs={remainingMs} percentRemaining={percentRemaining} reduced={false} />
          <Button variant="ghost" size="sm" onClick={onAbort}>Quit</Button>
        </div>
        <CardDescription>Keep the pointer inside the dot. Mouse, touch, or the arrow keys all work.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          ref={areaRef}
          data-testid="follow-the-dot-area"
          onPointerMove={onPointerMove}
          className="relative h-72 w-full touch-none overflow-hidden rounded-lg bg-muted"
        >
          <div
            ref={dotRef}
            data-testid="follow-the-dot-dot"
            className="absolute size-11 rounded-full bg-primary will-change-transform"
            style={{ transform: 'translate3d(0,0,0)' }}
            aria-hidden="true"
          />
          <div
            ref={pointerRef}
            data-testid="follow-the-dot-pointer"
            className="absolute size-4 rounded-full border-2 border-foreground/60 will-change-transform"
            style={{ transform: 'translate3d(0,0,0)' }}
            aria-hidden="true"
          />
        </div>
      </CardContent>
    </Card>
  )
}

/** Rule 1's substitute: the card stays, states plainly this is a movement game, and offers Grid or Twitch as the substitute. Nothing here starts a timer or a loop. */
function FollowTheDotSubstitute({ onPlayAnyway }: { onPlayAnyway: () => void }) {
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader className="gap-2">
        <CardTitle>{DRILL_META['follow-the-dot'].title} needs movement</CardTitle>
        <CardDescription>
          This is a movement game -- a dot drifts across the screen and the point is to keep tracking it. Your motion
          preference is set to reduced, so it does not start on its own here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {DRILL_META['memory-grid'].title} or {DRILL_META.reaction.title} make a good substitute -- same sixty to
          ninety second break, no screen motion required.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/derot/play/memory-grid" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Play {DRILL_META['memory-grid'].title} instead
          </Link>
          <Link href="/derot/play/reaction" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Play {DRILL_META.reaction.title} instead
          </Link>
        </div>
        <div>
          <Button variant="outline" onClick={onPlayAnyway}>Play anyway</Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function FollowTheDot(props: PlayGameProps) {
  const [forced, setForced] = useState(false)
  if (props.reducedMotion && !forced) {
    return <FollowTheDotSubstitute onPlayAnyway={() => setForced(true)} />
  }
  return <FollowTheDotGame {...props} />
}
