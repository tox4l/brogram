import type { AccountStatus } from '@/lib/contracts'

export function BannedAccount() {
  return (
    <div className="space-y-3">
      <p role="alert" className="text-lg font-medium">Your BroGram account has been banned.</p>
      <p className="text-sm leading-relaxed text-muted-foreground">Contact Velocity through your invitation email to appeal.</p>
    </div>
  )
}

export function AccountNotice({ status, restrictedUntil }: { status: AccountStatus; restrictedUntil: string | null }) {
  if (status !== 'restricted' && status !== 'warned') return null
  return (
    <div role="status" className="border-b border-white/10 bg-white/5 px-6 py-3 text-sm text-zinc-300">
      {status === 'warned' ? 'Type your own work. Clipboard attempts and leaving an exercise are recorded.' : (
        <>Exercises are paused{restrictedUntil ? <> until <time dateTime={restrictedUntil}>{new Intl.DateTimeFormat('en', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Qatar',
        }).format(new Date(restrictedUntil))} (Doha)</time></> : ' until Velocity reviews your restriction'}. Your dashboard and De-rot remain available.</>
      )}
    </div>
  )
}
