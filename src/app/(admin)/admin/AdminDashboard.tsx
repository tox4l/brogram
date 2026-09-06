'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AgentUsageTable, BankStatsTable, CreateAccountForm, InvitesTable, MintInviteForm, UsersTable } from '@/components/admin'
import type { AgentUsageRow, BankStatRow, CloRef, InviteRow, UserRow } from '@/components/admin/types'

interface ErrorBody {
  ok: false
  error: string
}

async function getJson<T extends { ok: true }>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const body = (await res.json().catch(() => null)) as T | ErrorBody | null
  if (!res.ok || !body || body.ok === false) {
    throw new Error((body as ErrorBody | null)?.error ?? `Request failed (${res.status})`)
  }
  return body
}

function SectionSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-2">
      <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
    </div>
  )
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 underline underline-offset-4 hover:no-underline">
        Retry
      </button>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function InvitesSection() {
  const [invites, setInvites] = useState<InviteRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [minting, setMinting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const body = await getJson<{ ok: true; invites: InviteRow[] }>('/api/admin/invites')
        if (cancelled) return
        setInvites(body.invites)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load invites')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [reloadKey])

  async function handleMint(email: string) {
    setMinting(true)
    try {
      await getJson<{ ok: true }>('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      toast.success(`Invite minted for ${email}`)
      setReloadKey((key) => key + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mint invite')
    } finally {
      setMinting(false)
    }
  }

  return (
    <Section title="Invites" description="Mint an invite for a .edu.qa address, or check who has redeemed one.">
      <div className="flex flex-col gap-4">
        <MintInviteForm onMint={handleMint} busy={minting} />
        {error ? (
          <SectionError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : invites === null ? (
          <SectionSkeleton />
        ) : (
          <InvitesTable rows={invites} />
        )}
      </div>
    </Section>
  )
}

function CreateAccountSection({ onCreated }: { onCreated?: () => void | Promise<void> }) {
  return (
    <Section title="Create account" description="Issue a direct sign-in for a learner who was not sent an invite.">
      <CreateAccountForm onCreated={onCreated} />
    </Section>
  )
}

function UsersSection({ refreshKey }: { refreshKey?: number }) {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const body = await getJson<{ ok: true; users: UserRow[] }>('/api/admin/users')
        if (cancelled) return
        setUsers(body.users)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load users')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [refreshKey, reloadKey])

  async function act(id: string, action: 'lift' | 'restrict' | 'ban') {
    try {
      await getJson<{ ok: true }>(`/api/admin/users/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      toast.success(`Status updated: ${action}`)
      setReloadKey((key) => key + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not ${action} this user`)
    }
  }

  return (
    <Section title="Users" description="Integrity score, recent events, and account status.">
      {error ? (
        <SectionError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : users === null ? (
        <SectionSkeleton />
      ) : (
        <UsersTable
          rows={users}
          onLift={(id) => void act(id, 'lift')}
          onRestrict={(id) => void act(id, 'restrict')}
          onBan={(id) => void act(id, 'ban')}
        />
      )}
    </Section>
  )
}

function BankSection() {
  const [stats, setStats] = useState<BankStatRow[] | null>(null)
  const [clos, setClos] = useState<CloRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const body = await getJson<{ ok: true; stats: BankStatRow[]; clos: CloRef[] }>('/api/admin/bank-stats')
        if (cancelled) return
        setStats(body.stats)
        setClos(body.clos)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load bank stats')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [reloadKey])

  return (
    <Section title="Bank" description="Exercise coverage per CLO per pattern: seed / verified / unverified.">
      {error ? (
        <SectionError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : stats === null || clos === null ? (
        <SectionSkeleton />
      ) : (
        <BankStatsTable rows={stats} clos={clos} />
      )}
    </Section>
  )
}

function AgentsSection() {
  const [usage, setUsage] = useState<AgentUsageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const body = await getJson<{ ok: true; usage: AgentUsageRow[] }>('/api/admin/agent-usage')
        if (cancelled) return
        setUsage(body.usage)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load agent usage')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [reloadKey])

  return (
    <Section title="Agents" description="Calls per agent per day, last 14 days.">
      {error ? (
        <SectionError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : usage === null ? (
        <SectionSkeleton />
      ) : (
        <AgentUsageTable rows={usage} />
      )}
    </Section>
  )
}

export function AdminDashboard() {
  const [usersRefreshKey, setUsersRefreshKey] = useState(0)

  return (
    <div className="flex flex-col gap-8">
      <InvitesSection />
      <CreateAccountSection onCreated={() => setUsersRefreshKey((key) => key + 1)} />
      <UsersSection refreshKey={usersRefreshKey} />
      <BankSection />
      <AgentsSection />
    </div>
  )
}
