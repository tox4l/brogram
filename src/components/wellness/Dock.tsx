'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { ArrowUpRight, ChevronDown, ChevronUp, CupSoda, PanelRightClose, Sunrise, Timer } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type DockCorner, type WellnessPrefs } from '@/lib/contracts'
import { prefsPatch, resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { useOptimistic } from '@/lib/query/optimistic'
import { qk } from '@/lib/query/keys'
import { useSecondTick } from '@/components/shell/useSecondTick'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { nextCorner, rememberDockPlacement } from '@/lib/wellness/dock'
import type { WellnessRow } from '@/lib/learner/compile'
import { DOHA_COORDS, dateKeyOf, fetchPrayerTimes, PRAYER_ORDER, type GeoCoordinates, type PrayerName, type PrayerTimesResult } from '@/lib/wellness/prayer'
import { advancePomodoro, isAttemptActive, remainingPomodoroMs, resetPomodoroState } from '@/lib/wellness/timers'
import { PrayerTimes } from './PrayerTimes'
import { WaterStretch, type WellnessLogEntry } from './WaterStretch'
import { Pomodoro, type PomodoroSession } from './Pomodoro'

// ---------------------------------------------------------------------------
// Shared data hooks -- the one writer path (spec 6.3, standing constraint):
// every wellness write is a patch through `useOptimistic`, never a whole
// resolved blob. Mirrors `SoundToggle`/`DockControl`'s persist shape exactly,
// which is what replaces the v1 rail's `mergePrefs` (a shallow spread that
// wrote the *entire* locally-held snapshot and could revert an unrelated
// concurrent write, e.g. the header's `SoundToggle`, on its next save).
// ---------------------------------------------------------------------------

async function persistPrefsChange(userId: string, change: (current: WellnessPrefs) => Partial<WellnessPrefs>): Promise<void> {
  const client = createClient()
  const { data, error } = await client.from('wellness').select('prefs').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const current = resolveWellnessPrefs((data as { prefs: unknown } | null)?.prefs)
  const patch = prefsPatch({ ...current, ...change(current) })
  const { data: updated } = await client.from('wellness').update({ prefs: patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, prefs: patch })
}

async function persistRowPatch(userId: string, patch: Partial<WellnessRow>): Promise<void> {
  const client = createClient()
  const { data: updated } = await client.from('wellness').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, ...patch })
}

function usePrefsMutation(userId: string | null) {
  return useMutation(useOptimistic<WellnessRow, (current: WellnessPrefs) => Partial<WellnessPrefs>>({
    key: qk.wellness(userId ?? ''),
    apply: (previousRow, change) => {
      const current = resolveWellnessPrefs(previousRow?.prefs)
      const patch = prefsPatch({ ...current, ...change(current) })
      return { ...(previousRow ?? {}), prefs: patch }
    },
    mutate: async (change) => {
      if (!userId) return
      await persistPrefsChange(userId, change)
    },
  }))
}

function useRowMutation(userId: string | null) {
  return useMutation(useOptimistic<WellnessRow, Partial<WellnessRow>>({
    key: qk.wellness(userId ?? ''),
    apply: (previousRow, patch) => ({ ...(previousRow ?? {}), ...patch }),
    mutate: async (patch) => {
      if (!userId) return
      await persistRowPatch(userId, patch)
    },
  }))
}

function useAttemptActive(): boolean {
  const [active, setActive] = useState(() => isAttemptActive())
  useEffect(() => {
    const check = () => setActive(isAttemptActive())
    check()
    const id = setInterval(check, 15_000)
    return () => clearInterval(id)
  }, [])
  return active
}

function useDeviceCoords(enabled: boolean): GeoCoordinates | null {
  const [coords, setCoords] = useState<GeoCoordinates | null>(null)
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (position) => { if (!cancelled) setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude }) },
      () => { /* Denied or unavailable; the Doha default keeps the dock usable. */ },
    )
    return () => { cancelled = true }
  }, [enabled])
  return coords
}

