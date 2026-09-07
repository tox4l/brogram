'use client'

/** A slim left rail showing block count (spec 10.5). Decorative dots are
 *  `aria-hidden`; the real accessible summary is the `sr-only` text. */
export function ProgressRail({ total, current }: { total: number; current: number }) {
  const position = Math.min(current + 1, Math.max(total, 1))
  return (
    <nav aria-label="Walkthrough progress" className="hidden w-4 shrink-0 flex-col items-center gap-2 pt-2 sm:flex">
      <p className="sr-only" role="status">Block {position} of {total}</p>
      <ol className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <li key={index} className={`size-1.5 rounded-full ${index <= current ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </ol>
    </nav>
  )
}
