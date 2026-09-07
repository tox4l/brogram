'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { ArrowUpRight, ChevronDown, ChevronUp, CupSoda, PanelRightClose, Sunrise, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type DockCorner, type WellnessPrefs } from '@/lib/contracts'
import { resolveWellnessPrefs } from '@/lib/wellness/prefs'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { useWellness } from '@/lib/query/hooks'
import { useOptimistic } from '@/lib/query/optimistic'
import { qk } from '@/lib/query/keys'
import { hasPendingPrefsWrite, useWellnessPrefsMutation } from '@/app/(app)/account/prefsMutation'
import { useSecondTick } from '@/components/shell/useSecondTick'
import { useReducedMotion } from '@/lib/motion/useReducedMotion'
import { nextCorner, rememberDockPlacement } from '@/lib/wellness/dock'
import { line } from '@/lib/voice/lines'
import { useDockPrefsMutation } from './useDockPrefs'
import { clearReminderBadge, setReminderPending, useReminderBadge, type ReminderSource } from '@/lib/wellness/reminderBadge'
import type { WellnessRow } from '@/lib/learner/compile'
import { DOHA_COORDS, dateKeyOf, fetchPrayerTimes, PRAYER_ORDER, type GeoCoordinates, type PrayerName, type PrayerTimesResult } from '@/lib/wellness/prayer'
import { isAttemptActive } from '@/lib/wellness/timers'
import { PrayerTimes } from './PrayerTimes'
import { WaterStretch, type WellnessLogEntry } from './WaterStretch'
import { Pomodoro, type PomodoroSession } from './Pomodoro'

// ---------------------------------------------------------------------------
// Shared data hooks (X3 fix): `wellness.prefs` has exactly ONE writer for
// every control in this file, `useWellnessPrefsMutation`
// (`src/app/(app)/account/prefsMutation.ts`) -- NOT yet the whole tree:
// `src/components/shell/DockControl.tsx` still keeps its own independent
// writer on the same JSONB blob (open: F1 fix-round follow-up). Before this
// fix, this hook used to keep its own, independent `useOptimistic` mutation against
// the same JSONB blob, which could revert a concurrent Account-page write (or
// vice versa) under the learner's finger, since neither writer's debounce/
// pending state was visible to the other. Every prefs field the dock touches
// (prayer toggles, the Settings numeric fields, `useDeviceLocation`) now goes
// through that shared queue; dock-sub-object changes still go through
// `useDockPrefsMutation` (I2), which already delegates to the same writer.
//
// `useRowMutation` (water/pomodoro row *columns*, not `prefs`) legitimately
// keeps its own `useOptimistic` mutation -- it is a different concern on the
// same row -- but shares `qk.wellness` with the prefs writer above, so its
// settle-invalidate is guarded by `hasPendingPrefsWrite`: firing it while a
// prefs write is still queued or in flight would refetch and land the
// server's stale prefs snapshot back over whatever the learner just changed.
// ---------------------------------------------------------------------------

async function persistRowPatch(userId: string, patch: Partial<WellnessRow>): Promise<void> {
  const client = createClient()
  const { data: updated } = await client.from('wellness').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
  if (!updated) await client.from('wellness').insert({ user_id: userId, ...patch })
}

function useRowMutation(userId: string | null) {
  const base = useOptimistic<WellnessRow, Partial<WellnessRow>>({
    key: qk.wellness(userId ?? ''),
    apply: (previousRow, patch) => ({ ...(previousRow ?? {}), ...patch }),
    mutate: async (patch) => {
      if (!userId) return
      await persistRowPatch(userId, patch)
    },
  })
  // Wraps (never edits) `optimistic.ts`'s own `onSettled` -- forwarding
  // whatever arguments TanStack Query calls it with, so this stays correct
  // across a TanStack Query version bump without pinning its exact arity.
  return useMutation({
    ...base,
    onSettled: (...args: Parameters<NonNullable<typeof base.onSettled>>) => {
      if (userId && hasPendingPrefsWrite(userId)) return
      return base.onSettled?.(...args)
    },
  })
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
    <label className="flex items-center justify-between gap-3 text-micro text-muted-foreground">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(event) => onChange(parsePositiveMinutes(event.target.value, value, max))}
        className="w-16 rounded-lg border border-input bg-background px-2 py-1 text-right text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

