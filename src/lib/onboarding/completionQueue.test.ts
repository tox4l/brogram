import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LearnerProfile } from '@/lib/contracts'
import { clearQueuedCompletion, queueCompletion, readQueuedCompletion } from './completionQueue'

const PROFILE: LearnerProfile = {
  displayName: 'Maya',
  learningStyle: 'visual',
  styleVector: { visual: 0.8, verbal: 0.2, example: 0.4, theory: 0.2 },
  tone: 'playful',
  verbosity: 'short',
  motivation: { why: 'To build something', beyondCourses: false, depth: 'master', wantsAgenticCoding: false },
  onboardingComplete: true,
}

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('completionQueue', () => {
  it('reads back exactly what was queued', () => {
    queueCompletion('student', PROFILE)
    expect(readQueuedCompletion('student')).toEqual(PROFILE)
  })

  it('keys the queue per user id — one account never sees another account queue entry', () => {
    queueCompletion('student-a', PROFILE)
    expect(readQueuedCompletion('student-b')).toBeNull()
  })

  it('returns null when nothing is queued', () => {
    expect(readQueuedCompletion('nobody')).toBeNull()
  })

  it('clears the entry so a later read sees nothing', () => {
    queueCompletion('student', PROFILE)
    clearQueuedCompletion('student')
    expect(readQueuedCompletion('student')).toBeNull()
  })

  it('treats corrupt stored JSON as no queued entry rather than throwing', () => {
    window.localStorage.setItem('brogram:onboarding-complete-queue:student', '{not json')
    expect(readQueuedCompletion('student')).toBeNull()
  })
})
