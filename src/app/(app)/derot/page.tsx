'use client'

import { Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight, Bug, Eye, Grid3x3, Keyboard, Music2, RotateCcw, Route, Shapes, Target, Terminal, Wind, Zap } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { line } from '@/lib/voice/lines'
import { useSession } from '@/store/session'
import { LaneSwitch } from '@/components/derot/LaneSwitch'
import type { DrillKind, DrillLane, DrillResult, MotionPreference } from '@/lib/contracts'
import { DRILL_KINDS, DRILL_META, PLAY_KINDS, computeDerotStreak, dateKey, isArcadeKind, isPlayKind, statsForKind, type KindStats } from './lib'

// De-rot is never restricted (spec 10.8): this hub has no account-status
// gate of any kind -- a restricted learner keeps the exact same page a
// full-access learner sees. The promise that a restriction leaves de-rot
// untouched is made on the restricted surface itself (dashboard / exercise);
// this file's contribution to that promise is simply never adding a gate.

/** One small glyph per kind (fix round 1, item 12): the reviewer's own complaint was six identical cards differentiated only by a name and a grey dot. Decorative only -- aria-hidden. */
const DRILL_GLYPHS: Record<DrillKind, ComponentType<{ className?: string }>> = {
  'predict-output': Terminal,
  'spot-the-bug': Bug,
  trace: Route,
  'hold-focus': Eye,
  'n-back': RotateCcw,
  'speed-type': Keyboard,
  'follow-the-dot': Target,
  'color-nback': Shapes,
  reaction: Zap,
  rhythm: Music2,
  breathe: Wind,
  'memory-grid': Grid3x3,
}

interface Overview {
  loading: boolean
  failed: boolean
  results: DrillResult[]
  availableKinds: Set<DrillKind>
  motionPref: MotionPreference
}

const EMPTY_OVERVIEW: Overview = { loading: false, failed: false, results: [], availableKinds: new Set(), motionPref: 'system' }

function useDerotOverview(userId: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Overview>({ ...EMPTY_OVERVIEW, loading: Boolean(userId) })
  const [trackedUserId, setTrackedUserId] = useState(userId)
  if (trackedUserId !== userId) {
    setTrackedUserId(userId)
    setState(userId ? { ...EMPTY_OVERVIEW, loading: true } : EMPTY_OVERVIEW)
  }

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    async function load() {
      try {
        const client = createClient()
        const [wellness, drills] = await Promise.all([
          client.from('wellness').select('drill_results,prefs').eq('user_id', userId as string).maybeSingle(),
          client.from('drills').select('kind'),
        ])
        if (wellness.error || drills.error) throw new Error('De-rot progress unavailable')
        if (cancelled) return
        const results = ((wellness.data?.drill_results ?? []) as DrillResult[])
        const availableKinds = new Set<DrillKind>((drills.data ?? []).map((row: { kind: string }) => row.kind as DrillKind))
        const motionPref = resolveWellnessPrefs(wellness.data?.prefs).motion
        setState({ loading: false, failed: false, results, availableKinds, motionPref })
      } catch {
        if (!cancelled) setState({ ...EMPTY_OVERVIEW, failed: true })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [userId, attempt])

  const retry = () => {
    setState((prev) => ({ ...prev, loading: true, failed: false }))
    setAttempt((n) => n + 1)
  }

  return { ...state, retry }
}

function hrefFor(lane: DrillLane, kind: DrillKind): string {
  return lane === 'arcade' ? `/derot/arcade/${kind}` : `/derot/play/${kind}`
}

/** `?drill=<kind>` is the buddy suggestion chip's deep link, routed straight to the lane the kind actually lives in. */
function DrillQueryRedirect() {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const drill = params.get('drill')
    if (isArcadeKind(drill)) { router.replace(hrefFor('arcade', drill)); return }
    if (isPlayKind(drill)) { router.replace(hrefFor('play', drill)); return }
  }, [params, router])
  return null
}

/**
 * Fades a card in on mount with a per-index stagger (spec 10.8: the card
 * grid cross-fades with a 30ms stagger). No keyframe is needed -- a plain
 * opacity transition, same technique as RevealBlock -- so under reduced
 * motion the card is simply present at full opacity from the first render.
 */
function FadeInCard({ index, reduced, children }: { index: number; reduced: boolean; children: ReactNode }) {
  const [visible, setVisible] = useState(reduced)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])
  return (
    <div
      className="h-full"
      style={{
        opacity: reduced || visible ? 1 : 0,
        transition: reduced ? 'none' : `opacity 220ms cubic-bezier(0.22, 1, 0.36, 1) ${Math.min(index * 30, 300)}ms`,
      }}
    >
      {children}
    </div>
  )
}

