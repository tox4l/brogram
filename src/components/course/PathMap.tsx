'use client'

import { useState } from 'react'
import type { CloId, ExercisePublic } from '@/lib/contracts'
import type { MapNode } from '@/lib/course/map'
import { NodeItem } from './NodeItem'

/**
 * The centrepiece of the course home (spec §3.5, §10.4): a progressive
 * enhancement over a real, ordered list of links -- the DOM here IS the
 * accessibility story, not a canvas with click targets layered over it. Each
 * `NodeItem` draws its own short decorative connector to the next node
 * (`aria-hidden`), so nothing here needs to measure the DOM to lay out a
 * shared SVG overlay.
 */
export function PathMap({
  nodes,
  exercises,
  reducedMotion,
}: {
  nodes: MapNode[]
  exercises: readonly ExercisePublic[]
  reducedMotion: boolean
}) {
  // "A node that just locked in plays its fill once and then stays lit
  // permanently" -- detected as a `closed` transition across renders of the
  // same mount. This is React's own documented "adjusting state when a prop
  // changes" pattern (the same one `QuerySeed` uses): the comparison runs
  // during render, not in an effect, so there is no synchronous setState
  // inside a `useEffect` body. The very first render never flags anything --
  // `previousNodes` starts equal to `nodes`, so there is nothing to diff yet.
  const [previousNodes, setPreviousNodes] = useState(nodes)
  const [justLockedIn, setJustLockedIn] = useState<ReadonlySet<CloId>>(new Set())
  if (nodes !== previousNodes) {
    const changed = new Set<CloId>()
    for (const node of nodes) {
      const before = previousNodes.find((prior) => prior.cloId === node.cloId)
      if (node.closed && before && !before.closed) changed.add(node.cloId)
    }
    setJustLockedIn(changed)
    setPreviousNodes(nodes)
  }

  return (
    <ol aria-label="Skill path" className="flex flex-col">
      {nodes.map((node, index) => (
        <NodeItem
          key={node.cloId}
          node={node}
          index={index}
          isLast={index === nodes.length - 1}
          exercises={exercises}
          reducedMotion={reducedMotion}
          justLockedIn={justLockedIn.has(node.cloId)}
        />
      ))}
    </ol>
  )
}
