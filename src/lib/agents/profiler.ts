import { z } from 'zod'
import type { LearnerProfile, ProfilerReply, ProfilerRequest } from '@/lib/contracts'
import type { AgentModule } from './shared'
import fallbackQuestions from './fixtures/profiler-fallback.json'

const system = `You are the BroGram Profiler. You run a two-phase onboarding for a university student who wants to learn to code. You ask one question at a time and you decide the next question from the answers so far. Reply only with json.

Phase 1 (learning style): 5 to 7 either-or questions that reveal whether the student learns best from diagrams, from worked examples, from plain explanations, or from rules first. Each question offers exactly two concrete options that a student can picture, for example "A diagram showing how the loop moves through the list" versus "A paragraph explaining what the loop does". Never ask "are you a visual learner". Infer it.

Phase 2 (motivation): exactly these, in order, one per turn:
1. Why are you learning to code right now? (options: "To pass my courses", "To get good at this", "To build something", "I am not sure yet")
2. Do you want to go beyond what your courses cover? ("Yes", "Only what the course needs", "Ask me later")
3. How deep do you want to go? ("Pass", "Understand", "Master")
4. Do you want to learn how to work with AI coding agents as part of this? ("Yes", "Not now")
5. How should I talk to you? ("Playful", "Supportive", "Tough love", "Direct")
6. Short answers or detailed ones? ("Short", "Detailed")

Rules:
- One question per reply. Two to four options per question. Options are short and concrete.
- In phase 1, after each answer update styleVector (visual, verbal, example, theory; each 0 to 1) and learningStyle (visual, verbal, mixed) in profileDelta.
- In phase 2, map each answer into profileDelta as it arrives: questions 1 to 4 each add one key to profileDelta.motivation (why, beyondCourses, depth, wantsAgenticCoding); question 5 sets profileDelta.tone (playful, supportive, tough-love, direct); question 6 sets profileDelta.verbosity (short, verbose). The app merges keys, so send only the key that this answer decided.
- When phase 2 question 6 is answered, set done to true, nextQuestion to null, and onboardingComplete to true in profileDelta.
- Never ask about prior coding knowledge. Never ask more than 13 questions total.

Reply format (json):
{
  "nextQuestion": { "id": "p1q3", "text": "...", "options": ["...", "..."] } | null,
  "profileDelta": { "learningStyle": "mixed", "styleVector": { "visual": 0.6, "verbal": 0.4, "example": 0.7, "theory": 0.3 } },
  "done": false
}`

export const profilerReply = z.object({
  nextQuestion: z.object({
    id: z.string().min(1),
    text: z.string().min(5).max(240),
    options: z.array(z.string().min(1).max(80)).min(2).max(4),
  }).nullable(),
  profileDelta: z.object({
    learningStyle: z.enum(['visual', 'verbal', 'mixed']).optional(),
    styleVector: z.object({ visual: z.number().min(0).max(1), verbal: z.number().min(0).max(1), example: z.number().min(0).max(1), theory: z.number().min(0).max(1) }).optional(),
    tone: z.enum(['playful', 'supportive', 'tough-love', 'direct']).optional(),
    verbosity: z.enum(['short', 'verbose']).optional(),
    motivation: z.object({ why: z.string(), beyondCourses: z.boolean(), depth: z.enum(['pass', 'understand', 'master']), wantsAgenticCoding: z.boolean() }).partial().optional(),
    onboardingComplete: z.boolean().optional(),
  }),
  done: z.boolean(),
}).refine(r => r.done === (r.nextQuestion === null), { error: 'done must be true exactly when nextQuestion is null' })

type StyleAxis = 'visual' | 'verbal' | 'example' | 'theory'
type FallbackQuestion = { id: string; text: string; options: { text: string; axis: StyleAxis }[] }
const PHASE1: FallbackQuestion[] = fallbackQuestions.questions as FallbackQuestion[]

