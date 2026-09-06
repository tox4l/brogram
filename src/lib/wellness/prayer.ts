/**
 * Prayer times for the wellness rail.
 *
 * Aladhan `timings` (method 10 = Qatar) is the primary source, cached per day in
 * localStorage. When the network call fails the `adhan` npm package computes the
 * same five prayers locally with `CalculationMethod.Qatar()` so the rail is never
 * empty. See docs/research/runtime-facts.md ("Prayer times").
 */

import { Coordinates, CalculationMethod, PrayerTimes as AdhanPrayerTimes } from 'adhan'

export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha'
export const PRAYER_ORDER: PrayerName[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']

export interface GeoCoordinates {
  latitude: number
  longitude: number
}

export interface PrayerTimesResult {
  /** Local date key (YYYY-MM-DD) these times apply to. */
  date: string
  times: Record<PrayerName, string>
  /** 'aladhan' when the API answered, 'cache' when read from localStorage, 'fallback' when computed offline. */
  source: 'aladhan' | 'cache' | 'fallback'
}

/** Doha (State of Qatar). Matches docs/research/runtime-facts.md exactly. */
export const DOHA_COORDS: GeoCoordinates = { latitude: 25.2854, longitude: 51.531 }
const ALADHAN_METHOD = 10
const CACHE_PREFIX = 'brogram:prayer:'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Local (browser) date key, not UTC, so a late-evening session keys to the right day. */
export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatAladhanDate(date: Date): string {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`
}

function coordsKey(coords: GeoCoordinates): string {
  return `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(4)}`
}

function cacheKey(dateKey: string, coords: GeoCoordinates): string {
  return `${CACHE_PREFIX}${dateKey}:${coordsKey(coords)}`
}

function readCache(key: string): PrayerTimesResult | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && 'times' in parsed && 'date' in parsed) {
      return parsed as PrayerTimesResult
    }
    return null
  } catch {
    return null
  }
}

function writeCache(key: string, value: PrayerTimesResult) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Storage may be full or disabled; the rail still works without the cache. */
  }
}

/** Aladhan sometimes suffixes a timezone, e.g. "05:12 (+03)". Keep only HH:MM. */
function normalizeTime(raw: unknown): string {
  const text = String(raw ?? '')
  const match = /^(\d{2}:\d{2})/.exec(text)
  return match ? match[1] : text
}

function computeFallback(date: Date, coords: GeoCoordinates): PrayerTimesResult {
  const coordinates = new Coordinates(coords.latitude, coords.longitude)
  const params = CalculationMethod.Qatar()
  const prayerTimes = new AdhanPrayerTimes(coordinates, date, params)
  const formatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Qatar' })
  return {
    date: dateKeyOf(date),
    times: {
      fajr: formatter.format(prayerTimes.fajr),
      dhuhr: formatter.format(prayerTimes.dhuhr),
      asr: formatter.format(prayerTimes.asr),
      maghrib: formatter.format(prayerTimes.maghrib),
      isha: formatter.format(prayerTimes.isha),
    },
    source: 'fallback',
  }
}

/**
 * Fetches today's five prayer times for `date` (defaults to Doha coordinates), caching
 * per day in localStorage. On any network or parsing failure it falls back to `adhan`
 * computed locally so the rail always has times to show.
 */
export async function fetchPrayerTimes(date: Date, coords: GeoCoordinates = DOHA_COORDS): Promise<PrayerTimesResult> {
  const dateKey = dateKeyOf(date)
  const key = cacheKey(dateKey, coords)
  const cached = readCache(key)
  if (cached) return { ...cached, source: 'cache' }

  try {
    const url = `https://api.aladhan.com/v1/timings/${formatAladhanDate(date)}?latitude=${coords.latitude}&longitude=${coords.longitude}&method=${ALADHAN_METHOD}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Aladhan request failed: ${response.status}`)
    const body = await response.json() as { data?: { timings?: Record<string, unknown> } }
    const timings = body.data?.timings
    if (!timings) throw new Error('Aladhan response missing timings')
    const result: PrayerTimesResult = {
      date: dateKey,
      times: {
        fajr: normalizeTime(timings.Fajr),
        dhuhr: normalizeTime(timings.Dhuhr),
        asr: normalizeTime(timings.Asr),
        maghrib: normalizeTime(timings.Maghrib),
        isha: normalizeTime(timings.Isha),
      },
      source: 'aladhan',
    }
    writeCache(key, result)
    return result
  } catch {
    return computeFallback(date, coords)
  }
}
