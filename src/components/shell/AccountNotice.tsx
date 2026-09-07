import Link from 'next/link'
import type { AccountStatus } from '@/lib/contracts'
import { IntegrityPanel } from '@/components/account/IntegrityPanel'
import { line, lineWith } from '@/lib/voice/lines'

/**
 * Fix round 1, C2: this file appeared in no wave-2 ownership row, so the
 * warned/restricted/banned frames the whole receipt (T2.8) was built for
 * reached no screen -- assigned here for the fix round.
 */

function formatRestrictedUntil(iso: string): string {
  return `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Qatar' }).format(new Date(iso))} (Doha)`
}

/**
 * Mounted at `src/app/(auth)/login/page.tsx` when `?reason=banned`, with no
 * `SessionProvider`/`QueryProvider` above it -- a banned learner has already
 * been signed out server-side (`src/lib/supabase/middleware.ts`). `guard.banned`
 * already carries the whole disclosure as one self-contained sentence --
 * weights, thresholds, the 7-day window and the appeal channel -- so this
 * renders no receipt and reads no session: an empty table on the one screen
 * with nothing underneath it would read as a cover-up (spec R9.4, corrected),
 * and there is nothing here to read a session from anyway.
 *
 * The heading and the short "Contact Velocity..." line are the original v1
 * copy; T2.7b re-pointed the heading's opening word ("Your" -> "This",
 * voice rule 3) together with the two tests that pinned it
 * (`src/app/(auth)/login/page.test.tsx`, `AccountNotice.test.tsx`).
 * `guard.banned`'s full disclosure is added underneath, which is what C2
 * actually required -- the weights, the thresholds and the window reaching
 * this screen at all.
 */
export function BannedAccount() {
  return (
    <div className="space-y-3">
      <p role="alert" className="text-lg font-medium">This BroGram account has been banned.</p>
      <p className="text-sm leading-relaxed text-muted-foreground">Contact Velocity through your invitation email to appeal.</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{line('guard.banned')}</p>
    </div>
  )
}

/**
 * Mounted inside both `SessionProvider` and `QueryProvider`
 * (`src/app/(app)/layout.tsx`), so `<IntegrityPanel>` can read the signed-in
 * session and fetch its own receipt. R9.3/R9.4: the receipt has to arrive
 * before the ban, or it never arrives -- warned and restricted both get the
 * bank's frame plus the itemised rows beneath it, and a link to the full
 * "Integrity, explained" policy in Account.
 *
 * The five-paste instant restriction and the score-threshold restriction
 * (spec 9.3) are two different causes with two different bank lines
 * (`guard.restricted.paste` vs `guard.restricted`), but `profiles` only
 * carries `account_status`/`restricted_until` -- no cause column exists to
 * tell them apart here. Defaults to the score-threshold framing
 * (`guard.restricted`), the same fallback the Opus review itself proposed;
 * flagged to the controller as a decision, not a guess (see the fix-round
 * report) -- a cause column is a schema change outside this component's reach.
 */
export function AccountNotice({ status, restrictedUntil }: { status: AccountStatus; restrictedUntil: string | null }) {
  if (status !== 'restricted' && status !== 'warned') return null
  const time = restrictedUntil ? formatRestrictedUntil(restrictedUntil) : 'the next review'
  return (
    <div role="status" className="space-y-3 border-b border-border bg-muted px-6 py-4 text-sm text-foreground">
      <p>{status === 'warned' ? line('guard.warned') : lineWith('guard.restricted', { time })}</p>
      <IntegrityPanel variant="receipt" />
      <Link href="/account" className="inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
        Integrity, explained
      </Link>
    </div>
  )
}
