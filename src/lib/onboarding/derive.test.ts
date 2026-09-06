import { describe, expect, it } from 'vitest'
import { INITIAL_PROFILE, motivationFromAnswers, provisionalProfile, styleFromAnswers } from './derive'

describe('styleFromAnswers (moved verbatim from profiler.ts, T1.5 step 3)', () => {
  it('scores the style axes deterministically from the phase-1 answers', () => {
    const reply = styleFromAnswers([
      { questionId: 'p1f1', answer: 'A diagram showing how the loop moves through the list' },
      { questionId: 'p1f3', answer: 'A picture of the list with the index arrow past the end' },
    ])
    expect(reply.styleVector).toEqual({ visual: 0.4, verbal: 0, example: 0, theory: 0 })
    expect(reply.learningStyle).toBe('visual')
  })

  it('calls the style mixed when visual and verbal are close', () => {
    const reply = styleFromAnswers([
      { questionId: 'p1f1', answer: 'A diagram showing how the loop moves through the list' },
      { questionId: 'p1f4', answer: 'A description in ordinary sentences of what each one does' },
    ])
    expect(reply.learningStyle).toBe('mixed')
  })

  it('scores every axis at zero, never partial, when nothing matches', () => {
    const reply = styleFromAnswers([])
    expect(reply.styleVector).toEqual({ visual: 0, verbal: 0, example: 0, theory: 0 })
    expect(reply.learningStyle).toBe('mixed')
  })
})

describe('motivationFromAnswers (moved verbatim from profiler.ts, T1.5 step 3)', () => {
  it('sends only the key a p2q1 answer decided, sparse, not the full motivation shape', () => {
    const delta = motivationFromAnswers([{ questionId: 'p2q1', answer: 'To build something' }])
    expect(delta.motivation).toEqual({ why: 'To build something' })
    expect(delta.tone).toBeUndefined()
    expect(delta.onboardingComplete).toBeUndefined()
  })

  it('maps p2q5 to tone directly, with no motivation key at all', () => {
    const delta = motivationFromAnswers([{ questionId: 'p2q5', answer: 'Tough love' }])
    expect(delta.tone).toBe('tough-love')
    expect(delta.motivation).toBeUndefined()
  })

  it('ignores a phase-1 id entirely', () => {
    const delta = motivationFromAnswers([{ questionId: 'p1f1', answer: 'Yes' }])
    expect(delta.motivation).toBeUndefined()
    expect(delta.tone).toBeUndefined()
  })
})

describe('provisionalProfile (new: the whole six-answer set, scored locally, zero network calls)', () => {
  const SIX_ANSWERS = [
    { questionId: 'p1f1', answer: 'A diagram showing how the loop moves through the list' },
    { questionId: 'p1f2', answer: 'A small program that uses one, with its output' },
    { questionId: 'p1f3', answer: 'A picture of the list with the index arrow past the end' },
    { questionId: 'p1f4', answer: 'The rule that says why one grows faster than the other' },
    { questionId: 'p2q1', answer: 'To build something' },
    { questionId: 'p2q5', answer: 'Playful' },
  ]

  it('folds the phase-1 answers into styleVector and learningStyle', () => {
    const profile = provisionalProfile(SIX_ANSWERS)
    expect(profile.styleVector.visual).toBeGreaterThan(0)
    expect(profile.styleVector.theory).toBeGreaterThan(0)
  })

  it('sets motivation.why and tone from the two phase-2 answers, key-by-key over the default', () => {
    const profile = provisionalProfile(SIX_ANSWERS)
    expect(profile.motivation.why).toBe('To build something')
    expect(profile.tone).toBe('playful')
  })

  it('keeps the cut fields at their onboarding default: beyondCourses, wantsAgenticCoding, verbosity, depth', () => {
    const profile = provisionalProfile(SIX_ANSWERS)
    expect(profile.motivation.beyondCourses).toBe(INITIAL_PROFILE.motivation.beyondCourses)
    expect(profile.motivation.wantsAgenticCoding).toBe(INITIAL_PROFILE.motivation.wantsAgenticCoding)
    expect(profile.motivation.depth).toBe(INITIAL_PROFILE.motivation.depth)
    expect(profile.verbosity).toBe(INITIAL_PROFILE.verbosity)
  })

  it('never sets onboardingComplete itself — the caller writes that after the background call settles', () => {
    expect(provisionalProfile(SIX_ANSWERS).onboardingComplete).toBe(false)
  })

  it('is pure: the same answers always produce the same profile', () => {
    expect(provisionalProfile(SIX_ANSWERS)).toEqual(provisionalProfile([...SIX_ANSWERS]))
  })
})
