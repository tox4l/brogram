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

/**
 * Fix round 1, I2: on the schema-0005 fallback, the caveat leads (read before
 * any number) and "The line is {n}" never sits beside a total this component
 * knows may be incomplete -- printing both together presented an admittedly
 * partial, device-only count as if it were the arithmetic that decided the
 * learner's status. That is the same failure the spec rules out for the
 * banned screen ("an empty table reads as a cover-up"), in arithmetic form
 * rather than empty form. The server's total is the only one ever shown next
 * to "The line is" -- once `my_integrity_breakdown()` is reachable, this
 * caveat and the suppressed line both disappear on their own.
 */
function Receipt({ breakdown, crossedAt }: { breakdown: IntegrityBreakdown; crossedAt?: number | null }) {
  const isLocal = breakdown.source === 'local'
  return (
    <div className="space-y-3">
      {isLocal && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          This is this device&apos;s own record, not the server&apos;s count. The server&apos;s count is what actually decided the account&apos;s status, and will show here once it is reachable.
        </p>
      )}
      {breakdown.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No flags in the last 7 days.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {breakdown.rows.map((row) => (
              <li key={row.type} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 text-sm">
                <span>{EVENT_LABELS[row.type]}</span>
                <span className="font-mono text-xs text-muted-foreground">{row.events} at weight {row.weight} — {row.points}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium">
            Total {breakdown.total}.{!isLocal && crossedAt != null && ` The line is ${crossedAt}.`}
          </p>
        </>
      )}
    </div>
  )
}

export function IntegrityPanel({ variant = 'full', crossedAt }: IntegrityPanelProps = {}) {
  const userId = useSession((session) => session.user?.id ?? null)
  const accountStatus = useSession((session) => session.profile?.account_status ?? 'active')

  const query = useQuery({
    queryKey: ['integrity-breakdown', userId],
    // `userId` is non-null whenever this runs: `enabled` below gates it, and
    // the guard clause a few lines down returns before render otherwise --
    // but `enabled` and the render guard are evaluated separately, so the
    // fallback keeps `readLocalIntegrityEvents` from ever being asked for a
    // null id (fix round 1, C1 — this is also the userId the local log is
    // keyed and read by, so a signed-in learner never reads anyone else's).
    queryFn: () => fetchIntegrityBreakdown(createClient(), userId ? readLocalIntegrityEvents(userId) : []),
    enabled: userId !== null && accountStatus !== 'banned',
    staleTime: 30_000,
  })

  // The banned screen is unauthenticated and never gets here in practice
  // (see the module doc above); this is the defence-in-depth version of the
  // same rule, independent of whichever page mounts this component.
  if (!userId || accountStatus === 'banned') return null

  const resolvedCrossedAt = crossedAt === undefined ? THRESHOLD_FOR_STATUS[accountStatus] : (crossedAt ?? undefined)

  return (
    <section
      aria-labelledby={variant === 'full' ? 'integrity-heading' : undefined}
      aria-label={variant === 'full' ? undefined : 'Integrity record'}
      className="space-y-5"
    >
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
            <dt className="text-muted-foreground">Paste blocks in one rep that pause reps instantly</dt>
            <dd className="font-mono">{INTEGRITY_THRESHOLDS.instantRestrictPasteCount}</dd>
          </div>
        </dl>
      )}

      {variant === 'full' && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every rep is generated per learner. A leaked solution matches nobody else&apos;s problem, which is the real backstop underneath all of this.
        </p>
      )}

      <div>
        {variant === 'full' && <h3 className="mb-2 text-sm font-medium text-muted-foreground">Last 7 days</h3>}
        {query.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">Loading the record.</p>
        ) : query.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <p>{line('error.load')}</p>
            <button type="button" onClick={() => void query.refetch()} className="underline underline-offset-2 hover:text-foreground">Try again</button>
          </div>
        ) : (
          <Receipt breakdown={query.data ?? { rows: [], total: 0, source: 'server' }} crossedAt={resolvedCrossedAt} />
        )}
      </div>
    </section>
  )
}