const PHASE2 = [
  { id: 'p2q1', text: 'Why are you learning to code right now?', options: ['To pass my courses', 'To get good at this', 'To build something', 'I am not sure yet'] },
  { id: 'p2q2', text: 'Do you want to go beyond what your courses cover?', options: ['Yes', 'Only what the course needs', 'Ask me later'] },
  { id: 'p2q3', text: 'How deep do you want to go?', options: ['Pass', 'Understand', 'Master'] },
  { id: 'p2q4', text: 'Do you want to learn how to work with AI coding agents as part of this?', options: ['Yes', 'Not now'] },
  { id: 'p2q5', text: 'How should I talk to you?', options: ['Playful', 'Supportive', 'Tough love', 'Direct'] },
  { id: 'p2q6', text: 'Short answers or detailed ones?', options: ['Short', 'Detailed'] },
]

const TONE_BY_OPTION: Record<string, LearnerProfile['tone']> = {
  Playful: 'playful',
  Supportive: 'supportive',
  'Tough love': 'tough-love',
  Direct: 'direct',
}

/** Every chosen option adds 0.2 to its axis, clamped to 1. */
function styleFromAnswers(answers: ProfilerRequest['answers']) {
  const counts: Record<StyleAxis, number> = { visual: 0, verbal: 0, example: 0, theory: 0 }
  for (const a of answers) {
    const q = PHASE1.find(x => x.id === a.questionId)
    const option = q?.options.find(o => o.text === a.answer)
    if (option) counts[option.axis] += 1
  }
  const axis = (n: number) => Math.min(1, Math.round(n * 20) / 100)
  const styleVector = { visual: axis(counts.visual), verbal: axis(counts.verbal), example: axis(counts.example), theory: axis(counts.theory) }
  const learningStyle: LearnerProfile['learningStyle'] =
    styleVector.visual - styleVector.verbal >= 0.2 ? 'visual' : styleVector.verbal - styleVector.visual >= 0.2 ? 'verbal' : 'mixed'
  return { styleVector, learningStyle }
}

/** Phase-2 answers map by exact option text; only the keys those answers decided are sent. */
function motivationFromAnswers(answers: ProfilerRequest['answers']) {
  const delta: ProfilerReply['profileDelta'] = {}
  const motivation: NonNullable<ProfilerReply['profileDelta']['motivation']> = {}
  answers.forEach((a, i) => {
    const index = PHASE2.findIndex(q => q.id === a.questionId)
    switch (index === -1 ? i : index) {
      case 0: motivation.why = a.answer; break
      case 1: motivation.beyondCourses = a.answer === 'Yes'; break
      case 2: motivation.depth = a.answer.toLowerCase() as 'pass' | 'understand' | 'master'; break
      case 3: motivation.wantsAgenticCoding = a.answer === 'Yes'; break
      case 4: delta.tone = TONE_BY_OPTION[a.answer] ?? 'direct'; break
      case 5: delta.verbosity = a.answer === 'Detailed' ? 'verbose' : 'short'; break
    }
  })
  if (Object.keys(motivation).length) delta.motivation = motivation
  return delta
}

export const profiler: AgentModule<ProfilerRequest, ProfilerReply> = {
  name: 'profiler',
  system,
  schema: profilerReply,
  slice: state => ({ profile: state.profile, version: state.version }),
  payload: req => ({ phase: req.phase, answers: req.answers }),
  fallback(req) {
    if (req.phase === 1) {
      const { styleVector, learningStyle } = styleFromAnswers(req.answers)
      const profileDelta = { styleVector, learningStyle }
      const next = PHASE1[req.answers.length]
      if (next) return { nextQuestion: { id: next.id, text: next.text, options: next.options.map(o => o.text) }, profileDelta, done: false }
      return { nextQuestion: PHASE2[0], profileDelta, done: false }
    }
    const profileDelta = motivationFromAnswers(req.answers)
    const next = PHASE2[req.answers.length]
    if (next) return { nextQuestion: next, profileDelta, done: false }
    return { nextQuestion: null, profileDelta: { ...profileDelta, onboardingComplete: true }, done: true }
  },
  temperature: 0.6,
  maxTokens: 1500,
  streams: false,
}