function WellnessSettings({ prefs, onChange, onDockChange }: {
  prefs: WellnessPrefs
  onChange: (patch: Partial<WellnessPrefs>) => void
  onDockChange: (patch: Partial<WellnessPrefs['dock']>) => void
}) {
  return (
    <details className="mt-4 border-t border-rule pt-4">
      <summary className="w-fit cursor-pointer rounded-lg text-small font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Settings</summary>
      <div className="mt-4 space-y-3">
        <label className="flex items-center justify-between gap-3 text-micro text-muted-foreground">
          <span>Dock position</span>
          <select
            value={prefs.dock.placement}
            onChange={(event) => {
              const placement = event.target.value as WellnessPrefs['dock']['placement']
              rememberDockPlacement(placement)
              onDockChange({ placement })
            }}
            className="rounded-lg border border-input bg-background px-2 py-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PLACEMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-micro text-muted-foreground">
          <span>Collapse on reps and walkthroughs</span>
          <input
            type="checkbox"
            checked={prefs.dock.compactOnExercise}
            onChange={(event) => onDockChange({ compactOnExercise: event.target.checked })}
            className="size-4 rounded-lg border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <NumberField label="Prayer lead time (min)" value={prefs.prayerLeadMinutes} max={60} onChange={(value) => onChange({ prayerLeadMinutes: value })} />
        <NumberField label="Water interval (min)" value={prefs.waterIntervalMin} max={180} onChange={(value) => onChange({ waterIntervalMin: value })} />
        <NumberField label="Stretch interval (min)" value={prefs.stretchIntervalMin} max={180} onChange={(value) => onChange({ stretchIntervalMin: value })} />
        <NumberField label="Pomodoro work (min)" value={prefs.pomodoroWorkMin} max={120} onChange={(value) => onChange({ pomodoroWorkMin: value })} />
        <NumberField label="Pomodoro break (min)" value={prefs.pomodoroBreakMin} max={60} onChange={(value) => onChange({ pomodoroBreakMin: value })} />
        <label className="flex items-center justify-between gap-3 text-micro text-muted-foreground">
          <span>Use device location</span>
          <input
            type="checkbox"
            checked={prefs.useDeviceLocation}
            onChange={(event) => onChange({ useDeviceLocation: event.target.checked })}
            className="size-4 rounded-lg border-input outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
    </details>
  )
}

/** A small unread-reminder indicator (R6.4/C3): a prayer, water, stretch or
 *  pomodoro event fired -- whether it toasted or queued -- while the full
 *  card that would show it was not on screen (collapsed, or hidden). */
