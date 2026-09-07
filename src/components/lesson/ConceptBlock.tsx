'use client'

import { useMemo } from 'react'
import type { LessonPublicBlock } from '@/lib/contracts'

type ConceptBlockData = Extract<LessonPublicBlock, { type: 'concept' }>

/** Every element `figure` is allowed to contain. Notably absent: `script`,
 *  `foreignObject`, `iframe`, `image` (an external asset), `style` (CSS
 *  `url()` exfiltration/injection) -- anything not on this list is dropped,
 *  not escaped, so a hostile tag never reaches the DOM in any form. */
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath',
  'use', 'title', 'desc', 'marker', 'symbol',
])

/** `href`/`xlink:href` is only legitimate here as a same-document `#fragment`
 *  reference (a `<use>` pointing at a `<defs>` shape) -- never `javascript:`,
 *  `data:`, or an external URL. */
function isSafeReference(value: string): boolean {
  return value.startsWith('#')
}

function stripUnsafe(node: Element): void {
  for (const child of Array.from(node.children)) {
    if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
      child.remove()
      continue
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) child.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'xlink:href') && !isSafeReference(attr.value)) child.removeAttribute(attr.name)
    }
    stripUnsafe(child)
  }
}

/**
 * Fix round 1 (I6): nothing in the content pipeline enforces contracts.ts's
 * documented rule ("No external assets, no `<script>`, no `<foreignObject>`")
 * -- checked `scripts/build-static-curriculum.mjs` (whitelists the `figure`
 * *key*, never inspects its value), `seed/lessons/lesson.schema.json`
 * (`{"type":"string"}`, no pattern), and `scripts/verify-lesson.mjs` (never
 * mentions `figure`). Authors are LLM subagents writing straight into
 * `seed/lessons/**`, so "it's authored content" is a weaker boundary than a
 * comment claiming a guard that does not exist. This sanitises at render
 * instead, with an explicit tag/attribute allowlist: parse as SVG, drop any
 * element outside `ALLOWED_TAGS` (a `<script>` or `<foreignObject>`
 * included) and every `on*` handler attribute, re-serialise, and render
 * nothing at all if the source does not even parse as an `<svg>` root.
 */
function sanitizeSvg(source: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.tagName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null
    stripUnsafe(root)
    return new XMLSerializer().serializeToString(root)
  } catch {
    return null
  }
}

export function ConceptBlock({ block }: { block: ConceptBlockData }) {
  const safeFigure = useMemo(() => (block.figure ? sanitizeSvg(block.figure) : null), [block.figure])
  return (
    <section aria-label="Concept" className="space-y-3">
      <h2 className="text-xl font-medium tracking-tight">{block.heading}</h2>
      {/* Fix round 1 (I3): this is the lesson's actual reading prose, which
       *  step 7 says "moves to --text-lede / 1.6 in --lesson-foreground,
       *  never --muted-foreground" -- matches LessonView's hook exactly, so
       *  a Newsreader hook is never followed by a 14px gray paragraph. */}
      <p className="whitespace-pre-wrap font-prose text-lede leading-[1.6] text-lesson-foreground">{block.body}</p>
      {safeFigure && (
        <div
          className="overflow-hidden rounded-lg border border-border [&_svg]:h-auto [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: safeFigure }}
        />
      )}
    </section>
  )
}
