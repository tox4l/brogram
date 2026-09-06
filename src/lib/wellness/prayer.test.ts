import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOHA_COORDS, dateKeyOf, fetchPrayerTimes } from './prayer'

function aladhanBody(timings: Record<string, string>) {
  return { data: { timings } }
}

const timings = { Fajr: '04:12', Sunrise: '05:32', Dhuhr: '11:32', Asr: '14:52', Maghrib: '17:22', Isha: '18:52' }

describe('fetchPrayerTimes', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 6, 9, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls Aladhan with method 10 and the Doha coordinates by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => aladhanBody(timings) })
    vi.stubGlobal('fetch', fetchMock)

    await fetchPrayerTimes(new Date(2026, 8, 6))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('https://api.aladhan.com/v1/timings/06-09-2026')
    expect(url).toContain(`latitude=${DOHA_COORDS.latitude}`)
    expect(url).toContain(`longitude=${DOHA_COORDS.longitude}`)
    expect(url).toContain('method=10')
  })

  it('returns the five prayers as HH:MM from a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => aladhanBody(timings) }))

    const result = await fetchPrayerTimes(new Date(2026, 8, 6))

    expect(result.source).toBe('aladhan')
    expect(result.times).toEqual({ fajr: '04:12', dhuhr: '11:32', asr: '14:52', maghrib: '17:22', isha: '18:52' })
  })

  it('strips a trailing timezone suffix from the API response', async () => {
    const suffixed = { ...timings, Fajr: '04:12 (+03)' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => aladhanBody(suffixed) }))

    const result = await fetchPrayerTimes(new Date(2026, 8, 6))

    expect(result.times.fajr).toBe('04:12')
  })

  it('falls back to adhan (computed offline) when the network call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const result = await fetchPrayerTimes(new Date(2026, 8, 6))

    expect(result.source).toBe('fallback')
    for (const value of Object.values(result.times)) expect(value).toMatch(/^\d{2}:\d{2}$/)
  })

  it('falls back to adhan when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))

    const result = await fetchPrayerTimes(new Date(2026, 8, 6))

    expect(result.source).toBe('fallback')
  })

  it('falls back to adhan when the response body has no timings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }))

    const result = await fetchPrayerTimes(new Date(2026, 8, 6))

    expect(result.source).toBe('fallback')
  })

  it('uses the daily cache on a second call for the same day and skips the network', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => aladhanBody(timings) })
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchPrayerTimes(new Date(2026, 8, 6))
    const second = await fetchPrayerTimes(new Date(2026, 8, 6))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.times).toEqual(first.times)
    expect(second.source).toBe('cache')
  })

  it('refetches for a new day', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => aladhanBody(timings) })
    vi.stubGlobal('fetch', fetchMock)

    await fetchPrayerTimes(new Date(2026, 8, 6))
    await fetchPrayerTimes(new Date(2026, 8, 7))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses device coordinates when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => aladhanBody(timings) })
    vi.stubGlobal('fetch', fetchMock)

    await fetchPrayerTimes(new Date(2026, 8, 6), { latitude: 24.4667, longitude: 54.3667 })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('latitude=24.4667')
    expect(url).toContain('longitude=54.3667')
  })
})

describe('dateKeyOf', () => {
  it('formats using local date parts', () => {
    expect(dateKeyOf(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
