'use client'

/**
 * R9.5 / R9.4: "Integrity, explained" -- the one place the whole policy is
 * stated once, plus the learner's own current arithmetic. Self-contained: it
 * reads the signed-in session and fetches its own data, so it can be mounted
 * wherever it is needed (Account, permanently; a warned or restricted notice,
 * as the leaner `receipt` variant) with no props at all.
 *
 * Deliberately flat register throughout (R9.6, standing constraint #11): no
 * "bro" voice, no sound, no animation, no colour beyond `--warning` and
 * `--destructive`. This is an enforcement surface.
 *
 * Never renders for a banned account: the banned screen renders
 * unauthenticated (`src/lib/supabase/middleware.ts` signs the learner out to
 * `/login?reason=banned` before it paints), so `my_integrity_breakdown()`
 * would read `auth.uid()` as null and hand back nothing -- an empty table on
 * that one screen would read as a cover-up, not as "no ban". The banned
 * screen states the policy and the appeal channel instead (`guard.banned`),
 * with no per-user numbers; this component simply never mounts there.
 */
import { useQuery } from '@tanstack/react-query'
import type { AccountStatus, IntegrityEventType } from '@/lib/contracts'
import { INTEGRITY_THRESHOLDS } from '@/lib/contracts'
import { fetchIntegrityBreakdown, type IntegrityBreakdown } from '@/lib/integrity/breakdown'
import { readLocalIntegrityEvents } from '@/lib/integrity/localLog'
import { line } from '@/lib/voice/lines'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'

const EVENT_LABELS: Record<IntegrityEventType, string> = {
  printscreen: 'Screenshot attempts',
  'paste-blocked': 'Paste blocked',
  'copy-blocked': 'Copy blocked',
  blur: 'Tab-away',
  'contextmenu-blocked': 'Right-click blocked',
  idle: 'Idle (not scored)',
}

/** The threshold each status was warned or restricted for, when the caller
 *  does not name one explicitly -- matches `guard.warned`/`guard.restricted`'s
 *  own wording ("Flags crossed 10/20 in the last 7 days"). */
const THRESHOLD_FOR_STATUS: Partial<Record<AccountStatus, number>> = {
  warned: INTEGRITY_THRESHOLDS.warnAt,
  restricted: INTEGRITY_THRESHOLDS.restrictAt,
}

export interface IntegrityPanelProps {
  /**
   * `'full'` (default) -- the whole policy explainer plus the receipt, for
   * the permanent Account/Progress surface.
   * `'receipt'` -- only the itemised rows and total, for a warned or
   * restricted notice that already carries its own `guard.warned`/
   * `guard.restricted` framing and does not need the policy repeated.
   */
  variant?: 'full' | 'receipt'
  /**
   * The threshold this rendering is about ("The line is {n}."), when known.
   * Defaults from the learner's current `accountStatus` (10 for warned, 20
   * for restricted); omit entirely by passing `null` for the plain Account
   * view, where no single threshold is "the" one being explained.
   */
  crossedAt?: number | null
}

function Receipt({ breakdown, crossedAt }: { breakdown: IntegrityBreakdown; crossedAt?: number | null }) {
  if (breakdown.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No flags in the last 7 days.</p>
  }
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {breakdown.rows.map((row) => (
          <li key={row.type} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-sm">
            <span>{EVENT_LABELS[row.type]}</span>
            <span className="font-mono text-xs text-muted-foreground">{row.events} at weight {row.weight} — {row.points}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm font-medium">
        Total {breakdown.total}.{crossedAt != null && ` The line is ${crossedAt}.`}
      </p>
      {breakdown.source === 'local' && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          This is what this browser itself has recorded, not the server&apos;s full seven-day count. The server&apos;s own record is what decided your status.
        </p>
      )}
    </div>
  )
}

export function IntegrityPanel({ variant = 'full', crossedAt }: IntegrityPanelProps = {}) {
  const userId = useSession((session) => session.user?.id ?? null)
  const accountStatus = useSession((session) => session.profile?.account_status ?? 'active')

  const query = useQuery({
    queryKey: ['integrity-breakdown', userId],
    queryFn: () => fetchIntegrityBreakdown(createClient(), readLocalIntegrityEvents()),
    enabled: userId !== null && accountStatus !== 'banned',
    staleTime: 30_000,
  })

  // The banned screen is unauthenticated and never gets here in practice
  // (see the module doc above); this is the defence-in-depth version of the
  // same rule, independent of whichever page mounts this component.
  if (!userId || accountStatus === 'banned') return null

  const resolvedCrossedAt = crossedAt === undefined ? THRESHOLD_FOR_STATUS[accountStatus] : (crossedAt ?? undefined)

  return (
    <section aria-labelledby="integrity-heading" className="space-y-5">
      {variant === 'full' && (
        <div className="space-y-2">
          <h2 id="integrity-heading" className="text-lg font-medium tracking-tight">Integrity, explained</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{line('guard.why')}</p>
        </div>
      )}

      {variant === 'full' && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-muted-foreground">Flags before a warning</dt>
            <dd className="font-mono">{INTEGRITY_THRESHOLDS.warnAt}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-muted-foreground">Flags before reps pause for {INTEGRITY_THRESHOLDS.restrictHours}h</dt>
            <dd className="font-mono">{INTEGRITY_THRESHOLDS.restrictAt}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-muted-foreground">Flags before an account is banned</dt>
            <dd className="font-mono">{INTEGRITY_THRESHOLDS.banAt}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block sm:space-y-0.5">
            <dt className="text-muted-foreground">Paste blocks in one exercise that pause reps instantly</dt>
            <dd className="font-mono">{INTEGRITY_THRESHOLDS.instantRestrictPasteCount}</dd>
          </div>
        </dl>
      )}

      {variant === 'full' && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every exercise is generated per learner. A leaked solution matches nobody else&apos;s problem, which is the real backstop underneath all of this.
        </p>
      )}

      <div>
        {variant === 'full' && <h3 className="mb-2 text-sm font-medium text-muted-foreground">Your record, last 7 days</h3>}
        {query.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading your record.</p>
        ) : query.isError ? (
          <p role="alert" className="text-sm text-muted-foreground">Your record could not load. Try again shortly.</p>
        ) : (
          <Receipt breakdown={query.data ?? { rows: [], total: 0, source: 'server' }} crossedAt={resolvedCrossedAt} />
        )}
      </div>
    </section>
  )
}
