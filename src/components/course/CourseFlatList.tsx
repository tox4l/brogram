'use client'

import Link from 'next/link'
import type { MapNode } from '@/lib/course/map'
import { nodeAccessibleName } from '@/lib/course/map'

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
 * `MapNode[]` the path map does -- no separate fetch, no separate derivation.
 */
export function CourseFlatList({ nodes }: { nodes: MapNode[] }) {
  return (
    <details className="border-t border-border pt-5">
      <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Every skill in this course
      </summary>
      <ol className="mt-4 divide-y divide-border border-y border-border">
        {nodes.map((node) => (
          <li key={node.cloId}>
            <Link
              href={`/lesson/${encodeURIComponent(node.cloId)}`}
              aria-label={nodeAccessibleName(node)}
              className="flex items-center justify-between gap-4 rounded-md py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <span aria-hidden="true" className="min-w-0 flex-1 text-sm text-foreground">
                {node.title}
                {node.draft && <span className="ml-2 align-middle text-[10px] font-normal tracking-wide text-muted-foreground uppercase">Drafted</span>}
              </span>
              <span aria-hidden="true" className="shrink-0 font-mono text-xs text-muted-foreground">{flatStateLabel(node)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </details>
  )
}
