'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { DEFAULT_WELLNESS, type WellnessPrefs } from '@/lib/contracts'
import { createClient } from '@/lib/supabase/client'
import { useSession } from '@/store/session'
import { DOHA_COORDS, dateKeyOf, fetchPrayerTimes, type GeoCoordinates, type PrayerName, type PrayerTimesResult } from '@/lib/wellness/prayer'
import { isAttemptActive } from '@/lib/wellness/timers'
import { PrayerTimes } from './PrayerTimes'
import { WaterStretch, type WellnessLogEntry } from './WaterStretch'
import { Pomodoro, type PomodoroSession } from './Pomodoro'

interface WellnessRow {
  prefs: Partial<WellnessPrefs> | null
  water_log: WellnessLogEntry[] | null
  pomodoro_sessions: PomodoroSession[] | null
}

function mergePrefs(saved: Partial<WellnessPrefs> | null | undefined): WellnessPrefs {
  return {
    ...DEFAULT_WELLNESS,
    ...saved,
    prayerReminders: { ...DEFAULT_WELLNESS.prayerReminders, ...saved?.prayerReminders },
  }
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
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
      () => { /* Denied or unavailable; the Doha default keeps the rail usable. */ },
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

function WellnessSettings({ prefs, onChange }: { prefs: WellnessPrefs; onChange: (patch: Partial<WellnessPrefs>) => void }) {
  return (
    <details className="mt-5 border-t border-border pt-5">
      <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Settings</summary>
      <div className="mt-4 space-y-3">
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

export function Rail({ compact = false }: { compact?: boolean }) {
  const { user } = useSession()
  const userId = user?.id ?? null
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [prefs, setPrefs] = useState<WellnessPrefs>(DEFAULT_WELLNESS)
  const [waterLog, setWaterLog] = useState<WellnessLogEntry[]>([])
  const [pomodoroSessions, setPomodoroSessions] = useState<PomodoroSession[]>([])
  const [prayerResult, setPrayerResult] = useState<PrayerTimesResult | null>(null)

  const now = useNow(1000)
  const attemptActive = useAttemptActive()
  const deviceCoords = useDeviceCoords(prefs.useDeviceLocation)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      try {
        const client = clientRef.current ??= createClient()
        const { data, error } = await client.from('wellness').select('prefs,water_log,pomodoro_sessions').eq('user_id', userId).maybeSingle()
        if (cancelled) return
        if (error) throw error
        const row = data as WellnessRow | null
        setPrefs(mergePrefs(row?.prefs))
        setWaterLog(row?.water_log ?? [])
        setPomodoroSessions(row?.pomodoro_sessions ?? [])
      } catch {
        // Falls back to defaults; edits still persist once the connection recovers.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

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

  async function persist(patch: Partial<WellnessRow>) {
    if (!userId) return
    try {
      const client = clientRef.current ??= createClient()
      // The row normally already exists (created by handle_new_user on signup), so a plain
      // update is the common case; insert once as a fallback if it somehow does not.
      const { data } = await client.from('wellness').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', userId).select('user_id').maybeSingle()
      if (!data) await client.from('wellness').insert({ user_id: userId, ...patch })
    } catch {
      // Best-effort; the local state already reflects the change.
    }
  }

  function updatePrefs(patch: Partial<WellnessPrefs>) {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    void persist({ prefs: next })
  }

  function handleTogglePrayer(prayer: PrayerName) {
    updatePrefs({ prayerReminders: { ...prefs.prayerReminders, [prayer]: !prefs.prayerReminders[prayer] } })
  }

  function handleLog(entry: WellnessLogEntry) {
    const next = [...waterLog, entry]
    setWaterLog(next)
    void persist({ water_log: next })
  }

  function handleSessionComplete(sessions: PomodoroSession[]) {
    const next = [...pomodoroSessions, ...sessions]
    setPomodoroSessions(next)
    void persist({ pomodoro_sessions: next })
  }

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <Toaster />
        <PrayerTimes prefs={prefs} onTogglePrayer={handleTogglePrayer} result={prayerResult} now={now} attemptActive={attemptActive} compact />
        <WaterStretch prefs={prefs} now={now} log={waterLog} onLog={handleLog} compact />
        <Pomodoro prefs={prefs} now={now} attemptActive={attemptActive} onSessionComplete={handleSessionComplete} compact />
      </div>
    )
  }

  return (
    <div className="w-full max-w-[280px]" aria-label="Wellness" data-loaded={loaded}>
      <Toaster />
      <h2 className="text-sm font-medium text-foreground">Wellness</h2>
      <div className="mt-5 space-y-6">
        <PrayerTimes prefs={prefs} onTogglePrayer={handleTogglePrayer} result={prayerResult} now={now} attemptActive={attemptActive} />
        <div className="border-t border-border pt-5"><WaterStretch prefs={prefs} now={now} log={waterLog} onLog={handleLog} /></div>
        <div className="border-t border-border pt-5"><Pomodoro prefs={prefs} now={now} attemptActive={attemptActive} onSessionComplete={handleSessionComplete} /></div>
      </div>
      <WellnessSettings prefs={prefs} onChange={updatePrefs} />
      <div className="mt-5 border-t border-border pt-5">
        <Link href="/derot" className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-emerald-200 outline-none hover:text-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-300">Open de-rot<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </div>
    </div>
  )
}