/**
 * True only while the card is on screen, never under reduced motion --
 * mirrors RevealBlock's contract: no `IntersectionObserver` is even
 * constructed when reduced, not merely disconnected early.
 */
function useCardInView(reduced: boolean): [(node: HTMLElement | null) => void, boolean] {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (reduced || !node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.1 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node, reduced])
  return [setNode, inView && !reduced]
}

function DrillCard({ kind, lane, stats, available, reduced }: { kind: DrillKind; lane: DrillLane; stats: KindStats; available: boolean; reduced: boolean }) {
  const meta = DRILL_META[kind]
  const Glyph = DRILL_GLYPHS[kind]
  const [setNode, animate] = useCardInView(reduced)
  return (
    <Card ref={setNode} className="h-full">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary', animate && 'animate-pulse')}
          >
            <Glyph className="size-4" />
          </span>
          <CardTitle>{meta.title}</CardTitle>
        </div>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        {!available ? (
          <p className="text-sm leading-relaxed text-muted-foreground">No items yet. This drill is still being prepared.</p>
        ) : stats.attempted ? (
          <div>
            <p className="text-xs text-muted-foreground">Best</p>
            <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{stats.best}</p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">Not attempted yet. Give it a try.</p>
        )}
        {available ? (
          <Link href={hrefFor(lane, kind)} className={buttonVariants({ variant: 'default', className: 'w-fit' })}>
            Start<ArrowUpRight aria-hidden="true" />
          </Link>
        ) : (
          <Button variant="outline" disabled className="w-fit">Start</Button>
        )}
      </CardContent>
    </Card>
  )
}

function DerotSection() {
  const userId = useSession((session) => session.user?.id) ?? null
  const overview = useDerotOverview(userId)
  const reduced = useReducedMotion(overview.motionPref)
  const [lane, setLane] = useState<DrillLane>('arcade')

  const streakDays = computeDerotStreak(overview.results.map((result) => result.at))
  const todayKey = dateKey(new Date().toISOString())
  const todaysRuns = todayKey ? overview.results.filter((result) => dateKey(result.at) === todayKey).length : 0
  const kindsForLane = lane === 'arcade' ? DRILL_KINDS : PLAY_KINDS

  return (
    <div className="space-y-7">
      <Suspense fallback={null}><DrillQueryRedirect /></Suspense>

      <div>
        <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">De-rot</h1>
        <p className="mt-2 text-sm text-muted-foreground">Short drills and games to keep your attention sharp between reps.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-xs text-muted-foreground">De-rot streak</p>
            <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{streakDays} {streakDays === 1 ? 'day' : 'days'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Today&apos;s runs</p>
            <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{todaysRuns}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <LaneSwitch lane={lane} onChange={setLane} reduced={reduced} />
          {/* fix round 1, I7: the Playground's "no code in here" promise, made where the switch actually is. */}
          <p className="text-xs text-muted-foreground">{line(lane === 'arcade' ? 'derot.arcade.enter' : 'derot.play.enter')}</p>
        </div>
      </div>

      {overview.loading && <p role="status" className="text-sm text-muted-foreground">Loading your de-rot progress.</p>}
      {overview.failed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
          <p className="text-sm text-foreground">{line('error.load')}</p>
          <Button variant="outline" onClick={overview.retry}>Try again</Button>
        </div>
      )}

      {lane === 'arcade' && (
        // fix round 2, N5 (controller ruling, preamble): four of the six
        // Arcade kinds (scored by scoreTimedCorrect) can never actually
        // reach 100 -- only an instant, zero-elapsed-time answer would, and
        // no human plays that fast -- while the other two (Hands, Two Back)
        // can. Six "Best" numbers sit in one row on this screen; without
        // this line, a learner reading 95 next to 100 has no way to know
        // that gap is the ruler, not their play. Plain string pending a
        // voice-bank key -- listed in the T2.9a report for T2.7b.
        <p className="-mt-2 text-xs text-muted-foreground">
          Best scores don&apos;t line up evenly across drills — four of them cap out near 95 by design.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kindsForLane.map((kind, index) => (
          <FadeInCard key={kind} index={index} reduced={reduced}>
            <DrillCard
              kind={kind}
              lane={lane}
              stats={statsForKind(overview.results, kind)}
              // W2G-1: a Playground game is code, not a seeded `drills` row (R7.5) --
              // gating it on `availableKinds` (built purely from that table) disables
              // all six the moment migration 0009 (which writes their marker rows)
              // has not been applied, even though the games themselves already ship in
              // the bundle and run correctly when reached directly. Arcade kinds still
              // need a real seeded row, so they stay gated on `availableKinds` alone.
              available={isPlayKind(kind) || overview.availableKinds.has(kind)}
              reduced={reduced}
            />
          </FadeInCard>
        ))}
      </div>
    </div>
  )
}

export default function DerotPage() {
  return <DerotSection />
}
