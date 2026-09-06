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

// sonner's Toaster reads window.matchMedia for OS theme detection. Real browsers always
// have it; jsdom (unit tests) does not. This is the only place Toaster gets mounted, so
// a missing matchMedia is patched here defensively rather than in every test that renders
// the app shell.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

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
      await client.from('wellness').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
    } catch {
      // Best-effort; the local state already reflects the change.
    }
  }

  function handleTogglePrayer(prayer: PrayerName) {
    const next = { ...prefs, prayerReminders: { ...prefs.prayerReminders, [prayer]: !prefs.prayerReminders[prayer] } }
    setPrefs(next)
    void persist({ prefs: next })
  }

  function handleLog(entry: WellnessLogEntry) {
    const next = [...waterLog, entry]
    setWaterLog(next)
    void persist({ water_log: next })
  }

  function handleSessionComplete(session: PomodoroSession) {
    const next = [...pomodoroSessions, session]
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
      <div className="mt-7 border-t border-border pt-5">
        <Link href="/derot" className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-emerald-200 outline-none hover:text-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-300">Open de-rot<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
      </div>
    </div>
  )
}
