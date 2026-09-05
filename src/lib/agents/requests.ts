import { z } from 'zod'
import type { AgentName } from '@/lib/contracts'

const LANGUAGE = z.enum(['python', 'javascript', 'typescript', 'web', 'sql', 'mongo', 'java'])
const KIND = z.enum(['code', 'predict-output', 'spot-the-bug', 'trace', 'schema'])
const DIFFICULTY = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])

const identity = { userId: z.string().min(1), version: z.number().int() }

const profile = z.object({
  displayName: z.string(),
  learningStyle: z.enum(['visual', 'verbal', 'mixed']),
  styleVector: z.object({ visual: z.number(), verbal: z.number(), example: z.number(), theory: z.number() }),
  tone: z.enum(['playful', 'supportive', 'tough-love', 'direct']),
  verbosity: z.enum(['short', 'verbose']),
  motivation: z.object({
    why: z.string(),
    beyondCourses: z.boolean(),
    depth: z.enum(['pass', 'understand', 'master']),
    wantsAgenticCoding: z.boolean(),
  }).partial(),
  onboardingComplete: z.boolean(),
}).partial()

/** Only the profile keys an agent may read survive; everything else is stripped. */
const plannerProfile = profile.pick({ motivation: true, learningStyle: true })
const authorProfile = profile.pick({ learningStyle: true, verbosity: true })
const styleProfile = profile.pick({ tone: true, verbosity: true })

const masteryRow = z.object({
  userId: z.string().optional(),
  cloId: z.string().min(1),
  score: z.number(),
  chain: z.number(),
  patternsPassed: z.array(z.string()),
  closed: z.boolean(),
  lastAttemptAt: z.string().nullable().optional(),
})
const mastery = z.record(z.string(), masteryRow)

const recentMistakes = z.array(z.object({
  exerciseId: z.string(),
  cloId: z.string(),
  pattern: z.string(),
  label: z.string().max(120),
  at: z.string(),
})).max(10)

const clo = z.object({
  id: z.string().min(1),
  course: z.string(),
  ordinal: z.number(),
  outcome: z.string(),
  topics: z.array(z.string()),
  prerequisites: z.array(z.string()),
  patterns: z.array(z.string()),
  assessableInCode: z.boolean(),
})

const testResult = z.object({
  testId: z.string(),
  passed: z.boolean(),
  actual: z.string(),
  expected: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
  failureKind: z.enum(['timeout', 'runtime-error', 'wrong-answer', 'compile-error']).optional(),
})

const exerciseRef = z.object({
  id: z.string().min(1),
  cloId: z.string().min(1),
  pattern: z.string(),
  prompt: z.string(),
  language: LANGUAGE,
})

const CODE = z.string().max(20000)

export const profilerRequest = z.object({
  agent: z.literal('profiler'),
  trigger: z.literal('onboarding-answer'),
  state: z.object({ ...identity, profile: profile.optional() }),
  phase: z.union([z.literal(1), z.literal(2)]),
  answers: z.array(z.object({ questionId: z.string().min(1), answer: z.string() })).max(13),
})

export const plannerRequest = z.object({
  agent: z.literal('planner'),
  trigger: z.literal('plan-refresh'),
  state: z.object({
    ...identity,
    profile: plannerProfile.optional(),
    mastery: mastery.optional(),
    recentMistakes: recentMistakes.optional(),
    currentCourse: z.string().nullable().optional(),
  }),
  course: z.string().min(1),
  // the reply must name every CLO of the course, so an empty course has no answer worth asking for
  clos: z.array(clo).min(1),
  candidates: z.array(z.object({
    id: z.string().min(1),
    cloId: z.string().min(1),
    pattern: z.string(),
    difficulty: DIFFICULTY,
    title: z.string(),
  })),
})

export const authorRequest = z.object({
  agent: z.literal('author'),
  trigger: z.literal('bank-miss'),
  state: z.object({
    ...identity,
    profile: authorProfile.optional(),
    recentMistakes: recentMistakes.optional(),
  }),
  clo,
  language: LANGUAGE,
  kind: KIND,
  difficulty: DIFFICULTY,
  pattern: z.string().min(1),
  exampleIds: z.array(z.string().min(1)).max(2),
  parentExerciseId: z.string().min(1).optional(),
})

export const diagnoserRequest = z.object({
  agent: z.literal('diagnoser'),
  trigger: z.literal('attempt-failed'),
  state: z.object({
    ...identity,
    profile: styleProfile.optional(),
    recentMistakes: recentMistakes.optional(),
  }),
  exercise: exerciseRef.extend({ kind: KIND }),
  code: CODE,
  results: z.array(testResult).max(20),
})

export const coachRequest = z.object({
  agent: z.literal('coach'),
  trigger: z.literal('hint-requested'),
  state: z.object({ ...identity, profile: styleProfile.optional() }),
  exercise: exerciseRef,
  diffSinceLastHint: z.string().max(8000),
  currentCode: CODE,
  fixPlan: z.array(z.string()).max(6),
  hintsSoFar: z.array(z.string()).max(5),
})

export const reviewerRequest = z.object({
  agent: z.literal('reviewer'),
  trigger: z.literal('attempt-passed'),
  state: z.object({
    ...identity,
    profile: styleProfile.optional(),
    mastery: mastery.optional(),
  }),
  // referenceSolution is not a key here, so a client-supplied one is stripped before hydration
  exercise: exerciseRef,
  code: CODE,
  hintCount: z.number().int().min(0),
  durationMs: z.number().min(0),
})

export const buddyRequest = z.object({
  agent: z.literal('buddy'),
  trigger: z.literal('buddy-message'),
  state: z.object({
    ...identity,
    profile: profile.optional(),
    mastery: mastery.optional(),
    recentMistakes: recentMistakes.optional(),
    streak: z.object({
      exerciseDays: z.number(),
      derotDays: z.number(),
      lastExerciseDate: z.string().nullable(),
      lastDerotDate: z.string().nullable(),
    }).optional(),
    integrityScore: z.number().optional(),
    accountStatus: z.enum(['active', 'warned', 'restricted', 'banned']).optional(),
    nextExerciseIds: z.array(z.string()).optional(),
  }),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(6),
})

export const requestSchemas: Record<AgentName, z.ZodType> = {
  profiler: profilerRequest,
  planner: plannerRequest,
  author: authorRequest,
  diagnoser: diagnoserRequest,
  coach: coachRequest,
  reviewer: reviewerRequest,
  buddy: buddyRequest,
}
