'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useLockdown } from '@/hooks/useLockdown'
import { LockdownOverlay } from '@/components/exercise/LockdownOverlay'
import { DrillRunner } from '@/components/derot'
import { useSession } from '@/store/session'
import type { DrillItem, DrillKind, DrillResult } from '@/lib/contracts'
import { DRILL_META, isDrillKind, mapDrillRow, pickDrillItem } from '../lib'

type Phase = 'loading' | 'ready' | 'result' | 'empty' | 'error'

interface RunnerState {
  phase: Phase
  items: DrillItem[]
  allResults: DrillResult[]
  current: DrillItem | null
  lastResult: DrillResult | null
  error: string | null
  saveError: string | null
}

const INITIAL_STATE: RunnerState = { phase: 'loading', items: [], allResults: [], current: null, lastResult: null, error: null, saveError: null }

function useDrillRunner(kind: DrillKind, userId: string | null, explicitId: string | null) {
  const [state, setState] = useState<RunnerState>(INITIAL_STATE)
  const [attempt, setAttempt] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setState((prev) => ({ ...prev, phase: 'loading', error: null }))

    async function load() {
      try {
        const client = createClient()
        const [drills, wellness] = await Promise.all([
          client.from('drills').select('*').eq('kind', kind),
          client.from('wellness').select('drill_results').eq('user_id', userId as string).maybeSingle(),
        ])
        if (drills.error || wellness.error) throw new Error('This drill could not open.')
        if (cancelled) return
        const items = (drills.data ?? []).map(mapDrillRow)
        const allResults = (wellness.data?.drill_results ?? []) as DrillResult[]
        if (items.length === 0) { setState({ ...INITIAL_STATE, phase: 'empty', allResults }); return }
        const forKind = allResults.filter((result) => result.kind === kind)
        const current = pickDrillItem(items, forKind, new Date(), explicitId)
        setState({ phase: 'ready', items, allResults, current, lastResult: null, error: null, saveError: null })
      } catch (err) {
        if (!cancelled) setState({ ...INITIAL_STATE, phase: 'error', error: err instanceof Error ? err.message : 'This drill could not open.' })
      }
    }

    void load()
    return () => { cancelled = true }
  }, [kind, userId, explicitId, attempt])

  const submitResult = useCallback(async (result: DrillResult) => {
    if (!userId) return
    try {
      const client = createClient()
      // Fresh read right before the write: wellness also carries prefs, water_log
      // and pomodoro_sessions written by the wellness rail, so the append must
      // start from the latest array rather than a possibly stale local copy.
      const { data, error: readError } = await client.from('wellness').select('drill_results').eq('user_id', userId).maybeSingle()
      if (readError) throw readError
      const current = (data?.drill_results ?? []) as DrillResult[]
      const nextResults = [...current, result]
      const { error: writeError } = await client.from('wellness').update({ drill_results: nextResults }).eq('user_id', userId)
      if (writeError) throw writeError
      setState((prev) => ({ ...prev, phase: 'result', allResults: nextResults, lastResult: result, saveError: null }))
    } catch {
      setState((prev) => ({ ...prev, saveError: 'Your result could not be saved. Check your connection before continuing.' }))
    }
  }, [userId])

  const next = useCallback(() => {
    const { items, allResults } = stateRef.current
    const forKind = allResults.filter((result) => result.kind === kind)
    const current = pickDrillItem(items, forKind, new Date())
    setState((prev) => ({ ...prev, phase: 'ready', current, lastResult: null }))
  }, [kind])

  return { ...state, retry: () => setAttempt((n) => n + 1), submitResult, next }
}

function RunnerBody({ kind }: { kind: DrillKind }) {
  const params = useSearchParams()
  const explicitId = params.get('item')
  const userId = useSession((session) => session.user?.id) ?? null
  const runner = useDrillRunner(kind, userId, explicitId)
  const meta = DRILL_META[kind]

  // useLockdown's exerciseId is typed as a plain string, not nullable, so the
  // drill's id stands in for it once loaded; `enabled` keeps it inert before
  // that (see the report for why null was not used).
  const lockdown = useLockdown(runner.current?.id ?? '', { enabled: Boolean(runner.current) })

  return (
    <div {...lockdown.containerProps} className="relative min-w-0 space-y-5">
      <div className="space-y-3" inert={Boolean(lockdown.overlay)}>
        <Link href="/derot" className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-3" aria-hidden="true" />Back to de-rot
        </Link>
        <h1 className="text-2xl font-medium tracking-tight">{meta.title}</h1>
      </div>

      <div inert={Boolean(lockdown.overlay)} className="space-y-5">
        {lockdown.pasteMessage && <p role="status" className="text-sm text-muted-foreground">{lockdown.pasteMessage}</p>}
        {lockdown.loggingError && <p role="alert" className="text-sm text-muted-foreground">{lockdown.loggingError}</p>}

        {runner.phase === 'loading' && <p role="status" className="text-sm text-muted-foreground">Opening your drill.</p>}

        {runner.phase === 'error' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-input p-4">
            <p className="text-sm text-foreground">{runner.error}</p>
            <Button variant="outline" onClick={runner.retry}>Try again</Button>
          </div>
        )}

        {runner.phase === 'empty' && (
          <div className="rounded-xl border border-dashed border-input p-6">
            <p className="text-sm font-medium">No items yet</p>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">This drill is still being prepared. Choose another kind from de-rot.</p>
            <Link href="/derot" className={cn(buttonVariants({ variant: 'outline' }), 'mt-4')}>Back to de-rot</Link>
          </div>
        )}

        {runner.phase === 'ready' && runner.current && <DrillRunner item={runner.current} onResult={(result) => void runner.submitResult(result)} />}

        {runner.phase === 'result' && runner.lastResult && (
          <div className="mx-auto w-full max-w-2xl space-y-5 rounded-xl border border-border p-6">
            <p className="text-lg font-medium tracking-tight">{runner.lastResult.correct ? 'Correct.' : 'Not quite.'}</p>
            <p className="font-mono text-sm text-muted-foreground">Score: {runner.lastResult.score}</p>
            {runner.saveError && <p role="alert" className="text-sm text-muted-foreground">{runner.saveError}</p>}
            <div className="flex flex-wrap gap-3">
              <Button onClick={runner.next} className="bg-emerald-200 text-primary-foreground hover:bg-emerald-100">Next drill<ArrowRight aria-hidden="true" /></Button>
              <Link href="/derot" className={buttonVariants({ variant: 'outline' })}>Back to de-rot</Link>
            </div>
          </div>
        )}
      </div>
      <LockdownOverlay reason={lockdown.overlay} onResume={lockdown.resume} />
    </div>
  )
}

function InvalidKind() {
  return (
    <div className="space-y-4 py-10">
      <h1 className="text-2xl font-medium tracking-tight">This drill could not open</h1>
      <p className="text-sm text-muted-foreground">Choose a drill kind from the de-rot section.</p>
      <Link href="/derot" className={buttonVariants({ variant: 'outline' })}>Back to de-rot</Link>
    </div>
  )
}

export default function DerotRunnerPage() {
  const { kind } = useParams<{ kind: string }>()
  if (!isDrillKind(kind)) return <InvalidKind />
  return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Opening your drill.</p>}><RunnerBody kind={kind} /></Suspense>
}
