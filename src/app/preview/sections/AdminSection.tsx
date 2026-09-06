'use client'

import { useState } from 'react'
import { AgentUsageTable, BankStatsTable, InvitesTable, MintInviteForm, UsersTable } from '@/components/admin'
import type { UserRow } from '@/components/admin/types'
import { fixtureAgentUsage, fixtureBankStats, fixtureCloRefs, fixtureInvites, fixtureUsers } from '../fixtures'
import { Section } from './Section'

export function AdminSection() {
  const [status, setStatus] = useState('No actions yet.')
  const [users, setUsers] = useState<UserRow[]>(fixtureUsers)

  function setUserStatus(id: string, next: UserRow['account_status'], label: string) {
    setUsers((current) => current.map((user) => (user.id === id ? { ...user, account_status: next } : user)))
    setStatus(`${label}: ${id}`)
  }

  return (
    <Section id="admin" title="Admin" caption="The four admin tables with fixture rows covering every account status and 14 days of agent usage. Actions log to the status line below instead of writing to Supabase.">
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Mint invite</h3>
        <MintInviteForm onMint={(email) => setStatus(`Minted invite for ${email}`)} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Invites</h3>
        <InvitesTable rows={fixtureInvites} onRevoke={(code) => setStatus(`Revoked invite ${code}`)} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Users</h3>
        <UsersTable
          rows={users}
          onLift={(id) => setUserStatus(id, 'active', 'Lifted')}
          onRestrict={(id) => setUserStatus(id, 'restricted', 'Restricted')}
          onBan={(id) => setUserStatus(id, 'banned', 'Banned')}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Bank coverage</h3>
        <BankStatsTable rows={fixtureBankStats} clos={fixtureCloRefs} />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Agent usage (14 days)</h3>
        <AgentUsageTable rows={fixtureAgentUsage} />
      </div>

      <p role="status" className="text-xs text-muted-foreground">{status}</p>
    </Section>
  )
}
