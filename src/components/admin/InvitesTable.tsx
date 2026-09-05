'use client'

import { Button } from '@/components/ui/button'
import type { InviteRow } from './types'

interface InvitesTableProps {
  rows: InviteRow[]
  onRevoke?: (code: string) => void
}

function formatDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed)
}

/** Open invites first; within each group, newest first. */
function sortInvites(rows: InviteRow[]): InviteRow[] {
  return [...rows].sort((a, b) => {
    const aOpen = a.redeemed_at === null
    const bOpen = b.redeemed_at === null
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function InvitesTable({ rows, onRevoke }: InvitesTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No invites yet. Mint one above.
      </div>
    )
  }

  const sorted = sortInvites(rows)

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Created</th>
            <th className="px-3 py-2 font-medium">Status</th>
            {onRevoke && <th className="px-3 py-2 font-medium text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((invite) => {
            const open = invite.redeemed_at === null
            return (
              <tr key={invite.code} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2">{invite.email}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{invite.code}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDate(invite.created_at)}</td>
                <td className="px-3 py-2">
                  {open ? (
                    <span className="text-muted-foreground">Open</span>
                  ) : (
                    <span>Redeemed {formatDate(invite.redeemed_at as string)}</span>
                  )}
                </td>
                {onRevoke && (
                  <td className="px-3 py-2 text-right">
                    {open && (
                      <Button size="sm" variant="outline" onClick={() => onRevoke(invite.code)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
