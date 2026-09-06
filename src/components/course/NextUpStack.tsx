'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, Sparkles } from 'lucide-react'
import type { Difficulty, Language } from '@/lib/contracts'
import type { NextUpCard } from '@/lib/course/map'
import { cn } from '@/lib/utils'

const LANGUAGE_NAMES: Record<Language, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  java: 'Java', sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript',
}

/** Glossary §2.6: a number never reaches learner-facing copy. */
const DIFFICULTY_NAMES: Record<Difficulty, string> = { 1: 'easy', 2: 'light', 3: 'medium', 4: 'spicy', 5: 'brutal' }

function CardShell({ children, dashed }: { children: ReactNode; dashed?: boolean }) {
  return (
    <div className={cn('flex h-full flex-col justify-between gap-3 rounded-xl border p-4', dashed ? 'border-dashed border-input' : 'border-border')}>
      {children}
    </div>
  )
}

/**
 * R3.8: always exactly three cards. `cards` is already shaped by `nextUp()`
 * -- this component only renders what it is handed, including the case
 * where the current skill has no walkthrough yet (only the golden lesson
 * exists until T1.1's batch lands): that card renders a placeholder instead
 * of a link into empty content.
 */
export function NextUpStack({ cards }: { cards: NextUpCard[] }) {
  return (
    <section aria-labelledby="next-up-heading" className="space-y-3">
      <h2 id="next-up-heading" className="text-base font-medium">Next up</h2>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Pick a course to see your next three reps here.</p>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-3">
          {cards.map((card) => (
            <li key={`${card.kind}-${card.id}`}>
              {card.kind === 'walkthrough' && card.lessonAvailable === false ? (
                <CardShell dashed>
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <BookOpen className="size-3.5" aria-hidden="true" />Walkthrough
                    </span>
                    <p className="mt-1.5 text-sm font-medium text-foreground">Coming soon for this skill.</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Start with the rep beside it for now.</p>
                </CardShell>
              ) : (
                <Link
                  href={card.href}
                  className="flex h-full flex-col justify-between gap-3 rounded-xl border border-border p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      {card.kind === 'walkthrough'
                        ? <><BookOpen className="size-3.5" aria-hidden="true" />Walkthrough</>
                        : <>{card.language ? (LANGUAGE_NAMES[card.language] ?? card.language) : ''} · {card.difficulty ? DIFFICULTY_NAMES[card.difficulty] : ''}</>}
                    </span>
                    <p className="mt-1.5 text-sm font-medium text-foreground">{card.title}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    {card.pickedForYou && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Sparkles className="size-3" aria-hidden="true" />Picked for you
                      </span>
                    )}
                    <ArrowRight className="ml-auto size-4 text-primary" aria-hidden="true" />
                  </div>
                  {card.caption && <p className="text-xs text-muted-foreground">{card.caption}</p>}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
