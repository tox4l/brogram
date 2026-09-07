'use client'

/** A slim left rail showing block count (spec 10.5). Decorative dots are
 *  `aria-hidden`; the real accessible summary is the `sr-only` text.
 *
 *  A11Y-06: this is a queryable label, not a live region -- `role="status"`
 *  is an implicit `aria-live="polite"`, and `LessonView` advances `current`
 *  on every block scrolled into view, so a "live" rail would re-announce a
 *  handful of five-word interruptions over the length of a walkthrough for
 *  no promise the spec makes (10.5 asks only for "a slim left progress rail
 *  showing block count", nothing about it speaking). The one moment worth
 *  announcing -- the walkthrough finishing -- already gets its own
 *  `role="status"` line in `LessonView` when it renders "Back to your
 *  path" / the skipped notice, so nothing here needs to double it. */
export function ProgressRail({ total, current }: { total: number; current: number }) {
  const position = Math.min(current + 1, Math.max(total, 1))
  return (
    <nav aria-label="Walkthrough progress" className="hidden w-4 shrink-0 flex-col items-center gap-2 pt-2 sm:flex">
      <p className="sr-only">Block {position} of {total}</p>
      <ol className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <li key={index} className={`size-1.5 rounded-full ${index <= current ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </ol>
    </nav>
  )
}
