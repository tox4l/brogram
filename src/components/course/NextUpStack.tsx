'use client'

import Link from 'next/link'
import { ArrowRight, BookOpen, LockKeyhole, Sparkles } from 'lucide-react'
import type { Language } from '@/lib/contracts'
import type { NextUpCard } from '@/lib/course/map'
import { difficultyWord } from '@/lib/voice/glossary'
import { cn } from '@/lib/utils'

const LANGUAGE_NAMES: Record<Language, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  java: 'Java', sql: 'SQL', mongo: 'MongoDB', web: 'HTML, CSS & JavaScript',
}

/**
 * R3.8: always exactly three cards. `cards` is already shaped by `nextUp()`
 * -- a CLO with no lesson yet never produces a walkthrough card in the first
 * place (fix-round C1), so every card here is a live action, never a
 * placeholder burning a seat.
 *
 * `restricted`: exercise cards render the same flat, non-link restricted
 * treatment `dashboard/page.tsx` already uses (spec §10.4 -- "restricted:
 * map read-only, walkthroughs still open"); a walkthrough card stays a live
 * link regardless. `reducedMotion` gates the hover lift/colour transition on
 * the resolved boolean rather than the `motion-reduce:` media query, so the
 * learner's own `wellness.prefs.motion` choice is honoured in both
 * directions (standing constraint 12).
 */
export function NextUpStack({ cards, reducedMotion, restricted }: { cards: NextUpCard[]; reducedMotion: boolean; restricted: boolean }) {
  return (
    <section aria-labelledby="next-up-heading" className="space-y-3">
      <h2 id="next-up-heading" className="text-base font-medium">Next up</h2>
      {restricted && <p className="text-sm text-muted-foreground">Reps are paused while your account is restricted.</p>}
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Pick a course to see your next three reps here.</p>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-3">
          {cards.map((card) => {
            const blocked = restricted && card.kind === 'exercise'
            const cardClassName = cn(
              'flex h-full flex-col justify-between gap-3 rounded-xl border border-border p-4 outline-none',
              blocked ? 'cursor-not-allowed opacity-80' : 'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
              !reducedMotion && !blocked && 'transition-colors',
            )
            const body = (
              <>
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    {card.kind === 'walkthrough'
                      ? <><BookOpen className="size-3.5" aria-hidden="true" />Walkthrough</>
                      : <>{card.language ? (LANGUAGE_NAMES[card.language] ?? card.language) : ''} · {card.difficulty ? difficultyWord(card.difficulty) : ''}</>}
                  </span>
                  <p className="mt-1.5 text-sm font-medium text-foreground">{card.title}</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {card.pickedForYou && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Sparkles className="size-3" aria-hidden="true" />Picked for you
                    </span>
                  )}
                  {blocked
                    ? <LockKeyhole className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
                    : <ArrowRight className="ml-auto size-4 text-primary" aria-hidden="true" />}
                </div>
                {card.caption && <p className="text-xs text-muted-foreground">{card.caption}</p>}
              </>
            )
            return (
              <li key={`${card.kind}-${card.id}`}>
                {blocked
                  ? <div className={cardClassName}>{body}</div>
                  : <Link href={card.href} className={cardClassName}>{body}</Link>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
