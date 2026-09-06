'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useSession } from '@/store/session'
import type { DrillKind, DrillResult } from '@/lib/contracts'
import { DRILL_KINDS, DRILL_META, computeDerotStreak, isDrillKind, statsForKind, type KindStats } from './lib'

interface Overview {
  loading: boolean
  failed: boolean
  results: DrillResult[]
  availableKinds: Set<DrillKind>
}

const EMPTY_OVERVIEW: Overview = { loading: false, failed: false, results: [], availableKinds: new Set() }

function useDerotOverview(userId: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Overview>({ ...EMPTY_OVERVIEW, loading: Boolean(userId) })
  const [trackedUserId, setTrackedUserId] = useState(userId)
  if (trackedUserId !== userId) {
    setTrackedUserId(userId)
    setState(userId ? { ...EMPTY_OVERVIEW, loading: true } : EMPTY_OVERVIEW)
  }

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    async function load() {
      try {
        const client = createClient()
        const [wellness, drills] = await Promise.all([
          client.from('wellness').select('drill_results').eq('user_id', userId as string).maybeSingle(),
          client.from('drills').select('kind'),
        ])
        if (wellness.error || drills.error) throw new Error('De-rot progress unavailable')
        if (cancelled) return
        const results = ((wellness.data?.drill_results ?? []) as DrillResult[])
        const availableKinds = new Set<DrillKind>((drills.data ?? []).map((row: { kind: string }) => row.kind as DrillKind))
        setState({ loading: false, failed: false, results, availableKinds })
      } catch {
        if (!cancelled) setState({ ...EMPTY_OVERVIEW, failed: true })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [userId, attempt])

  const retry = () => {
    setState((prev) => ({ ...prev, loading: true, failed: false }))
    setAttempt((n) => n + 1)
  }

  return { ...state, retry }
}

/** `?drill=<kind>` is the buddy suggestion chip's deep link into a runner page. */
function DrillQueryRedirect() {
  const router = useRouter()
  const params = useSearchParams()
  useEffect(() => {
    const drill = params.get('drill')
    if (isDrillKind(drill)) router.replace(`/derot/${drill}`)
  }, [params, router])
  return null
}

function DrillCard({ kind, stats, available }: { kind: DrillKind; stats: KindStats; available: boolean }) {
  const meta = DRILL_META[kind]
  return (
    <Card>
      <CardHeader>
        <CardTitle>{meta.title}</CardTitle>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!available ? (
          <p className="text-sm leading-relaxed text-muted-foreground">No items yet. This drill is still being prepared.</p>
        ) : stats.attempted ? (
          <div className="flex gap-6">
            <div><p className="text-xs text-muted-foreground">Best</p><p className="mt-1 font-mono text-lg font-medium">{stats.best}</p></div>
            <div><p className="text-xs text-muted-foreground">Last</p><p className="mt-1 font-mono text-lg font-medium">{stats.last}</p></div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">Not attempted yet. Give it a try.</p>
        )}
        {available ? (
          <Link href={`/derot/${kind}`} className={cn(buttonVariants({ variant: 'default' }), 'w-fit bg-emerald-200 text-primary-foreground hover:bg-emerald-100')}>
            Start<ArrowUpRight aria-hidden="true" />
          </Link>
        ) : (
          <Button variant="outline" disabled className="w-fit">Start</Button>
        )}
      </CardContent>
    </Card>
  )
}

function DerotSection() {
  const userId = useSession((session) => session.user?.id) ?? null
  const overview = useDerotOverview(userId)
  const streakDays = computeDerotStreak(overview.results.map((result) => result.at))

  return (
    <div className="space-y-7">
      <Suspense fallback={null}><DrillQueryRedirect /></Suspense>

      <div>
        <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">De-rot</h1>
        <p className="mt-2 text-sm text-muted-foreground">Short drills to keep your attention sharp between exercises.</p>
      </div>

      <div className="border-b border-border pb-5">
        <p className="text-xs text-muted-foreground">De-rot streak</p>
        <p className="mt-1.5 font-mono text-xl font-medium tracking-tight text-foreground">{streakDays} {streakDays === 1 ? 'day' : 'days'}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{streakDays ? 'Attention takes practice.' : 'Finish one drill today to start your streak.'}</p>
      </div>

      {overview.loading && <p role="status" className="text-sm text-muted-foreground">Loading your de-rot progress.</p>}
      {overview.failed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
          <p className="text-sm text-foreground">Your de-rot progress could not load.</p>
          <Button variant="outline" onClick={overview.retry}>Try again</Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DRILL_KINDS.map((kind) => (
          <DrillCard key={kind} kind={kind} stats={statsForKind(overview.results, kind)} available={overview.availableKinds.has(kind)} />
        ))}
      </div>
    </div>
  )
}

export default function DerotPage() {
  return <DerotSection />
}
