'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { AccountStatus } from '@/lib/contracts'
import { restrictedCause, type IntegrityBreakdown } from '@/lib/integrity/breakdown'
import { line, lineWith } from '@/lib/voice/lines'

/**
 * Fix round 1, C2: this file appeared in no wave-2 ownership row, so the
 * warned/restricted/banned frames the whole receipt (T2.8) was built for
 * reached no screen -- assigned here for the fix round.
 *
 * Fix round 2, N4: this is now a client component (it reaches
 * `useIntegrityBreakdown`, needed for N1/N3 below) rather than calling
 * `line()`/`lineWith()` with no seed from a server render -- the bank's own
 * doc on `line()` says that path is client-only.
 *
 * W4FIX-B2 re-check (F4/M4): `IntegrityPanel` and `useIntegrityBreakdown`
 * used to be imported statically from `@/components/account/IntegrityPanel`
 * at the top of this file -- a module that itself imports
 * `@tanstack/react-query`'s `useQuery`. `BannedAccount` (below) and `Banner`
 * (further down) are exported from this SAME file, and
 * `src/app/(auth)/login/page.tsx` imports only `BannedAccount` from here --
 * but a static import at module scope pulls the whole imported module into
 * whatever bundle reaches this file regardless of which export is actually
 * used, so `/login` paid for a 45.6 KB chunk containing `@tanstack/react-query`
 * even though `BannedAccount` itself never touches it. `next/dynamic` only
 * defers a COMPONENT's import, and `useIntegrityBreakdown` is a hook --
 * hooks cannot be fetched after the fact and called conditionally (Rules of
 * Hooks) -- so the whole warned/restricted receipt, hook call included, is
 * defined as one dynamically-imported unit below (`DynamicIntegrityReceipt`):
 * `mod.useIntegrityBreakdown()` only ever runs inside a component that
 * itself exists once `@/components/account/IntegrityPanel` has already
 * loaded, so that module's own dependency graph never reaches `/login`'s
 * synchronous chunk. `ssr: false` is correct, not just permitted: this
 * receipt is only ever rendered for a signed-in warned/restricted learner,
 * behind `SessionProvider`/`QueryProvider` (see `Banner`'s own doc below),
 * so there is nothing for it to contribute to a server-rendered banned/
 * anonymous page in the first place.
 */
const DynamicIntegrityReceipt = dynamic(
  () =>
    import('@/components/account/IntegrityPanel').then((mod) => ({
      default: function IntegrityReceipt({ status, time }: { status: 'warned' | 'restricted'; time: string }) {
        const query = mod.useIntegrityBreakdown()
        const frame = status === 'warned' ? warnedFrame(query.data) : restrictedFrame(query.data, time)
        return (
          <>
            <p role="status">{frame}</p>
            <mod.IntegrityPanel variant="receipt" />
          </>
        )
      },
    })),
  { ssr: false },
)

function formatRestrictedUntil(iso: string): string {
  return `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Qatar' }).format(new Date(iso))} (Doha)`
}

/**
 * Fix round 2, N1: `guard.warned`'s "exactly what counted" is only true once
 * the receipt beneath it is the server's own count. Before that is confirmed
 * -- including while the query is still loading -- this defaults to the
 * honest, device-record wording rather than ever flashing a promise the
 * receipt underneath immediately retracts.
 */
function warnedFrame(breakdown: IntegrityBreakdown | undefined): string {
  return breakdown?.source === 'server' ? line('guard.warned') : line('guard.warned.local')
}

/**
 * Fix round 2, N1/N3: mirrors `warnedFrame`, plus derives which of the
 * trigger's two conditions caused the restriction from the aggregate itself
 * (`restrictedCause()`) instead of always naming the score threshold -- the
 * five-paste instant rule is a different, real cause the generic frame used
 * to misname (a learner restricted at 5 pastes / 10 points was shown "Flags
 * crossed 20", a plain contradiction against the receipt underneath).
 * `restrictedCause` is only sound on the server source (see its own doc);
 * the local fallback always gets the no-numeric-cause frame.
 */
function restrictedFrame(breakdown: IntegrityBreakdown | undefined, time: string): string {
  if (!breakdown || breakdown.source !== 'server') return lineWith('guard.restricted.local', { time })
  return restrictedCause(breakdown) === 'paste'
    ? lineWith('guard.restricted.paste', { time })
    : lineWith('guard.restricted', { time })
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
      <p role="alert" className="text-lede font-medium">This BroGram account has been banned.</p>
      <p className="text-small leading-relaxed text-muted-foreground">Contact Velocity through your invitation email to appeal.</p>
      <p className="text-small leading-relaxed text-muted-foreground">{line('guard.banned')}</p>
    </div>
  )
}

/**
 * Mounted inside both `SessionProvider` and `QueryProvider`
 * (`src/app/(app)/layout.tsx`), so `DynamicIntegrityReceipt`'s own
 * `useIntegrityBreakdown` (once its chunk loads) can read the signed-in
 * session and fetch the receipt. R9.3/R9.4: the receipt has to arrive before
 * the ban, or it never arrives -- warned and restricted both get the bank's
 * frame plus the itemised rows beneath it, and a link to the full
 * "Integrity, explained" policy in Account.
 */
/**
 * W2G-3 fix: the RPC-backed query used to be read unconditionally, one line
 * before this early return -- a hook call cannot itself be conditional, so
 * `AccountNotice` now decides whether to mount `Banner` at all, and only a
 * warned/restricted `Banner` ever mounts `DynamicIntegrityReceipt`, the one
 * place `useIntegrityBreakdown()` runs (fix round 2, F4). An `active` learner
 * -- every route load, on every screen the shell mounts this component --
 * no longer fires `my_integrity_breakdown()` (a 404 at schema 0005) for a
 * notice that was always going to render null.
 */
export function AccountNotice({ status, restrictedUntil }: { status: AccountStatus; restrictedUntil: string | null }) {
  if (status !== 'restricted' && status !== 'warned') return null
  return <Banner status={status} restrictedUntil={restrictedUntil} />
}

function Banner({ status, restrictedUntil }: { status: 'restricted' | 'warned'; restrictedUntil: string | null }) {
  const time = restrictedUntil ? formatRestrictedUntil(restrictedUntil) : 'the next review'

  return (
    <div className="space-y-3 border-b border-rule bg-muted px-6 py-4 text-small text-foreground">
      {/* Fix round 2, N1/N3/N5: the frame sentence and the itemised receipt
          both live inside `DynamicIntegrityReceipt` now (see its own doc
          above) -- `mod.useIntegrityBreakdown()` is read once there for both,
          identical `queryKey`, so react-query still serves one shared cache
          entry rather than firing the RPC twice. `role="status"` stays
          scoped to the frame sentence alone, same as before: the receipt and
          the link below it are not part of this one live announcement, and
          IntegrityPanel already manages its own state. */}
      <DynamicIntegrityReceipt status={status} time={time} />
      <Link href="/account" className="inline-block text-micro text-muted-foreground underline underline-offset-2 hover:text-foreground">
        Integrity, explained
      </Link>
    </div>
  )
}