function parsePositiveMinutes(value: string, fallback: number, max: number): number {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function NumberField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(event) => onChange(parsePositiveMinutes(event.target.value, value, max))}
        className="w-16 rounded-md border border-input bg-background px-2 py-1 text-right text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  )
}

const PLACEMENT_OPTIONS: { value: WellnessPrefs['dock']['placement']; label: string }[] = [
  { value: 'right', label: 'Right rail' },
  { value: 'left', label: 'Left rail' },
  { value: 'top', label: 'Top bar' },
  { value: 'float', label: 'Floating pill' },
  { value: 'hidden', label: 'Hidden' },
]

function WellnessSettings({ prefs, onChange }: { prefs: WellnessPrefs; onChange: (patch: Partial<WellnessPrefs>) => void }) {
  return (
    <details className="mt-5 border-t border-border pt-5">
      <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Settings</summary>
      <div className="mt-4 space-y-3">
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Dock position</span>
          <select
            value={prefs.dock.placement}
            onChange={(event) => {
              const placement = event.target.value as WellnessPrefs['dock']['placement']
              rememberDockPlacement(placement)
              onChange({ dock: { ...prefs.dock, placement } })
            }}
            className="rounded-md border border-input bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PLACEMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Collapse on exercises and walkthroughs</span>
          <input
            type="checkbox"
            checked={prefs.dock.compactOnExercise}
            onChange={(event) => onChange({ dock: { ...prefs.dock, compactOnExercise: event.target.checked } })}
            className="size-4 rounded-sm border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <NumberField label="Prayer lead time (min)" value={prefs.prayerLeadMinutes} max={60} onChange={(value) => onChange({ prayerLeadMinutes: value })} />
        <NumberField label="Water interval (min)" value={prefs.waterIntervalMin} max={180} onChange={(value) => onChange({ waterIntervalMin: value })} />
        <NumberField label="Stretch interval (min)" value={prefs.stretchIntervalMin} max={180} onChange={(value) => onChange({ stretchIntervalMin: value })} />
        <NumberField label="Pomodoro work (min)" value={prefs.pomodoroWorkMin} max={120} onChange={(value) => onChange({ pomodoroWorkMin: value })} />
        <NumberField label="Pomodoro break (min)" value={prefs.pomodoroBreakMin} max={60} onChange={(value) => onChange({ pomodoroBreakMin: value })} />
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Use device location</span>
          <input
            type="checkbox"
            checked={prefs.useDeviceLocation}
            onChange={(event) => onChange({ useDeviceLocation: event.target.checked })}
            className="size-4 rounded-sm border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
    </details>
  )
}

/** A small unread-reminder indicator (R6.4): a prayer, water, stretch or pomodoro
 *  event queued instead of interrupting an active attempt. Never itself a toast. */
function PendingBadge() {
  return (
    <span data-testid="dock-badge" role="status" className="inline-flex size-2 shrink-0 rounded-full bg-emerald-300">
      <span className="sr-only">A reminder is waiting.</span>
    </span>
  )
}

function nextPrayerLabel(result: PrayerTimesResult | null, now: number): string {
  if (!result) return 'Loading'
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const next = PRAYER_ORDER
    .map((prayer) => ({ prayer, time: result.times[prayer] }))
    .find(({ time }) => nowMinutes < Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))
  return next ? `${next.prayer[0].toUpperCase()}${next.prayer.slice(1)} ${next.time}` : 'Done for today'
}

function todaysWaterCount(log: WellnessLogEntry[], now: number): number {
  const today = dateKeyOf(new Date(now))
  return log.filter((entry) => entry.kind === 'water' && entry.at.slice(0, 10) === today).length
}

