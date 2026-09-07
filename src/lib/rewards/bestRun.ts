/**
 * "Personal best," decided once, for a single de-rot run (spec 7.6's `best`
 * sound row, RunSummary's own "New best" badge). Pure and tiny on purpose:
 * both `src/app/(app)/derot/arcade/[kind]/page.tsx` and
 * `.../derot/play/[game]/page.tsx` already compute `previousBest` (via
 * `statsForKind`, owned by the de-rot lane) and then repeat this exact
 * comparison inline to decide the "New best" badge. This is that comparison,
 * factored out once so the badge and the `best` sound it currently has no
 * producer for (X8) are guaranteed to agree -- there is no way for one to
 * fire without the other once both read this instead of restating the check.
 *
 * `previousBest === null` (a first-ever run of a kind) is deliberately never
 * a personal best (the de-rot lane's own documented rough edge: T2.9a's run
 * model would otherwise make every first run "personal best"). Ties do not
 * count either -- only a strict improvement is a new best, the same
 * direction `beat-yourself` (achievements.ts's `countPersonalBests`) already
 * counts in.
 */
export function isPersonalBest(previousBest: number | null, score: number): boolean {
  return previousBest !== null && score > previousBest
}
