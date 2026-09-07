'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Sunrise } from 'lucide-react'
import type { WellnessPrefs } from '@/lib/contracts'
import { PRAYER_ORDER, type PrayerName, type PrayerTimesResult } from '@/lib/wellness/prayer'
import { buildPrayerReminders, dueReminders, type PrayerReminderEvent } from '@/lib/wellness/timers'
import { line } from '@/lib/voice/lines'

const PRAYER_LABEL: Record<PrayerName, string> = {
  fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha',
}

function reminderMessage(event: PrayerReminderEvent, leadMinutes: number): string {
  const label = PRAYER_LABEL[event.prayer]
  return event.kind === 'lead' ? `${label} in ${leadMinutes} minutes.` : `${label} time has arrived.`
}

export function PrayerTimes({ prefs, onTogglePrayer, result, now, attemptActive, onPendingChange, compact = false, visible = true }: {
  prefs: WellnessPrefs
  onTogglePrayer: (prayer: PrayerName) => void
  result: PrayerTimesResult | null
  now: number
  attemptActive: boolean
  /** R6.4/C3: `true` the instant a reminder fires -- whether it toasts right away
   *  or queues because an attempt is active -- so the dock can show a badge on a
   *  collapsed handle (or the header control when hidden) even where the full
   *  card is not on screen. Cleared by whoever owns acknowledgement. */
  onPendingChange?: (pending: boolean) => void
  compact?: boolean
  /** C3: the reminder engine (this component's effects) must keep running while
   *  the dock is collapsed or hidden -- only the UI is conditional. Mount this
   *  component always and pass `visible={false}` rather than unmounting it. */
  visible?: boolean
}) {
  const firedRef = useRef<Set<string>>(new Set())
  const seededDateRef = useRef<string | null>(null)
  const queuedRef = useRef<PrayerReminderEvent[]>([])
  const wasActiveRef = useRef(attemptActive)

  useEffect(() => {
    if (!result) return
    const events = buildPrayerReminders(result.date, result.times, prefs.prayerLeadMinutes)
      .filter((event) => prefs.prayerReminders[event.prayer])

    if (seededDateRef.current !== result.date) {
      // First evaluation for this day: mark every reminder already strictly in the past as
      // fired without toasting, so a rail opened well after a prayer's time (or after a
      // reload) never replays the day's backlog. A reminder whose time is exactly now still
      // falls through below and fires normally.
      firedRef.current = new Set(events.filter((event) => event.atMs < now).map((event) => event.firedKey))
      seededDateRef.current = result.date
    }

    const due = dueReminders(events, now, firedRef.current)
    for (const event of due) {
      firedRef.current.add(event.firedKey)
      if (attemptActive) queuedRef.current.push(event)
      else toast(reminderMessage(event, prefs.prayerLeadMinutes))
      onPendingChange?.(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, result?.date])

  useEffect(() => {
    if (wasActiveRef.current && !attemptActive && queuedRef.current.length) {
      const queued = queuedRef.current
      queuedRef.current = []
      onPendingChange?.(false)
      queued.forEach((event) => toast(reminderMessage(event, prefs.prayerLeadMinutes)))
    }
    wasActiveRef.current = attemptActive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptActive])

  if (!visible) return null

  if (!result) {
    return (
      <div>
        <h3 className="text-small font-medium">{line('dock.prayer')}</h3>
        <p className="mt-2 text-small text-muted-foreground">Loading today&apos;s prayer times.</p>
      </div>
    )
  }

  if (compact) {
    const next = PRAYER_ORDER.map((prayer) => ({ prayer, time: result.times[prayer] }))
      .find(({ time }) => new Date(now).getHours() * 60 + new Date(now).getMinutes() < Number(time.slice(0, 2)) * 60 + Number(time.slice(3)))
    return (
      <div className="flex items-center gap-2 text-micro text-muted-foreground">
        <Sunrise className="size-4 shrink-0" aria-hidden="true" />
        {next ? <span>{PRAYER_LABEL[next.prayer]} · {next.time}</span> : <span>Prayers complete for today</span>}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-small font-medium">{line('dock.prayer')}</h3>
        {result.source === 'fallback' && <span className="text-micro text-muted-foreground">Computed offline</span>}
      </div>
      <ul className="mt-2 space-y-2">
        {PRAYER_ORDER.map((prayer) => (
          <li key={prayer} className="flex items-center justify-between gap-3 text-small">
            <span className="text-foreground">{PRAYER_LABEL[prayer]}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-micro tabular-nums text-muted-foreground">{result.times[prayer]}</span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.prayerReminders[prayer]}
                aria-label={`${PRAYER_LABEL[prayer]} reminder`}
                onClick={() => onTogglePrayer(prayer)}
                className="relative h-4 w-7 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-primary data-[state=off]:bg-muted"
                data-state={prefs.prayerReminders[prayer] ? 'on' : 'off'}
              >
                <span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-background transition-transform data-[state=on]:translate-x-3" data-state={prefs.prayerReminders[prayer] ? 'on' : 'off'} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