interface DockDataProps {
  prefs: WellnessPrefs
  waterLog: WellnessLogEntry[]
  prayerResult: PrayerTimesResult | null
  now: number
  attemptActive: boolean
  onTogglePrayer: (prayer: PrayerName) => void
  onLog: (entry: WellnessLogEntry) => void
  onSessionComplete: (sessions: PomodoroSession[]) => void
  onPrefsChange: (patch: Partial<WellnessPrefs>) => void
  onPendingChange: (source: 'prayer' | 'wellness' | 'pomodoro', pending: boolean) => void
}

/** The full dock content -- shared by the vertical-expanded rail and the
 *  floating pill's expanded popover, so there is exactly one place that
 *  composes prayer/water/pomodoro/settings, not two drifting copies. */
function DockBody({ data }: { data: DockDataProps }) {
  return (
    <>
      <PrayerTimes prefs={data.prefs} onTogglePrayer={data.onTogglePrayer} result={data.prayerResult} now={data.now} attemptActive={data.attemptActive}
        onPendingChange={(pending) => data.onPendingChange('prayer', pending)} />
      <div className="border-t border-border pt-5">
        <WaterStretch prefs={data.prefs} now={data.now} log={data.waterLog} onLog={data.onLog} attemptActive={data.attemptActive}
          onPendingChange={(pending) => data.onPendingChange('wellness', pending)} />
      </div>
      <div className="border-t border-border pt-5">
        <Pomodoro prefs={data.prefs} now={data.now} attemptActive={data.attemptActive} onSessionComplete={data.onSessionComplete}
          onPendingChange={(pending) => data.onPendingChange('pomodoro', pending)} />
      </div>
      <WellnessSettings prefs={data.prefs} onChange={data.onPrefsChange} />
      <div className="mt-5 border-t border-border pt-5">
        <Link href="/derot" className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-emerald-200 outline-none hover:text-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-300">Open de-rot<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </div>
    </>
  )
}

/**
 * The 56px icon rail (spec 6.2): prayer glyph with the next-prayer time, water
 * glyph with today's count, pomodoro ring. Hover or focus reveals the full
 * label via a `group`-scoped tooltip -- keyboard-reachable, since each icon
 * is a real, focusable button that also expands the dock.
 */
function VerticalCollapsed({ prefs, waterLog, now, pomodoroRemainingMs, pomodoroPhase, prayerResult, badge, onExpand }: {
  prefs: WellnessPrefs
  waterLog: WellnessLogEntry[]
  now: number
  pomodoroRemainingMs: number
  pomodoroPhase: string
  prayerResult: PrayerTimesResult | null
  badge: boolean
  onExpand: () => void
}) {
  void prefs
  const minutesLeft = Math.ceil(pomodoroRemainingMs / 60_000)
  const items = [
    { key: 'prayer', icon: Sunrise, label: `Next prayer: ${nextPrayerLabel(prayerResult, now)}` },
    { key: 'water', icon: CupSoda, label: `Water today: ${todaysWaterCount(waterLog, now)}` },
    { key: 'pomodoro', icon: Timer, label: `Pomodoro: ${minutesLeft} min left, ${pomodoroPhase}` },
  ]
  return (
    <div className="relative flex w-14 flex-col items-center gap-3 py-2" aria-label="Wellness, collapsed">
      {badge && <div className="absolute top-0 right-1"><PendingBadge /></div>}
      {items.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={onExpand}
          className="group relative flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="pointer-events-none absolute left-full ml-2 hidden w-max max-w-40 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground group-hover:block group-focus-visible:block">
            {label}
          </span>
          <span className="sr-only">{label}. Expand the wellness dock.</span>
        </button>
      ))}
    </div>
  )
}

const CORNER_CLASSES: Record<DockCorner, string> = {
  tl: 'top-4 left-4',
  tr: 'top-4 right-4',
  bl: 'bottom-4 left-4',
  br: 'bottom-4 right-4',
}

/** The `float` placement: collapsed is a bare pill (spec 6.1's "pill then
 *  popover"); expanded adds a popover panel with the same content the
 *  vertical rail shows. `role="complementary"` with an accessible name lives
 *  here (R6.2) because this is the one placement `ShellLayout` never wraps
 *  in its own `<aside>`. */
