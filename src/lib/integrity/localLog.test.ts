import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearLocalIntegrityLog, readLocalIntegrityEvents, recordLocalIntegrityEvent } from './localLog'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-06T12:00:00.000Z')

beforeEach(() => { clearLocalIntegrityLog() })
afterEach(() => { clearLocalIntegrityLog() })

describe('localLog', () => {
  it('reads back exactly what was recorded', () => {
    recordLocalIntegrityEvent('paste-blocked', NOW)
    recordLocalIntegrityEvent('blur', NOW)
    recordLocalIntegrityEvent('paste-blocked', NOW)
    expect(readLocalIntegrityEvents(NOW)).toEqual([{ type: 'paste-blocked' }, { type: 'blur' }, { type: 'paste-blocked' }])
  })

  it('drops events older than the seven day window, mirroring the server', () => {
    recordLocalIntegrityEvent('printscreen', NOW - 8 * DAY_MS)
    recordLocalIntegrityEvent('printscreen', NOW - 6 * DAY_MS)
    expect(readLocalIntegrityEvents(NOW)).toEqual([{ type: 'printscreen' }])
  })

  it('is empty with nothing recorded', () => {
    expect(readLocalIntegrityEvents(NOW)).toEqual([])
  })

  it('survives malformed storage instead of throwing', () => {
    localStorage.setItem('brogram:integrity-log', '{not json')
    expect(readLocalIntegrityEvents(NOW)).toEqual([])
    localStorage.setItem('brogram:integrity-log', JSON.stringify([{ type: 'blur' }, 'garbage', null, 42]))
    expect(readLocalIntegrityEvents(NOW)).toEqual([])
  })

  it('clearLocalIntegrityLog wipes everything', () => {
    recordLocalIntegrityEvent('blur', NOW)
    clearLocalIntegrityLog()
    expect(readLocalIntegrityEvents(NOW)).toEqual([])
  })
})
