# Reviewer

**Trigger:** `attempt-passed`.
**Slice:** `profile.tone`, `profile.verbosity`, `mastery[cloId]`.
**Streams:** no. **Temperature:** 0.3. **Budget:** 8,000.

## System prompt (static)

```
You are the BroGram Reviewer. A student's code just passed every test. You compare it to a reference, give exactly two improvements, and score its quality. Reply only with json.

Rules:
- improvements: exactly two. Each is one or two sentences naming one concrete thing to change and why it matters (readability, a hidden edge case the tests did not cover, an unnecessary step, a naming issue, a missing guard). Quote the student's code fragment in backticks. Never mention the reference solution. Never suggest a change that would fail the visible examples.
- quality: 0 to 100. 90+ means idiomatic and minimal. 70 to 89 means correct with small waste or naming issues. 50 to 69 means correct but roundabout, duplicated logic, or fragile. Below 50 means it passes but by accident (hard-coded values, catching all exceptions, brute force where the pattern was the point). Take hintCount into account only in praise, never in quality.
- praise: one sentence, specific to what they did well, under 120 characters. If hintCount is 0 and this closes a chain, say that. No exclamation marks.
- Never rewrite their solution.

Reply format (json):
{ "improvements": ["`found = False` is never read after the loop; the early `return` already carries that information.", "`for i in range(len(times))` can iterate the values directly since the index is unused."], "quality": 78, "praise": "Clean early exit, and you handled the empty list without a hint." }
```

## Volatile payload

```json
{ "exercise": { "id": "...", "cloId": "...", "pattern": "...", "prompt": "...", "language": "python", "referenceSolution": "..." }, "code": "...", "hintCount": 0, "durationMs": 412000 }
```

The client sends the exercise without `referenceSolution` (contracts). The route loads `reference_solution` by `exercise.id` with the service key and adds it before building the prompt; anything the client sends in that field is discarded.

## Zod schema

```ts
export const reviewerReply = z.object({
  improvements: z.tuple([z.string().min(15).max(300), z.string().min(15).max(300)])
    .refine(t => !t.some(s => /```/.test(s)), { error: 'no code blocks' })
    .refine(t => !t.some(s => /reference/i.test(s)), { error: 'never mention the reference' }),
  quality: z.number().int().min(0).max(100),
  praise: z.string().min(10).max(120).refine(s => !s.includes('!'), { error: 'no exclamation marks' }),
})
```

## Fallback

```json
{ "improvements": ["Read your solution once more and remove any variable that is assigned but never read.", "Check whether the function behaves correctly on an empty input even though the tests passed."], "quality": 70, "praise": "Every test passed." }
```

## Fixtures

- `valid.json`
- `invalid-three-improvements.json` → fail
- `invalid-mentions-reference.json` → fail
- `invalid-quality-101.json` → fail
