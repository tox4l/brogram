import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllLocalIntegrityLogsForTests,
  clearLocalIntegrityLog,
  readLocalIntegrityEvents,
  recordLocalIntegrityEvent,
  syncLocalIntegrityLogUser,
} from './localLog'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-06T12:00:00.000Z')

beforeEach(() => { clearAllLocalIntegrityLogsForTests() })
afterEach(() => { clearAllLocalIntegrityLogsForTests() })

describe('localLog', () => {
  it('reads back exactly what was recorded for that user', () => {
    recordLocalIntegrityEvent('student-a', 'paste-blocked', NOW)
    recordLocalIntegrityEvent('student-a', 'blur', NOW)
    recordLocalIntegrityEvent('student-a', 'paste-blocked', NOW)
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([{ type: 'paste-blocked' }, { type: 'blur' }, { type: 'paste-blocked' }])
  })

  it('drops events older than the seven day window, mirroring the server', () => {
    recordLocalIntegrityEvent('student-a', 'printscreen', NOW - 8 * DAY_MS)
    recordLocalIntegrityEvent('student-a', 'printscreen', NOW - 6 * DAY_MS)
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([{ type: 'printscreen' }])
  })

  it('is empty with nothing recorded', () => {
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([])
  })

  // Fix round 1, C1: the critical fix. One learner's events must never surface
  // as another learner's arithmetic on a shared browser.
  it('never lets one user read another user\'s events (C1 — the shared-machine fix)', () => {
    recordLocalIntegrityEvent('student-a', 'printscreen', NOW)
    recordLocalIntegrityEvent('student-a', 'printscreen', NOW)
    expect(readLocalIntegrityEvents('student-a', NOW)).toHaveLength(2)
    expect(readLocalIntegrityEvents('student-b', NOW)).toEqual([])

    recordLocalIntegrityEvent('student-b', 'blur', NOW)
    expect(readLocalIntegrityEvents('student-b', NOW)).toEqual([{ type: 'blur' }])
    expect(readLocalIntegrityEvents('student-a', NOW)).toHaveLength(2)
  })

  it('survives malformed storage instead of throwing', () => {
    localStorage.setItem('brogram:integrity-log:student-a', '{not json')
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([])
    localStorage.setItem('brogram:integrity-log:student-a', JSON.stringify([{ type: 'blur' }, 'garbage', null, 42]))
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([])
  })

  // Fix round 1, I5: an unrecognised event type must never reach the receipt as NaN.
  it('filters out a stored event whose type is not a known, weighed IntegrityEventType', () => {
    localStorage.setItem('brogram:integrity-log:student-a', JSON.stringify([
      { type: 'blur', at: NOW },
      { type: 'future-guard-type', at: NOW },
    ]))
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([{ type: 'blur' }])
  })

  it('clearLocalIntegrityLog wipes only the named user', () => {
    recordLocalIntegrityEvent('student-a', 'blur', NOW)
    recordLocalIntegrityEvent('student-b', 'blur', NOW)
    clearLocalIntegrityLog('student-a')
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([])
    expect(readLocalIntegrityEvents('student-b', NOW)).toEqual([{ type: 'blur' }])
  })

  it('clearAllLocalIntegrityLogsForTests wipes every user', () => {
    recordLocalIntegrityEvent('student-a', 'blur', NOW)
    recordLocalIntegrityEvent('student-b', 'blur', NOW)
    clearAllLocalIntegrityLogsForTests()
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([])
    expect(readLocalIntegrityEvents('student-b', NOW)).toEqual([])
  })
})

describe('syncLocalIntegrityLogUser', () => {
  it('does nothing the first time any user is seen', () => {
    recordLocalIntegrityEvent('student-a', 'blur', NOW)
    syncLocalIntegrityLogUser('student-a')
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([{ type: 'blur' }])
  })

  it('does nothing on a repeat render of the same user', () => {
    recordLocalIntegrityEvent('student-a', 'blur', NOW)
    syncLocalIntegrityLogUser('student-a')
    syncLocalIntegrityLogUser('student-a')
    syncLocalIntegrityLogUser('student-a')
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([{ type: 'blur' }])
  })

  it('clears the previous user\'s log the moment a different user is seen', () => {
    recordLocalIntegrityEvent('student-a', 'printscreen', NOW)
    syncLocalIntegrityLogUser('student-a')
    expect(readLocalIntegrityEvents('student-a', NOW)).toHaveLength(1)

    syncLocalIntegrityLogUser('student-b')
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([])
    expect(readLocalIntegrityEvents('student-b', NOW)).toEqual([])
  })

  it('ignores a null userId (signed-out / not yet known)', () => {
    recordLocalIntegrityEvent('student-a', 'blur', NOW)
    syncLocalIntegrityLogUser('student-a')
    syncLocalIntegrityLogUser(null)
    expect(readLocalIntegrityEvents('student-a', NOW)).toEqual([{ type: 'blur' }])
  })
})
