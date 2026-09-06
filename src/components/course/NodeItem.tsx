'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, CheckCircle2, Circle, Lock } from 'lucide-react'
import type { CloId, ExercisePublic } from '@/lib/contracts'
import { cn } from '@/lib/utils'
import type { MapNode } from '@/lib/course/map'
import { nodeAccessibleName } from '@/lib/course/map'

/** Node stagger step and cap (spec §10.4): 30ms apart, 300ms total -- narrower
 *  than the generic `STAGGER` token in `src/lib/motion/tokens.ts`, which is
 *  tuned for list/badge entrances rather than the path map specifically. */
const NODE_STAGGER_STEP_MS = 30
const NODE_STAGGER_MAX_MS = 300

/** `id="clo-node-{cloId}"` -- the target a locked node's `aria-describedby` points at. */
export function nodeElementId(cloId: CloId): string {
  return `clo-node-${cloId}`
}

/**
 * The node's marker: a distinct SHAPE and border style per state, never
 * colour alone (spec §10.4 critic -- "six states across four themes cannot
 * be told apart by hue by every learner"). The chain pips add a second,
 * independent non-colour cue (filled vs hollow squares) for "in progress".
 */
function NodeMarker({ node }: { node: MapNode }) {
  const base = 'flex size-9 shrink-0 items-center justify-center rounded-full border-2'
  if (node.state === 'locked') {
    return (
      <span data-node-shape="locked" className={cn(base, 'border-dashed border-muted-foreground/40 text-muted-foreground/60')}>
        <Lock className="size-4" aria-hidden="true" />
      </span>
    )
  }
  if (node.state === 'locked-in') {
    return (
      <span data-node-shape="locked-in" className={cn(base, 'border-solid border-celebration bg-celebration/20 text-celebration-foreground')}>
        <CheckCircle2 className="size-5" aria-hidden="true" />
      </span>
    )
  }
  if (node.state === 'in-progress') {
    return (
      <span data-node-shape="in-progress" className={cn(base, 'border-solid border-primary')}>
        <span className="flex gap-0.5" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className={cn('size-1.5 rounded-xs', i < node.chain ? 'bg-primary' : 'border border-primary/50 bg-transparent')} />
          ))}
        </span>
      </span>
    )
  }
  if (node.state === 'walkthrough-ready') {
    return (
      <span data-node-shape="walkthrough-ready" className={cn(base, 'relative border-solid border-primary')}>
        <Circle className="size-3 fill-primary text-primary" aria-hidden="true" />
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-xs border border-border bg-background">
          <BookOpen className="size-2.5" aria-hidden="true" />
        </span>
      </span>
    )
  }
  return (
    <span data-node-shape="available" className={cn(base, 'border-solid border-primary')}>
      <Circle className="size-3 fill-primary text-primary" aria-hidden="true" />
    </span>
  )
}

export function NodeItem({
  node,
  index,
  isLast,
  exercises,
  reducedMotion,
  justLockedIn,
}: {
  node: MapNode
  index: number
  isLast: boolean
  exercises: readonly ExercisePublic[]
  reducedMotion: boolean
  justLockedIn?: boolean
}) {
  const router = useRouter()
  const href = `/lesson/${encodeURIComponent(node.cloId)}`
  const describedBy = node.prerequisites.length > 0 ? node.prerequisites.map(nodeElementId).join(' ') : undefined
  const label = node.externalPrerequisites.length > 0
    ? `${nodeAccessibleName(node)}. Also builds on a skill from another course.`
    : nodeAccessibleName(node)

  // First-paint stagger (spec §10.4): both the server render and the first
  // client paint start "not yet entered" so there is nothing to hydrate
  // against; a post-mount effect flips it once, and reduced motion skips the
  // whole dance by starting (and staying) entered.
  const [entered, setEntered] = useState(reducedMotion)
  useEffect(() => {
    if (reducedMotion) return
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion])

  const enterStyle: CSSProperties = reducedMotion ? {} : {
    opacity: entered ? 1 : 0,
    transform: entered ? undefined : 'translateY(4px)',
    transition: 'opacity 200ms ease, transform 200ms ease',
    transitionDelay: `${Math.min(index * NODE_STAGGER_STEP_MS, NODE_STAGGER_MAX_MS)}ms`,
  }

  function prefetch() {
    router.prefetch(href)
    const firstRep = exercises.find((exercise) => exercise.cloId === node.cloId)
    if (firstRep) router.prefetch(`/exercise/${encodeURIComponent(firstRep.id)}`)
  }

  return (
    <li id={nodeElementId(node.cloId)} className="relative flex gap-4" style={enterStyle}>
      <div className="flex flex-col items-center">
        <NodeMarker node={node} />
        {!isLast && (
          <svg aria-hidden="true" width="2" height="32" className="mt-1">
            <line x1="1" y1="0" x2="1" y2="32" className={cn('stroke-border', justLockedIn && 'stroke-celebration')} strokeWidth="2" />
          </svg>
        )}
      </div>
      <Link
        href={href}
        aria-describedby={describedBy}
        aria-label={label}
        data-node-state={node.state}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        className={cn(
          'min-w-0 flex-1 rounded-lg border border-transparent px-3 py-2.5 outline-none transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0',
          node.state === 'locked' && 'opacity-70',
        )}
      >
        <span aria-hidden="true" className="block text-sm font-medium text-foreground">
          {node.title}
          {node.draft && <span className="ml-2 align-middle text-[10px] font-normal tracking-wide text-muted-foreground uppercase">Drafted</span>}
        </span>
        {node.externalPrerequisites.length > 0 && (
          <span aria-hidden="true" className="mt-1 block text-[11px] text-muted-foreground/70">
            Also builds on a skill from another course.
          </span>
        )}
      </Link>
    </li>
  )
}
