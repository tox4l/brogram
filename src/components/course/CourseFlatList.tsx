'use client'

import Link from 'next/link'
import { LockKeyhole } from 'lucide-react'
import type { ExercisePublic } from '@/lib/contracts'
import type { MapNode } from '@/lib/course/map'
import { nodeAccessibleName, nodeHref } from '@/lib/course/map'
import { cn } from '@/lib/utils'

function flatStateLabel(node: MapNode): string {
  switch (node.state) {
    case 'locked':
      return 'Locked'
    case 'available':
      return 'Available'
    case 'walkthrough-ready':
      return 'Walkthrough ready'
    case 'in-progress':
      return `In progress · ${node.chain}/3`
    case 'locked-in':
      return 'Locked in'
  }
}

/**
 * "The collapsed 'everything in this course' flat list stays, and it is the
 * same data, not a second implementation" (spec §10.4). This reads the exact
 * `MapNode[]` the path map does -- no separate fetch, no separate
 * derivation -- including which nodes have no lesson yet (`nodeHref` sends
 * those rows to their first bank exercise instead of a dead `/lesson/…`
 * link) and the restricted treatment (exercise-bound rows go inert, exactly
 * like `dashboard/page.tsx`'s own list; walkthrough rows stay live).
 */
export function CourseFlatList({
  nodes,
  exercises,
  reducedMotion,
  restricted,
}: {
  nodes: MapNode[]
  exercises: readonly ExercisePublic[]
  reducedMotion: boolean
  restricted: boolean
}) {
  return (
    <details className="border-t border-border pt-5">
      <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Every skill in this course
      </summary>
      <ol className="mt-4 divide-y divide-border border-y border-border">
        {nodes.map((node) => {
          const blocked = restricted && !node.lessonAvailable
          const rowClassName = cn(
            'flex items-center justify-between gap-4 rounded-md py-3 outline-none',
            blocked ? 'cursor-not-allowed opacity-80' : 'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
            !reducedMotion && !blocked && 'transition-colors',
          )
          const body = (
            <>
              <span aria-hidden="true" className="min-w-0 flex-1 text-sm text-foreground">
                {node.title}
                {node.draft && <span className="ml-2 align-middle text-[10px] font-normal tracking-wide text-muted-foreground uppercase">Drafted</span>}
                {node.skipped && <span className="ml-2 align-middle text-[10px] font-normal tracking-wide text-muted-foreground uppercase">Skipped</span>}
              </span>
              {blocked
                ? <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                : <span aria-hidden="true" className="shrink-0 font-mono text-xs text-muted-foreground">{flatStateLabel(node)}</span>}
            </>
          )
          return (
            <li key={node.cloId}>
              {blocked
                ? <div aria-label={nodeAccessibleName(node)} className={rowClassName}>{body}</div>
                : <Link href={nodeHref(node, exercises)} aria-label={nodeAccessibleName(node)} className={rowClassName}>{body}</Link>}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
