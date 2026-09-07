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
 *  path" / the skipped notice, so nothing here needs to double it.
 *
 *  Wave 4 spec 4 ("Measure"): the reading surface reserves a 12rem (`w-48`)
 *  rail alongside the outer `max-w-5xl` and the `max-w-[68ch]` prose column
 *  in `LessonView.tsx`, so the prose cap actually binds instead of the
 *  outer width winning by default. The dots themselves stay exactly as
 *  wide as before -- only the column they sit in grows.
 *
 *  Fix round 1 (M1): `items-center` orphaned the dots ~96px from either
 *  edge of the widened 192px column, ~120px of dead space between the
 *  index and what it indexes. `items-end` plus `pr-4` hugs the dots to the
 *  prose column's edge instead. */
export function ProgressRail({ total, current }: { total: number; current: number }) {
  const position = Math.min(current + 1, Math.max(total, 1))
  return (
    <nav aria-label="Walkthrough progress" className="hidden w-48 shrink-0 flex-col items-end gap-2 pt-2 pr-4 sm:flex">
      <p className="sr-only">Block {position} of {total}</p>
      <ol className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <li key={index} className={`size-1.5 rounded-full ${index <= current ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </ol>
    </nav>
  )
}
