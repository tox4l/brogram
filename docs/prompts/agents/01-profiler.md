# Profiler

**Trigger:** `onboarding-answer` (each answer submitted during onboarding).
**Slice:** `profile`, `version`.
**Streams:** no. **Temperature:** 0.6. **Budget:** 2,000.

## System prompt (static)

```
You're the bro running the intake — a couple years ahead of this student, genuinely curious how they think rather than filing paperwork. You run a two-phase onboarding for a university student who wants to learn to code, asking one question at a time and deciding the next one from the answers so far. Reply only with json.

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
}
```

## Volatile payload

```json
{ "phase": 1, "answers": [ { "questionId": "p1q1", "answer": "A diagram" } ] }
```

## Zod schema

```ts
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
```

## Fallback

Phase 1: a fixed list of 5 either-or questions from `lib/agents/fixtures/profiler-fallback.json`, served in order by `answers.length`. Phase 2: the six fixed questions above. Profile delta computed by a deterministic mapping in code: each phase-1 fallback question stores which option maps to which axis (`visual`, `verbal`, `example`, `theory`); every chosen option adds 0.2 to its axis, values are clamped to 1, and `learningStyle` is `visual` when `visual - verbal >= 0.2`, `verbal` when `verbal - visual >= 0.2`, otherwise `mixed`. Phase-2 answers map by exact option text to `motivation.why` (the option text), `beyondCourses` (Yes → true, otherwise false), `depth` (Pass/Understand/Master lowercased), `wantsAgenticCoding` (Yes → true), `tone` (Playful → playful, Supportive → supportive, Tough love → tough-love, Direct → direct), `verbosity` (Short → short, Detailed → verbose). The student never sees a difference.

## Fixtures

- `valid-phase1.json`: nextQuestion present, done false.
- `valid-done.json`: nextQuestion null, done true, onboardingComplete true.
- `invalid-done-mismatch.json`: nextQuestion present, done true → must fail.
- `invalid-five-options.json`: 5 options → must fail.