function PillDock({ data, collapsed, onToggleCollapse, corner, onCornerChange, reducedMotion, badge }: {
  data: DockDataProps
  collapsed: boolean
  onToggleCollapse: () => void
  corner: DockCorner
  onCornerChange: (corner: DockCorner) => void
  reducedMotion: boolean
  badge: boolean
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const moved = nextCorner(corner, event.key)
    if (moved !== corner) {
      event.preventDefault()
      onCornerChange(moved)
    }
  }

  return (
    <div role="complementary" aria-label="Wellness" className={cn('fixed z-40 flex flex-col items-end gap-2', CORNER_CLASSES[corner], corner.startsWith('t') && 'flex-col-reverse')}>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label="Wellness dock"
        onClick={onToggleCollapse}
        onKeyDown={handleKeyDown}
        className="relative flex h-11 items-center gap-2 rounded-full border border-border bg-popover px-4 text-sm font-medium text-popover-foreground shadow-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sunrise className="size-4" aria-hidden="true" />
        <span>{nextPrayerLabel(data.prayerResult, data.now)}</span>
        {badge && <PendingBadge />}
      </button>
      {!collapsed && (
        <div
          className={cn(
            'w-[280px] max-w-[calc(100vw-2rem)] origin-bottom rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl',
            !reducedMotion && 'transition-transform duration-200 ease-out motion-reduce:transition-none',
          )}
        >
          <Toaster />
          <h2 className="text-sm font-medium text-foreground">Wellness</h2>
          <div className="mt-5 space-y-6">
            <DockBody data={data} />
          </div>
        </div>
      )}
    </div>
  )
}

export interface DockProps {
  orientation: 'vertical' | 'horizontal' | 'pill'
  collapsed: boolean
  onToggleCollapse: () => void
  corner: DockCorner
  onCornerChange: (corner: DockCorner) => void
}

/**
 * The wellness dock (T2.4, spec section 6). Renders one of five placements
 * via `orientation`/`collapsed` (computed by `WellnessSlot` from
 * `wellness.prefs.dock`, `src/lib/wellness/dock.ts`); every write here is a
 * patch through the shared optimistic mutation (`useOptimistic`), never a
 * whole resolved `WellnessPrefs` blob.
 */
