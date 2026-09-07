'use client'

import { useState } from 'react'

/**
 * The trophy shelf's one-time entrance flourish (spec 10.10): "a trophy
 * unlocked in this session gets one entrance flourish and then sits still."
 *
 * Baseline is captured once, the moment `ready` first turns true (the
 * achievements query has settled -- see `page.tsx`'s `!query.isPending`) --
 * never on the very first call, which would otherwise run while
 * `unlockedIds` is still `[]` (the query has not resolved yet) and freeze an
 * empty baseline, making every already-held trophy read as "fresh" the
 * instant real data arrives. Everything unlocked after that captured
 * baseline, for as long as this component instance stays mounted, is
 * "fresh"; TrophyShelf turns that into the one-time flourish.
 *
 * State is adjusted during render rather than in an effect -- the same
 * documented pattern `QuerySeed` (`src/components/shell/QuerySeed.tsx`) uses
 * for "capture once, on the render that first has what you need" -- so the
 * very first paint with real data already has a correct baseline, with no
 * one-frame flash of every trophy as fresh.
 */
export function useFreshlyUnlocked(unlockedIds: readonly string[], ready: boolean): string[] {
  const [baseline, setBaseline] = useState<Set<string> | null>(null)

  if (baseline === null) {
    if (ready) setBaseline(new Set(unlockedIds))
    return []
  }

  return unlockedIds.filter((id) => !baseline.has(id))
}
