'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { StatusBadge } from './StatusBadge'
import type { UserRow } from './types'
import { INTEGRITY_THRESHOLDS, type IntegrityEventType } from '@/lib/contracts'

interface UsersTableProps {
  rows: UserRow[]
  onLift: (id: string) => void
  onRestrict: (id: string) => void
  onBan: (id: string) => void
}

const EVENT_LABELS: Record<IntegrityEventType, string> = {
  blur: 'blur',
  idle: 'idle',
  'paste-blocked': 'paste',
  'copy-blocked': 'copy',
  printscreen: 'prtscn',
  'contextmenu-blocked': 'ctxmenu',
}

function thresholdLabel(score: number): string {
  const { warnAt, restrictAt, banAt } = INTEGRITY_THRESHOLDS
  if (score >= banAt) return `>= ${banAt} ban`
  if (score >= restrictAt) return `>= ${restrictAt} restrict`
  if (score >= warnAt) return `>= ${warnAt} warn`
  return `< ${warnAt}`
}

function formatEventCounts(counts: Partial<Record<IntegrityEventType, number>>): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([type, count]) => `${EVENT_LABELS[type as IntegrityEventType]} ${count}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function formatDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
}

export function UsersTable({ rows, onLift, onRestrict, onBan }: UsersTableProps) {
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (sortDir === 'desc' ? b.integrity_score - a.integrity_score : a.integrity_score - b.integrity_score)),
    [rows, sortDir]
  )

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-body text-muted-foreground">
        No users yet.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border text-left text-micro text-muted-foreground">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">
              <button
                type="button"
                onClick={() => setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'))}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                Score {sortDir === 'desc' ? '↓' : '↑'}
              </button>
            </th>
            <th className="px-3 py-2 font-medium">Events</th>
            <th className="px-3 py-2 font-medium">Last seen</th>
            <th className="px-3 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <UserRowView key={row.id} row={row} onLift={onLift} onRestrict={onRestrict} onBan={onBan} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UserRowView({
  row,
  onLift,
  onRestrict,
  onBan,
}: {
  row: UserRow
  onLift: (id: string) => void
  onRestrict: (id: string) => void
  onBan: (id: string) => void
}) {
  const canLift = row.account_status === 'warned' || row.account_status === 'restricted' || row.account_status === 'banned'
  const canRestrict = row.account_status !== 'restricted' && row.account_status !== 'banned'
  const canBan = row.account_status !== 'banned'

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-2 font-medium">{row.display_name}</td>
      <td className="px-3 py-2 text-muted-foreground">{row.email ?? '—'}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <StatusBadge status={row.account_status} />
          {row.account_status === 'restricted' && row.restricted_until && (
            <span className="text-[11px] text-muted-foreground">until {formatDate(row.restricted_until)}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        {row.integrity_score} <span className="text-muted-foreground">{thresholdLabel(row.integrity_score)}</span>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{formatEventCounts(row.event_counts)}</td>
      <td className="px-3 py-2 text-muted-foreground">{formatDate(row.last_seen_at)}</td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={!canLift} onClick={() => onLift(row.id)}>
            Lift
          </Button>
          <Button size="sm" variant="outline" disabled={!canRestrict} onClick={() => onRestrict(row.id)}>
            Restrict
          </Button>
          <Dialog>
            <DialogTrigger render={<Button size="sm" variant="destructive" disabled={!canBan} />}>Ban</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ban {row.display_name}?</DialogTitle>
                <DialogDescription>
                  This blocks sign-in immediately. The student can appeal by contacting the admin.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <DialogClose render={<Button variant="destructive" onClick={() => onBan(row.id)} />}>Confirm ban</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </td>
    </tr>
  )
}