export function Dock({ orientation, collapsed, onToggleCollapse, corner, onCornerChange }: DockProps) {
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const waterLog = (wellnessQuery.data?.water_log as WellnessLogEntry[] | undefined) ?? []
  const pomodoroSessions = (wellnessQuery.data?.pomodoro_sessions as PomodoroSession[] | undefined) ?? []
  const [prayerResult, setPrayerResult] = useState<PrayerTimesResult | null>(null)

  const now = useSecondTick()
  const attemptActive = useAttemptActive()
  const deviceCoords = useDeviceCoords(prefs.useDeviceLocation)
  const reducedMotion = useReducedMotion(prefs.motion)

  const prefsMutation = usePrefsMutation(userId)
  const rowMutation = useRowMutation(userId)

  const [pending, setPending] = useState({ prayer: false, wellness: false, pomodoro: false })
  const badge = pending.prayer || pending.wellness || pending.pomodoro
  const onPendingChange = (source: 'prayer' | 'wellness' | 'pomodoro', value: boolean) =>
    setPending((current) => (current[source] === value ? current : { ...current, [source]: value }))

  const lastFetchKeyRef = useRef<string | null>(null)
  useEffect(() => {
    // Re-checks every tick but only fetches when the local day or the coordinates actually
    // change, so a long-open tab rolls over to the next day's times (or device coordinates
    // that resolve after mount) on its own.
    const coords = deviceCoords ?? DOHA_COORDS
    const fetchKey = `${dateKeyOf(new Date(now))}:${coords.latitude}:${coords.longitude}`
    if (lastFetchKeyRef.current === fetchKey) return
    lastFetchKeyRef.current = fetchKey
    let cancelled = false
    void fetchPrayerTimes(new Date(now), coords).then((result) => { if (!cancelled) setPrayerResult(result) })
    return () => { cancelled = true }
  }, [now, deviceCoords])

  function updatePrefs(patch: Partial<WellnessPrefs>) {
    prefsMutation.mutate((current) => ({ ...patch, dock: patch.dock ? { ...current.dock, ...patch.dock } : current.dock }))
  }

  function handleTogglePrayer(prayer: PrayerName) {
    prefsMutation.mutate((current) => ({ prayerReminders: { ...current.prayerReminders, [prayer]: !current.prayerReminders[prayer] } }))
  }

  function handleLog(entry: WellnessLogEntry) {
    rowMutation.mutate({ water_log: [...waterLog, entry] })
  }

  function handleSessionComplete(sessions: PomodoroSession[]) {
    rowMutation.mutate({ pomodoro_sessions: [...pomodoroSessions, ...sessions] })
  }

  const data: DockDataProps = {
    prefs, waterLog, prayerResult, now, attemptActive,
    onTogglePrayer: handleTogglePrayer, onLog: handleLog, onSessionComplete: handleSessionComplete,
    onPrefsChange: updatePrefs, onPendingChange,
  }

  const derivedPomodoro = advancePomodoro(resetPomodoroState(prefs.pomodoroWorkMin), now, prefs.pomodoroWorkMin, prefs.pomodoroBreakMin).state
  const pomodoroRemainingMs = remainingPomodoroMs(derivedPomodoro, now)

  if (orientation === 'pill') {
    return (
      <PillDock data={data} collapsed={collapsed} onToggleCollapse={onToggleCollapse} corner={corner} onCornerChange={onCornerChange}
        reducedMotion={reducedMotion} badge={badge} />
    )
  }

  if (orientation === 'horizontal') {
    if (collapsed) {
      return (
        <div className="flex items-center justify-between gap-3" aria-label="Wellness, collapsed">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sunrise className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{nextPrayerLabel(prayerResult, now)}</span>
            {badge && <PendingBadge />}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Expand wellness dock" onClick={onToggleCollapse}>
            <ChevronDown aria-hidden="true" />
          </Button>
        </div>
      )
    }
    return (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <Toaster />
          <PrayerTimes prefs={prefs} onTogglePrayer={handleTogglePrayer} result={prayerResult} now={now} attemptActive={attemptActive} compact
            onPendingChange={(value) => onPendingChange('prayer', value)} />
          <WaterStretch prefs={prefs} now={now} log={waterLog} onLog={handleLog} attemptActive={attemptActive} compact
            onPendingChange={(value) => onPendingChange('wellness', value)} />
          <Pomodoro prefs={prefs} now={now} attemptActive={attemptActive} onSessionComplete={handleSessionComplete} compact
            onPendingChange={(value) => onPendingChange('pomodoro', value)} />
          {badge && <PendingBadge />}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse wellness dock" onClick={onToggleCollapse}>
          <ChevronUp aria-hidden="true" />
        </Button>
      </div>
    )
  }

  // vertical (left/right rail)
  if (collapsed) {
    return (
      <VerticalCollapsed prefs={prefs} waterLog={waterLog} now={now} pomodoroRemainingMs={pomodoroRemainingMs}
        pomodoroPhase={derivedPomodoro.phase} prayerResult={prayerResult} badge={badge} onExpand={onToggleCollapse} />
    )
  }
  return (
    <div className="w-full max-w-[280px]" aria-label="Wellness" data-loaded={wellnessQuery.isFetched}>
      <Toaster />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">Wellness</h2>
        <div className="flex items-center gap-2">
          {badge && <PendingBadge />}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse wellness dock" onClick={onToggleCollapse}>
            <PanelRightClose aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="mt-5 space-y-6">
        <DockBody data={data} />
      </div>
    </div>
  )
}
