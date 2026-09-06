import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clo, closFor, course, exerciseFrom, loadCourseBundle } from './index'

function fakeResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload }
}

describe('curriculum/index', () => {
  it('closFor returns CLOs in ordinal order', () => {
    const clos = closFor('INFS1101')
    expect(clos.length).toBeGreaterThan(0)
    const ordinals = clos.map((c) => c.ordinal)
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b))
    for (const c of clos) expect(c.course).toBe('INFS1101')
  })

  it('clo() exposes the drafted marker for INFS1201-1', () => {
    expect(clo('INFS1201-1')?.draft).toBe(true)
  })

  it('clo() returns null for an unknown id', () => {
    expect(clo('NOPE-1')).toBeNull()
  })

  it("course('INFS3102').status is live now that the Java browser adapter has landed", () => {
    expect(course('INFS3102')?.status).toBe('live')
  })

  it('course() returns null for an unknown code', () => {
    expect(course('NOPE')).toBeNull()
  })

  describe('loadCourseBundle', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('issues exactly one fetch for two concurrent calls, and none for a third after resolution', async () => {
      const payload = { clos: [], exercises: [], lessons: [] }
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeResponse(payload) as Response)

      const [a, b] = await Promise.all([loadCourseBundle('INFS1101'), loadCourseBundle('INFS1101')])
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(a).toBe(b)

      const c = await loadCourseBundle('INFS1101')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(c).toBe(a)
    })

    it('exerciseFrom falls through to null for an id the static bundle does not carry (R5.1b)', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(fakeResponse({ clos: [], exercises: [], lessons: [] }) as Response)

      await loadCourseBundle('INFS2101')
      expect(exerciseFrom('INFS2101', 'not-a-real-id')).toBeNull()
      fetchSpy.mockRestore()
    })
  })
})