function PendingBadge() {
  return (
    <span data-testid="dock-badge" role="status" className="inline-flex size-2 shrink-0 rounded-full bg-primary">
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

type PendingChange = (source: ReminderSource, pending: boolean) => void

/**
 * The reminder engine (C3): prayer schedule, water/stretch cadence and the
 * pomodoro timer, mounted unconditionally regardless of the dock's
 * orientation or collapse state -- only `visible` (and `compact`) change
 * what it renders. This is the ONE place that subscribes to
 * `useSecondTick()` and derives `attemptActive` (re-read from
 * `isAttemptActive()` on every tick -- no separate `setInterval`, I3), so
 * re-rendering once a second never touches `Dock`'s own tree (Settings, the
 * collapsed chrome, layout wrappers): only this small subtree, and its three
 * children, re-render on the clock.
 *
 * Rendered from the SAME position in `Dock`'s returned fragment on every
 * render, regardless of which chrome branch is active, so React never
 * unmounts it (and loses Pomodoro's running countdown, or PrayerTimes'
 * fired-today bookkeeping) when the learner collapses, expands, or changes
 * placement.
 */
function WellnessReminderEngine({ prefs, waterLog, prayerResult, onTogglePrayer, onLog, onSessionComplete, onPendingChange, visible, compact }: {
  prefs: WellnessPrefs
  waterLog: WellnessLogEntry[]
  prayerResult: PrayerTimesResult | null
  onTogglePrayer: (prayer: PrayerName) => void
  onLog: (entry: WellnessLogEntry) => void
  onSessionComplete: (sessions: PomodoroSession[]) => void
  onPendingChange: PendingChange
  visible: boolean
  compact: boolean
}) {
  const now = useSecondTick()
  const attemptActive = isAttemptActive()

  // N1 fix round 2: `WaterStretch`/`Pomodoro` each get exactly ONE slot with
  // ONE element type (a `div` whose class -- not its existence -- reacts to
  // `visible`/`compact`), never a ternary that swaps the div for the bare
  // component. A ternary that changes the element TYPE at a fixed position
  // is what actually remounts a child in React (not "conditional rendering"
  // in general) -- and a remount here means `Pomodoro`'s running countdown
  // resets and `WaterStretch`'s `queuedRef` (the very reminders the badge is
  // advertising) is thrown away, exactly when the learner expands the dock
  // to look at what the badge means. Keeping both components as permanent
  // children of this always-mounted engine, at a stable slot, is what makes
  // "no remount can ever reset their state" actually hold.
  return (
    <>
      <PrayerTimes prefs={prefs} onTogglePrayer={onTogglePrayer} result={prayerResult} now={now} attemptActive={attemptActive} compact={compact} visible={visible}
        onPendingChange={(pending) => onPendingChange('prayer', pending)} />
      <div className={visible && !compact ? 'border-t border-rule pt-4' : undefined}>
        <WaterStretch prefs={prefs} now={now} log={waterLog} onLog={onLog} attemptActive={attemptActive} compact={compact} visible={visible}
          onPendingChange={(pending) => onPendingChange('wellness', pending)} />
      </div>
      <div className={visible && !compact ? 'border-t border-rule pt-4' : undefined}>
        <Pomodoro prefs={prefs} now={now} attemptActive={attemptActive} onSessionComplete={onSessionComplete} compact={compact} visible={visible}
          onPendingChange={(pending) => onPendingChange('pomodoro', pending)} />
      </div>
    </>
  )
}

interface DockChromeProps {
  prefs: WellnessPrefs
  onPrefsChange: (patch: Partial<WellnessPrefs>) => void
  onDockChange: (patch: Partial<WellnessPrefs['dock']>) => void
}

function SettingsAndFooter({ prefs, onPrefsChange, onDockChange }: DockChromeProps) {
  return (
    <>
      <WellnessSettings prefs={prefs} onChange={onPrefsChange} onDockChange={onDockChange} />
      <div className="mt-4 border-t border-rule pt-4">
        <Link href="/derot" className="inline-flex items-center gap-1 rounded-lg text-small font-medium text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring">Open de-rot<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </div>
    </>
  )
}

/**
 * The 56px icon rail (spec 6.2): prayer glyph with the next-prayer time, water
 * glyph with today's count, pomodoro ring. Hover or focus reveals the full
 * label via a `group`-scoped tooltip -- keyboard-reachable, since each icon
 * is a real, focusable button that also expands the dock. Subscribes to
 * `useSecondTick()` on its own (isolated from `Dock`'s own re-renders, and
 * from `WellnessReminderEngine`'s -- they are siblings, not ancestor/descendant).
 */
function VerticalCollapsedChrome({ waterLog, prayerResult, badge, onExpand }: {
  waterLog: WellnessLogEntry[]
  prayerResult: PrayerTimesResult | null
  badge: boolean
  onExpand: () => void
}) {
  const now = useSecondTick()
  const items = [
    { key: 'prayer', icon: Sunrise, label: `Next prayer: ${nextPrayerLabel(prayerResult, now)}` },
    { key: 'water', icon: CupSoda, label: `Water today: ${todaysWaterCount(waterLog, now)}` },
    { key: 'pomodoro', icon: Timer, label: line('dock.pomodoro') },
  ]
  return (
    <div className="relative flex flex-col items-center gap-3">
      {badge && <div className="absolute top-0 right-0"><PendingBadge /></div>}
      {items.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={onExpand}
          className="group relative flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="pointer-events-none absolute left-full ml-2 hidden w-max max-w-40 rounded-lg border border-rule bg-popover px-2 py-1 text-micro text-popover-foreground group-hover:block group-focus-visible:block">
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

/** The next-prayer text shown on the horizontal-collapsed line and the float
 *  pill -- its own tick subscription, isolated from `Dock`'s own re-renders
 *  the same way `VerticalCollapsedChrome`'s is. */
function NextPrayerLabel({ prayerResult }: { prayerResult: PrayerTimesResult | null }) {
  const now = useSecondTick()
  return <span>{nextPrayerLabel(prayerResult, now)}</span>
}

export interface DockProps {
  /** `headless` (placement `hidden`): mount the reminder engine invisibly and render nothing else -- the header's `DockControl` is the only visible affordance. */
  orientation: 'vertical' | 'horizontal' | 'pill' | 'headless'
  collapsed: boolean
  onToggleCollapse: () => void
  corner: DockCorner
  onCornerChange: (corner: DockCorner) => void
}

/**
 * The wellness dock (T2.4, spec section 6). Renders one of five placements
 * via `orientation`/`collapsed` (computed by `WellnessSlot` from
 * `wellness.prefs.dock`, `src/lib/wellness/dock.ts`); every `prefs` write
 * in THIS component (X3 fix) is a patch through the one shared writer
 * (`useWellnessPrefsMutation`/`useDockPrefsMutation`), never a whole
 * resolved `WellnessPrefs` blob or a mutation local to this component --
 * `src/components/shell/DockControl.tsx`, a sibling in the same header,
 * still writes independently (open: F1 fix-round follow-up), so "one
 * writer" is a per-control guarantee here, not yet a tree-wide one.
 * `<Toaster/>` lives in `ShellLayout` now (C4), mounted once regardless of
 * dock state.
 */
export function Dock({ orientation, collapsed, onToggleCollapse, corner, onCornerChange }: DockProps) {
  const { user } = useSession()
  const userId = user?.id ?? null
  const wellnessQuery = useWellness()
  const prefs = resolveWellnessPrefs(wellnessQuery.data?.prefs)
  const waterLog = (wellnessQuery.data?.water_log as WellnessLogEntry[] | undefined) ?? []
  const pomodoroSessions = (wellnessQuery.data?.pomodoro_sessions as PomodoroSession[] | undefined) ?? []
  const [prayerResult, setPrayerResult] = useState<PrayerTimesResult | null>(null)

  const deviceCoords = useDeviceCoords(prefs.useDeviceLocation)
  const reducedMotion = useReducedMotion(prefs.motion)

  const prefsMutation = useWellnessPrefsMutation(userId)
  const rowMutation = useRowMutation(userId)
  const dockPrefsMutation = useDockPrefsMutation(userId)

  const badge = useReminderBadge()
  const onPendingChange: PendingChange = (source, value) => setReminderPending(source, value)

  // The prayer fetch only needs to notice a day or coordinates change, not a
  // literal second; a coarse interval (rather than `useSecondTick`) keeps
  // this effect -- and the `Dock` instance that owns `prayerResult` -- off
  // the 1Hz clock entirely (I3).
  const lastFetchKeyRef = useRef<string | null>(null)
  useEffect(() => {
    function check() {
      const coords = deviceCoords ?? DOHA_COORDS
      const now = Date.now()
      const fetchKey = `${dateKeyOf(new Date(now))}:${coords.latitude}:${coords.longitude}`
      if (lastFetchKeyRef.current === fetchKey) return
      lastFetchKeyRef.current = fetchKey
      void fetchPrayerTimes(new Date(now), coords).then(setPrayerResult)
    }
    check()
    const id = setInterval(check, 60_000)
    return () => clearInterval(id)
  }, [deviceCoords])

  function updatePrefs(patch: Partial<WellnessPrefs>) {
    prefsMutation.mutate(() => patch)
  }

  function updateDockPrefs(patch: Partial<WellnessPrefs['dock']>) {
    dockPrefsMutation.mutate(() => patch)
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

  function handleExpand() {
    clearReminderBadge()
    onToggleCollapse()
  }

  const visible = orientation !== 'headless' && !collapsed
  const compact = orientation === 'horizontal'

  const engine = (
    <WellnessReminderEngine
      prefs={prefs} waterLog={waterLog} prayerResult={prayerResult}
      onTogglePrayer={handleTogglePrayer} onLog={handleLog} onSessionComplete={handleSessionComplete}
      onPendingChange={onPendingChange} visible={visible} compact={compact}
    />
  )

  // `engine` (the reminder scheduling components) is rendered from a SINGLE,
  // STABLE position inside each orientation's own JSX below -- never as a
  // sibling that some branches include and others omit, and never nested one
  // level deeper in an expanded branch than in a collapsed one. Both of those
  // shapes read as "a different tree" to React the moment `collapsed` flips,
  // which unmounts `engine` (and loses Pomodoro's running countdown, or
  // PrayerTimes' fired-today bookkeeping) exactly when C3 says it must not.
  // Each orientation therefore returns ONE wrapper element whose class names
  // (not its type, and not `engine`'s position within it) change with
  // `collapsed`; `engine` itself renders nothing when `visible` is false, so
  // the wrapper is simply empty there.

  if (orientation === 'headless') {
    return engine
  }

  if (orientation === 'pill') {
    return (
      <div role="complementary" aria-label="Wellness" className={cn('fixed z-40 flex flex-col items-end gap-2', CORNER_CLASSES[corner], corner.startsWith('t') && 'flex-col-reverse')}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label="Wellness dock"
          onClick={collapsed ? handleExpand : onToggleCollapse}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            const moved = nextCorner(corner, event.key)
            if (moved !== corner) { event.preventDefault(); onCornerChange(moved) }
          }}
          className="relative flex h-11 items-center gap-2 rounded-full border border-border bg-popover px-4 text-small font-medium text-popover-foreground shadow-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sunrise className="size-4" aria-hidden="true" />
          <NextPrayerLabel prayerResult={prayerResult} />
          {badge && <PendingBadge />}
        </button>
        <div
          className={cn(
            !collapsed && [
              'w-[280px] max-w-[calc(100vw-2rem)] origin-bottom rounded-xl border border-rule bg-popover p-4 text-popover-foreground shadow-md',
              !reducedMotion && 'transition-transform duration-200 ease-out motion-reduce:transition-none',
            ],
          )}
        >
          {!collapsed && <h2 className="text-small font-medium text-foreground">Wellness</h2>}
          <div className={!collapsed ? 'mt-4 space-y-6' : undefined}>
            {engine}
          </div>
          {!collapsed && <SettingsAndFooter prefs={prefs} onPrefsChange={updatePrefs} onDockChange={updateDockPrefs} />}
        </div>
      </div>
    )
  }

  if (orientation === 'horizontal') {
    return (
      <div className={collapsed ? 'flex items-center justify-between gap-3' : 'flex flex-wrap items-center justify-between gap-4'}>
        <div className={collapsed ? 'flex items-center gap-2 text-micro text-muted-foreground' : 'flex flex-wrap items-center gap-4'}>
          {collapsed && <Sunrise className="size-4 shrink-0" aria-hidden="true" />}
          {collapsed && <NextPrayerLabel prayerResult={prayerResult} />}
          {engine}
          {badge && <PendingBadge />}
        </div>
        <Button
          type="button" variant="ghost" size="icon-sm"
          aria-label={collapsed ? 'Expand wellness dock' : 'Collapse wellness dock'}
          onClick={collapsed ? handleExpand : onToggleCollapse}
        >
          {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
        </Button>
      </div>
    )
  }

  // vertical (left/right rail)
  return (
    <div className={collapsed ? 'w-14 py-2' : 'w-full max-w-[280px]'} aria-label={collapsed ? 'Wellness, collapsed' : undefined} data-loaded={wellnessQuery.isFetched}>
      {collapsed ? (
        <VerticalCollapsedChrome waterLog={waterLog} prayerResult={prayerResult} badge={badge} onExpand={handleExpand} />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-small font-medium text-foreground">Wellness</h2>
          <div className="flex items-center gap-2">
            {badge && <PendingBadge />}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Collapse wellness dock" onClick={onToggleCollapse}>
              <PanelRightClose aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
      <div className={!collapsed ? 'mt-4 space-y-6' : undefined}>
        {engine}
      </div>
      {!collapsed && <SettingsAndFooter prefs={prefs} onPrefsChange={updatePrefs} onDockChange={updateDockPrefs} />}
    </div>
  )
}
