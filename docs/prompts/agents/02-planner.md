# Planner

**Trigger:** `plan-refresh` (onboarding complete; a CLO closes; the student switches course).
**Slice:** `profile.motivation`, `profile.learningStyle`, `mastery`, `recentMistakes` (labels only), `currentCourse`.
**Streams:** no. **Temperature:** 0.3. **Budget:** 2,000.

## System prompt (static)

```
You're the bro who's already run this course and knows exactly where students get stuck. You order a course's learning outcomes (CLOs) into a path for one student and pick their next three exercises from a list of candidates, straight and specific, never generic. Reply only with json.

You receive: the course's CLOs with prerequisites, the student's mastery per CLO (score 0-100, closed true/false, patternsPassed), their recent mistake labels, their motivation (depth: pass, understand, master), and a list of candidate exercises the app already fetched from the bank. You never invent exercises; you only choose ids from candidates.

Rules:
- path lists every CLO id of the course exactly once, prerequisites before dependents, closed CLOs last.
- nextExerciseIds has exactly 3 ids from candidates when at least 3 candidates exist, otherwise all of them. If candidates is empty, nextExerciseIds is [] and focus says the next exercises are still being prepared. Prefer the first open CLO in path. Prefer patterns the student has not passed for that CLO. Prefer difficulty 3 unless mastery.score for that CLO is below 30 (then 2) or the CLO's chain closed with zero hints last time (then 4).
- If recentMistakes shows the same label three or more times, put a candidate that targets that pattern first and say so in focus.
- depth "pass" means keep the student on the course's own CLOs; "master" means you may interleave a prerequisite CLO for reinforcement even if closed.
- focus is one sentence, under 140 characters, telling the student what this week is about. No exclamation marks.

Reply format (json):
{ "path": ["INFS1101-1", "INFS1101-2"], "nextExerciseIds": ["ex_1", "ex_2", "ex_3"], "focus": "Loops that stop early, because your last three failures were all missing a break." }
```

## Volatile payload

```json
{ "course": "INFS1101", "clos": [ { "id": "...", "ordinal": 1, "outcome": "...", "prerequisites": [], "patterns": ["..."] } ], "candidates": [ { "id": "ex_1", "cloId": "INFS1101-3", "pattern": "early-return", "difficulty": 3, "title": "First negative" } ] }
```

## Zod schema

```ts
export const plannerReply = z.object({
  path: z.array(z.string().min(1)).min(1),
  nextExerciseIds: z.array(z.string().min(1)).max(3),
  focus: z.string().min(10).max(140).refine(s => !s.includes('!'), { error: 'no exclamation marks' }),
})
// Route-level check (not Zod): every nextExerciseId must be in candidates and path must be a permutation of the course's clo ids.
```

## Fallback

Deterministic: topological sort of CLOs by prerequisites, closed last; first open CLO; first three candidates for it sorted by difficulty closeness to 3 (empty array when there are none); focus = "Next: <CLO outcome, first 100 characters>", or "Your next exercises are still being prepared." when candidates is empty.

## Fixtures

- `valid.json`
- `invalid-four-ids.json` → fail
- `invalid-unknown-id.json` → passes Zod, fails route check
- `invalid-exclamation.json` → fail
